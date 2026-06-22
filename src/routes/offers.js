const { getTopOffers } = require("../services/offers");
const { withCache, cacheKey } = require("../lib/cache");

module.exports = async function (fastify) {
  // GET /api/offers/top — Top offerte aggregate dai click Yourls + dati Telegram da Firestore.
  // Query: period=today|yesterday|2days|week (default today), category=all|tech|casa|... (default all), limit (default 20, max 100).
  // Risultato in cache Redis per `redis.ttl.offersTop` secondi (chiave per period/category/limit).
  fastify.get("/offers/top", async (request) => {
    const { period, category, limit } = request.query;
    const key = cacheKey("offers:top", period || "today", category || "all", limit ?? "");
    const data = await withCache(fastify.redis, fastify.log, {
      key,
      ttlSeconds: fastify.config.redis.ttl.offersTop,
      fetch: () => getTopOffers(fastify.firestore, { period, category, limit }, fastify.log),
    });
    return { status: 200, data };
  });
};
