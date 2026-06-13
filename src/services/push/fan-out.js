const admin = require("firebase-admin");
const { computeDiscount } = require("./parse-price");
const { parseChannel } = require("./parse-channel");
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
 *
 * Filtro `channels` (post-filter in memoria per non escludere i doc legacy
 * senza il campo, che `array-contains` taglierebbe fuori). La semantica voluta
 * è `channels AND minDiscount`:
 *   - channels undefined/non-array  → include (legacy = tutte le categorie)
 *   - channels array vuoto          → escludi (opt-out esplicito)
 *   - channels include postChannel  → includi
 *   - altrimenti                    → escludi
 * Se postChannel è null (canale non mappato o `post.channel.chat` assente),
 * NON possiamo confermare che il post appartenga a una categoria scelta:
 * per gli utenti con `channels` esplicito escludiamo (altrimenti basterebbe
 * matchare minDiscount per ricevere push di qualsiasi categoria). I legacy
 * senza `channels` continuano a ricevere tutto.
 */
const recipientsByDiscountThreshold = async (firestore, discount, postChannel) => {
  if (!Number.isFinite(discount) || discount <= 0) return [];
  const snap = await firestore
    .collection("users")
    .where("notifPrefs.pushEnabled", "==", true)
    .where("notifPrefs.minDiscount", "<=", discount)
    .get();
  const uids = [];
  snap.forEach((doc) => {
    const prefs = doc.data()?.notifPrefs;
    const min = prefs?.minDiscount;
    if (typeof min !== "number" || min <= 0) return;
    const channels = prefs?.channels;
    if (Array.isArray(channels)) {
      // Utente con preferenza esplicita: includi solo se il canale del post
      // è mappabile ed è tra le categorie scelte.
      if (!postChannel || !channels.includes(postChannel)) return;
    }
    uids.push(doc.id);
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
 * Trova gli uid che hanno il prodotto nei preferiti (`user_favs/{uid}/items/*`)
 * e hanno notifPrefs.favoritesAlerts && notifPrefs.pushEnabled.
 *
 * Il match è per **prodotto**, non per singolo post: lo stesso ASIN/EAN può
 * essere pubblicato più volte con `postId` diversi. Confrontiamo:
 *  - `payload.ean` ↔ `items.ean` (primario)
 *  - `payload.asin` ↔ `items.asin` (in unione: cattura i preferiti salvati
 *    solo con asin, e fa da fallback se il post non ha ean).
 */
const recipientsByFavoriteHit = async (firestore, post) => {
  const ean = post?.payload?.ean;
  const asin = post?.payload?.asin;
  if (!ean && !asin) return [];

  const queries = [];
  if (ean) queries.push(firestore.collectionGroup("items").where("ean", "==", ean).get());
  if (asin) queries.push(firestore.collectionGroup("items").where("asin", "==", asin).get());
  const snaps = await Promise.all(queries);

  const uids = new Set();
  for (const snap of snaps) {
    snap.forEach((doc) => {
      const segments = doc.ref.path.split("/");
      if (segments.length >= 2 && segments[0] === "user_favs") {
        uids.add(segments[1]);
      }
    });
  }
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

// Estrae dal payload Firebase solo i campi scalari (string/number/boolean),
// escludendo oggetti, array e le chiavi in `excludeKeys`. Tiene la push leggera
// e sotto il limite payload Expo (~4KB) anche se Firebase aggiunge campi nuovi.
const buildDealPayload = (payload, excludeKeys) => {
  if (!payload || typeof payload !== "object") return null;
  const excluded = new Set(excludeKeys);
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (excluded.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
};

const buildMessages = ({ tokens, postId, post, type, payloadExcludeKeys }) => {
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
  const dealPayload = buildDealPayload(post.payload, payloadExcludeKeys);

  const messages = tokens.map((t) => ({
    to: t.token,
    title,
    body,
    sound: "default",
    priority: "high",
    channelId: "default",
    data: {
      dealId: postId,
      dealPayload: dealPayload || undefined,
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

const dispatchToUser = async ({
  firestore,
  expo,
  uid,
  postId,
  post,
  type,
  payloadExcludeKeys,
  seenTokens,
  log,
}) => {
  const allTokens = await getUserDeviceTokens(firestore, uid);
  if (allTokens.length === 0) return { tickets: [], deduped: 0 };

  // Dedup cross-uid: lo stesso Expo pushToken può essere registrato sotto più
  // uid (account switch / reinstall senza cleanup del doc precedente). L'uid
  // a priorità più alta viene processato prima (favorite_hit > price_drop >
  // discount_threshold), quindi qui scartiamo i token già "vinti".
  const tokens = allTokens.filter((t) => !seenTokens.has(t.token));
  const deduped = allTokens.length - tokens.length;
  if (tokens.length === 0) return { tickets: [], deduped };
  for (const t of tokens) seenTokens.add(t.token);

  const { messages, mirror } = buildMessages({ tokens, postId, post, type, payloadExcludeKeys });
  const tickets = await sendBatch(expo, messages, log);

  try {
    await firestore.collection("users").doc(uid).collection("notifications").add(mirror);
  } catch (err) {
    log?.warn({ err, uid }, "[push] failed to write notification mirror");
  }

  const tokenByAddress = new Map(tokens.map((t) => [t.token, t]));
  return {
    tickets: tickets.map((entry) => ({
      ...entry,
      device: tokenByAddress.get(entry.message.to) || null,
    })),
    deduped,
  };
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
  const postChannel = parseChannel(post?.channel?.chat);
  log?.info({ postId, discount, historicMin, postChannel }, "[push] fan-out start");

  const [favUids, historicUids, discountUids] = await Promise.all([
    recipientsByFavoriteHit(firestore, post),
    historicMin ? recipientsByHistoricMin(firestore) : Promise.resolve([]),
    Number.isFinite(discount) && discount > 0
      ? recipientsByDiscountThreshold(firestore, discount, postChannel)
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
  const seenTokens = new Set();
  let dedupedTokens = 0;
  for (const [uid, type] of uidType) {
    const { tickets, deduped } = await dispatchToUser({
      firestore,
      expo,
      uid,
      postId,
      post: { ...post, discount },
      type,
      payloadExcludeKeys: config.push.payloadExcludeKeys,
      seenTokens,
      log,
    });
    allTickets.push(...tickets);
    dedupedTokens += deduped;
    if (tickets.length > 0) dispatched[type] += 1;
  }

  if (uidType.size > 0) {
    log?.info(
      { postId, dispatched, tickets: allTickets.length, dedupedTokens },
      "[push] fan-out dispatched",
    );
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
