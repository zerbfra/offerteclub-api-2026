const admin = require("firebase-admin");
const { computeDiscount } = require("./parse-price");
const { getUserDeviceTokens, sendBatch } = require("./expo");
const { markPushed } = require("./idempotency");
const { enqueueReceipts } = require("./receipts");

const { notificationExpiresAt } = require("./ttl");

const FAVS_CHUNK = 30;

// Match "minimo storico" e varianti: minimo/minima/minimi/minime + storico/storica/storici/storiche.
// Case-insensitive, accetta carattere extra non-spazio prima/dopo (es. "🔥minimo storico!").
const HISTORIC_MIN_RE = /\bminim\w*\s+storic\w*/i;

const isHistoricMin = (post) => {
  const comment = post?.payload?.comment;
  if (typeof comment !== "string" || !comment) return false;
  return HISTORIC_MIN_RE.test(comment);
};

/**
 * Trova gli uid che vogliono ricevere `discount_threshold` per un post con
 * lo sconto dato. Firestore non supporta range combinati `>` e `<=`, quindi
 * filtriamo `> 0` lato server.
 */
const recipientsByDiscountThreshold = async (firestore, discount) => {
  if (!Number.isFinite(discount) || discount <= 0) return [];
  const snap = await firestore
    .collection("users")
    .where("notifPrefs.pushEnabled", "==", true)
    .where("notifPrefs.minDiscount", "<=", discount)
    .get();
  const uids = [];
  snap.forEach((doc) => {
    const min = doc.data()?.notifPrefs?.minDiscount;
    if (typeof min === "number" && min > 0) uids.push(doc.id);
  });
  return uids;
};

/**
 * Trova gli uid che vogliono ricevere `price_drop` (minimo storico).
 * Filtra notifPrefs.pushEnabled=true && notifPrefs.historicMin=true.
 */
const recipientsByHistoricMin = async (firestore) => {
  const snap = await firestore
    .collection("users")
    .where("notifPrefs.pushEnabled", "==", true)
    .where("notifPrefs.historicMin", "==", true)
    .get();
  const uids = [];
  snap.forEach((doc) => uids.push(doc.id));
  return uids;
};

/**
 * Trova gli uid che hanno il post nei preferiti (user_favs/{uid}/items/{postId})
 * e hanno notifPrefs.favoritesAlerts && notifPrefs.pushEnabled.
 */
const recipientsByFavoriteHit = async (firestore, postId) => {
  const snap = await firestore.collectionGroup("items").where("id", "==", postId).get();
  const uids = new Set();
  snap.forEach((doc) => {
    const segments = doc.ref.path.split("/");
    if (segments.length >= 2 && segments[0] === "user_favs") {
      uids.add(segments[1]);
    }
  });
  if (uids.size === 0) return [];

  const result = [];
  const arr = [...uids];
  for (let i = 0; i < arr.length; i += FAVS_CHUNK) {
    const refs = arr.slice(i, i + FAVS_CHUNK).map((uid) => firestore.collection("users").doc(uid));
    const docs = await firestore.getAll(...refs);
    docs.forEach((d) => {
      const prefs = d.data()?.notifPrefs;
      if (prefs?.pushEnabled === true && prefs?.favoritesAlerts === true) {
        result.push(d.id);
      }
    });
  }
  return result;
};

const buildMessages = ({ tokens, postId, post, type }) => {
  let title;
  if (type === "favorite_hit") {
    title = "Un tuo preferito è in offerta";
  } else if (type === "price_drop") {
    title = "Minimo storico!";
  } else {
    title = `Sconto del ${post.discount}%`;
  }
  const body = (post.payload?.title || "Apri l'app per vedere l'offerta").slice(0, 140);
  const image = post.payload?.image || post.payload?.framedImage || null;

  const messages = tokens.map((t) => ({
    to: t.token,
    title,
    body,
    sound: "default",
    priority: "high",
    channelId: "default",
    data: {
      dealId: postId,
      type,
      image: image || undefined,
    },
  }));

  const mirror = {
    type,
    title,
    body,
    dealId: postId,
    image: image || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: notificationExpiresAt(),
    read: false,
  };

  return { messages, mirror };
};

const dispatchToUser = async ({ firestore, expo, uid, postId, post, type, log }) => {
  const tokens = await getUserDeviceTokens(firestore, uid);
  if (tokens.length === 0) return [];

  const { messages, mirror } = buildMessages({ tokens, postId, post, type });
  const tickets = await sendBatch(expo, messages, log);

  try {
    await firestore.collection("users").doc(uid).collection("notifications").add(mirror);
  } catch (err) {
    log?.warn({ err, uid }, "[push] failed to write notification mirror");
  }

  const tokenByAddress = new Map(tokens.map((t) => [t.token, t]));
  return tickets.map((entry) => ({
    ...entry,
    device: tokenByAddress.get(entry.message.to) || null,
  }));
};

/**
 * Entrypoint del fan-out per un nuovo post. Idempotente via Redis (NX + TTL).
 */
const fanOutPush = async ({ deps, postId, post }) => {
  const { firestore, redis, expo, config, log } = deps;
  if (post?.country && post.country !== config.push.country) return;

  const discount = computeDiscount(post?.payload?.price);
  if (!discount && !post?.payload?.title) return;

  const first = await markPushed(redis, postId, config.push.idempotencyTtlSeconds);
  if (!first) return;

  const historicMin = isHistoricMin(post);
  log?.info({ postId, discount, historicMin }, "[push] fan-out start");

  const allTickets = [];

  if (historicMin) {
    const uids = await recipientsByHistoricMin(firestore);
    for (const uid of uids) {
      const tickets = await dispatchToUser({
        firestore,
        expo,
        uid,
        postId,
        post: { ...post, discount },
        type: "price_drop",
        log,
      });
      allTickets.push(...tickets);
    }
    log?.info({ postId, recipients: uids.length }, "[push] price_drop dispatched");
  }

  if (Number.isFinite(discount) && discount > 0) {
    const uids = await recipientsByDiscountThreshold(firestore, discount);
    for (const uid of uids) {
      const tickets = await dispatchToUser({
        firestore,
        expo,
        uid,
        postId,
        post: { ...post, discount },
        type: "discount_threshold",
        log,
      });
      allTickets.push(...tickets);
    }
    log?.info({ postId, recipients: uids.length }, "[push] discount_threshold dispatched");
  }

  const favUids = await recipientsByFavoriteHit(firestore, postId);
  for (const uid of favUids) {
    const tickets = await dispatchToUser({
      firestore,
      expo,
      uid,
      postId,
      post: { ...post, discount },
      type: "favorite_hit",
      log,
    });
    allTickets.push(...tickets);
  }
  if (favUids.length > 0) {
    log?.info({ postId, recipients: favUids.length }, "[push] favorite_hit dispatched");
  }

  if (allTickets.length > 0) {
    await enqueueReceipts(
      redis,
      allTickets,
      config.push.receiptDelaySeconds,
      config.push.idempotencyTtlSeconds,
    );
  }

  return { discountRecipients: 0, favoriteRecipients: favUids.length, tickets: allTickets.length };
};

module.exports = { fanOutPush };
