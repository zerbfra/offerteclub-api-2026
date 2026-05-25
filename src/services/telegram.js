const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIRESTORE_IN_MAX = 30;

const SORT_BY_MAP = {
  date: "post_date",
  post_date: "post_date",
  views: "views",
  forwards: "forwards",
  reactions: "reactions_total",
  reactions_total: "reactions_total",
};

const normalizeChannel = (channel) => {
  const trimmed = (channel ?? "").toString().trim().replace(/^@+/, "");
  if (!trimmed) return null;
  return `@${trimmed}`;
};

const formatRow = (row) => ({
  channel: row.channel,
  message_id: Number(row.message_id),
  post_date: row.post_date,
  views: row.views,
  forwards: row.forwards,
  reactions_total: row.reactions_total,
  last_updated: row.last_updated,
});

const getPostStatsByChannel = async (mysql, channel, { limit, date, hours, sortBy } = {}) => {
  const normalized = normalizeChannel(channel);
  if (!normalized) {
    const err = new Error("Channel is required");
    err.statusCode = 400;
    throw err;
  }

  if (date && !DATE_RE.test(date)) {
    const err = new Error("Invalid date format, expected YYYY-MM-DD");
    err.statusCode = 400;
    throw err;
  }

  if (hours != null && (!Number.isFinite(hours) || hours <= 0)) {
    const err = new Error("Invalid hours, expected positive number");
    err.statusCode = 400;
    throw err;
  }

  const sortKey = sortBy ? SORT_BY_MAP[sortBy] : "post_date";
  if (sortBy && !sortKey) {
    const err = new Error(`Invalid sortBy, allowed: ${Object.keys(SORT_BY_MAP).join(", ")}`);
    err.statusCode = 400;
    throw err;
  }

  const query = mysql("post_stats")
    .where({ channel: normalized })
    .orderBy(sortKey, "desc")
    .orderBy("message_id", "desc");

  if (date) {
    query.where("post_date", ">=", `${date} 00:00:00`);
  } else if (hours) {
    query.whereRaw("post_date >= NOW() - INTERVAL ? HOUR", [hours]);
  }
  if (limit) {
    query.limit(limit);
  }

  const rows = await query;
  return rows.map(formatRow);
};

const enrichStatsWithFirestore = async (firestore, channel, rows) => {
  if (rows.length === 0) return rows;

  const normalizedChat = channel.replace(/^@/, "");
  const messageIds = rows.map((r) => r.message_id);
  const postsByMsgId = {};

  for (let i = 0; i < messageIds.length; i += FIRESTORE_IN_MAX) {
    const chunk = messageIds.slice(i, i + FIRESTORE_IN_MAX);
    const snapshot = await firestore
      .collection("posts")
      .where("channel.telegramMessageId", "in", chunk)
      .where("channel.chat", "==", `@${normalizedChat}`)
      .get();
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const msgId = data.channel?.telegramMessageId;
      if (msgId != null) postsByMsgId[msgId] = { ...data, docId: doc.id };
    });
  }

  // Allowlist: solo i campi che il client usa davvero. Tutto il resto
  // (message_id, post_date, reactions_total, last_updated, whatsapp,
  // disableNotification, username, scheduled, channel.tag*, channel.appTag,
  // channel.waTag, channel.telegramMessageId, ...) viene scartato.
  // Righe MySQL senza post Firestore matchato vengono filtrate (senza docId
  // e payload sono inutili). Dedup per `payload.asin`: la prima occorrenza
  // nell'ordine già scelto da sortBy vince; righe senza asin non vengono
  // deduplicate (es. offerte non Amazon).
  const seenAsins = new Set();
  return rows
    .map((row) => {
      const post = postsByMsgId[row.message_id];
      if (!post) return null;
      return {
        docId: post.docId,
        channel: { chat: post.channel?.chat || null },
        country: post.country || null,
        date: post.date || null,
        payload: post.payload || null,
        views: row.views,
        forwards: row.forwards,
      };
    })
    .filter((entry) => {
      if (!entry) return false;
      const asin = entry.payload?.asin;
      if (!asin) return true;
      if (seenAsins.has(asin)) return false;
      seenAsins.add(asin);
      return true;
    });
};

const filterOutMultiPosts = async (firestore, channel, rows) => {
  if (rows.length === 0) return rows;

  const normalizedChat = channel.startsWith("@") ? channel : `@${channel.replace(/^@+/, "")}`;
  const messageIds = rows.map((r) => r.message_id).filter((id) => Number.isFinite(id));
  if (messageIds.length === 0) return rows;

  const multiIds = new Set();
  for (let i = 0; i < messageIds.length; i += FIRESTORE_IN_MAX) {
    const chunk = messageIds.slice(i, i + FIRESTORE_IN_MAX);
    const snapshot = await firestore
      .collection("posts")
      .where("channel.chat", "==", normalizedChat)
      .where("channel.telegramMessageId", "in", chunk)
      .where("multi", "==", true)
      .get();
    snapshot.docs.forEach((doc) => {
      const id = doc.get("channel.telegramMessageId");
      if (id != null) multiIds.add(Number(id));
    });
  }

  if (multiIds.size === 0) return rows;
  return rows.filter((r) => !multiIds.has(r.message_id));
};

module.exports = {
  normalizeChannel,
  getPostStatsByChannel,
  enrichStatsWithFirestore,
  filterOutMultiPosts,
};
