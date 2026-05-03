const { getPostStatsByChannel } = require("../services/telegram");

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

const parseLimit = (value) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

module.exports = async function (fastify) {
  // GET /api/telegram/stats/:channel?limit=100|date=YYYY-MM-DD — Stats post Telegram per canale.
  // Se passi date filtra solo i post di quel giorno (limit ignorato); altrimenti ritorna gli ultimi N.
  fastify.get("/telegram/stats/:channel", async (request) => {
    const { channel } = request.params;
    const { date } = request.query;
    const limit = date ? null : parseLimit(request.query.limit);
    const data = await getPostStatsByChannel(fastify.mysql, channel, { limit, date });
    return { status: 200, data };
  });
};
