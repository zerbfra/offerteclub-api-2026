const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

const getPostStatsByChannel = async (mysql, channel, { limit, date } = {}) => {
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

  const query = mysql("post_stats")
    .where({ channel: normalized })
    .orderBy("post_date", "desc")
    .orderBy("message_id", "desc");

  if (date) {
    query.whereRaw("DATE(post_date) = ?", [date]);
  }
  if (limit) {
    query.limit(limit);
  }

  const rows = await query;
  return rows.map(formatRow);
};

module.exports = {
  normalizeChannel,
  getPostStatsByChannel,
};
