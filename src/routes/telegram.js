const { getPostStatsByChannel } = require("../services/telegram");

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

const parseLimit = (value) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

module.exports = async function (fastify) {
  // GET /api/telegram/stats/:channel?limit=100 — Ultimi N post stats di un canale Telegram (con o senza prefisso @).
  fastify.get("/telegram/stats/:channel", async (request) => {
    const { channel } = request.params;
    const limit = parseLimit(request.query.limit);
    const data = await getPostStatsByChannel(fastify.mysql, channel, limit);
    return { status: 200, data };
  });
};
