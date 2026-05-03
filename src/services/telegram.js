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

const getPostStatsByChannel = async (mysql, channel, limit) => {
  const normalized = normalizeChannel(channel);
  if (!normalized) {
    const err = new Error("Channel is required");
    err.statusCode = 400;
    throw err;
  }

  const rows = await mysql("post_stats")
    .where({ channel: normalized })
    .orderBy("post_date", "desc")
    .orderBy("message_id", "desc")
    .limit(limit);

  return rows.map(formatRow);
};

module.exports = {
  normalizeChannel,
  getPostStatsByChannel,
};
