const {
  getPostStatsByChannel,
  enrichStatsWithFirestore,
  filterOutMultiPosts,
  normalizeChannel,
} = require("../services/telegram");
const { withCache, cacheKey } = require("../lib/cache");

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const MAX_HOURS = 24 * 365;

const parseLimit = (value) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

const parseHours = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, MAX_HOURS);
};

module.exports = async function (fastify) {
  // GET /api/telegram/stats/:channel?limit=100|date=YYYY-MM-DD|hours=24&sortBy=date|views|forwards|reactions
  // - date  → filtra i post DA quel giorno in poi (limit ignorato).
  // - hours → filtra i post delle ultime N ore (combinabile con limit).
  // - altrimenti → ultimi N post.
  // sortBy default = date (post_date desc).
  // Risultato in cache Redis per `redis.ttl.telegramStats` secondi. La chiave
  // copre tutti i parametri che cambiano l'output (canale normalizzato, limit,
  // date, hours, sortBy, full): richieste identiche condividono la stessa entry.
  fastify.get("/telegram/stats/:channel", async (request) => {
    const { channel } = request.params;
    const { date, sortBy, full } = request.query;
    const hours = parseHours(request.query.hours);
    const limit = date ? null : parseLimit(request.query.limit);
    const isFull = full === "true" || full === "1";

    const key = cacheKey(
      "telegram:stats",
      normalizeChannel(channel),
      `l=${limit ?? ""}`,
      `d=${date ?? ""}`,
      `h=${hours ?? ""}`,
      `s=${sortBy ?? ""}`,
      `f=${isFull ? 1 : 0}`,
    );

    const data = await withCache(fastify.redis, fastify.log, {
      key,
      ttlSeconds: fastify.config.redis.ttl.telegramStats,
      fetch: async () => {
        let rows = await getPostStatsByChannel(fastify.mysql, channel, {
          limit,
          date,
          hours,
          sortBy,
        });
        rows = await filterOutMultiPosts(fastify.firestore, channel, rows);
        if (isFull) {
          rows = await enrichStatsWithFirestore(fastify.firestore, channel, rows);
        }
        return rows;
      },
    });

    return { status: 200, data };
  });
};
