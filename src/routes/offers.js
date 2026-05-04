const { getTopOffers } = require("../services/offers");

module.exports = async function (fastify) {
  // GET /api/offers/top — Top offerte aggregate dai click Yourls + dati Telegram da Firestore.
  // Query: period=today|yesterday|2days|week (default today), category=all|tech|casa|... (default all), limit (default 20, max 100).
  fastify.get("/offers/top", async (request) => {
    const { period, category, limit } = request.query;
    const data = await getTopOffers(
      fastify.firestore,
      { period, category, limit },
      fastify.log,
    );
    return { status: 200, data };
  });
};
