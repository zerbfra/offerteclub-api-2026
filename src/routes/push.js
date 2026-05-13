const admin = require("firebase-admin");
const config = require("../config");
const { enqueueReceipts } = require("../services/push/receipts");

const ALLOWED_TYPES = new Set([
  "price_drop",
  "discount_threshold",
  "favorite_hit",
  "community_hot",
  "most_liked",
  "web_landing",
  "generic",
]);

const requireAdmin = (request, reply) => {
  const auth = request.headers["authorization"] || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!config.push.adminToken || token !== config.push.adminToken) {
    reply.code(401).send({ status: 401, message: "unauthorized", data: [] });
    return false;
  }
  return true;
};

module.exports = async function (fastify) {
  // POST /api/push/test — invia una push fittizia a tutti i device di un uid.
  // Auth: Bearer <PUSH_ADMIN_TOKEN>
  // Body: { uid, title, body, type?, dealId?, image?, webUrl?, webTitle? }
  //   type ∈ { price_drop | discount_threshold | favorite_hit | community_hot | most_liked
  //          | web_landing | generic }   (default: discount_threshold)
  //   web_landing → richiede `webUrl`; `webTitle` opzionale (etichetta della modale)
  //   generic → nessun extra obbligatorio, solo title/body
  fastify.post("/push/test", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const { uid, title, body, dealId, image, webUrl, webTitle } = request.body || {};
    const type = request.body?.type || "discount_threshold";
    if (!uid || !title || !body) {
      return reply.code(400).send({ status: 400, message: "uid, title, body required", data: [] });
    }
    if (!ALLOWED_TYPES.has(type)) {
      return reply.code(400).send({
        status: 400,
        message: `invalid type, allowed: ${[...ALLOWED_TYPES].join(", ")}`,
        data: [],
      });
    }
    if (type === "web_landing" && !webUrl) {
      return reply
        .code(400)
        .send({ status: 400, message: "webUrl required for type=web_landing", data: [] });
    }

    const tokens = await fastify.push.getUserDeviceTokens(uid);
    if (tokens.length === 0) {
      return reply
        .code(404)
        .send({ status: 404, message: "no devices registered for uid", data: [] });
    }

    const dataPayload = { type };
    if (dealId) dataPayload.dealId = dealId;
    if (image) dataPayload.image = image;
    if (webUrl) dataPayload.webUrl = webUrl;
    if (webTitle) dataPayload.webTitle = webTitle;

    const messages = tokens.map((t) => ({
      to: t.token,
      title,
      body,
      sound: "default",
      priority: "high",
      channelId: "default",
      data: dataPayload,
    }));

    const tickets = await fastify.push.sendBatch(messages);

    try {
      await fastify.firestore
        .collection("users")
        .doc(uid)
        .collection("notifications")
        .add({
          type,
          title,
          body,
          dealId: dealId || "",
          image: image || null,
          webUrl: webUrl || null,
          webTitle: webTitle || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          read: false,
        });
    } catch (err) {
      fastify.log.warn({ err, uid }, "[push] test mirror write failed");
    }

    const tokenByAddress = new Map(tokens.map((t) => [t.token, t]));
    const ticketRecords = tickets.map((entry) => ({
      ...entry,
      device: tokenByAddress.get(entry.message.to) || null,
    }));
    await enqueueReceipts(
      fastify.redis,
      ticketRecords,
      config.push.receiptDelaySeconds,
      config.push.idempotencyTtlSeconds,
    );

    return {
      status: 200,
      data: { devices: tokens.length, tickets: tickets.map((t) => t.ticket) },
    };
  });
};
