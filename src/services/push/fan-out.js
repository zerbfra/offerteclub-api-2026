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
 *
 * Dedup per (uid, postId): se un utente matcha più criteri, riceve UNA sola
 * push con il tipo a priorità più alta:
 *   favorite_hit > price_drop > discount_threshold
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

  const [favUids, historicUids, discountUids] = await Promise.all([
    recipientsByFavoriteHit(firestore, postId),
    historicMin ? recipientsByHistoricMin(firestore) : Promise.resolve([]),
    Number.isFinite(discount) && discount > 0
      ? recipientsByDiscountThreshold(firestore, discount)
      : Promise.resolve([]),
  ]);

  // Priorità: favorite_hit > price_drop > discount_threshold
  const uidType = new Map();
  for (const uid of favUids) uidType.set(uid, "favorite_hit");
  for (const uid of historicUids) {
    if (!uidType.has(uid)) uidType.set(uid, "price_drop");
  }
  for (const uid of discountUids) {
    if (!uidType.has(uid)) uidType.set(uid, "discount_threshold");
  }

  log?.info(
    {
      postId,
      candidates: {
        favorite_hit: favUids.length,
        price_drop: historicUids.length,
        discount_threshold: discountUids.length,
      },
      uniqueRecipients: uidType.size,
    },
    "[push] fan-out recipients",
  );

  const allTickets = [];
  const dispatched = { favorite_hit: 0, price_drop: 0, discount_threshold: 0 };
  for (const [uid, type] of uidType) {
    const tickets = await dispatchToUser({
      firestore,
      expo,
      uid,
      postId,
      post: { ...post, discount },
      type,
      log,
    });
    allTickets.push(...tickets);
    dispatched[type] += 1;
  }

  if (uidType.size > 0) {
    log?.info({ postId, dispatched, tickets: allTickets.length }, "[push] fan-out dispatched");
  }

  if (allTickets.length > 0) {
    await enqueueReceipts(
      redis,
      allTickets,
      config.push.receiptDelaySeconds,
      config.push.idempotencyTtlSeconds,
    );
  }
};

module.exports = { fanOutPush };
