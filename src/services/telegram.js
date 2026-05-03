const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

const getPostStatsByChannel = async (mysql, channel, { limit, date, sortBy } = {}) => {
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

  const sortKey = sortBy ? SORT_BY_MAP[sortBy] : "post_date";
  if (sortBy && !sortKey) {
    const err = new Error(
      `Invalid sortBy, allowed: ${Object.keys(SORT_BY_MAP).join(", ")}`,
    );
    err.statusCode = 400;
    throw err;
  }

  const query = mysql("post_stats")
    .where({ channel: normalized })
    .orderBy(sortKey, "desc")
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
