const amazonService = require("../services/amazon");
const { getStore, parseProductIds, buildSearchFilter } = require("../lib/utils");

module.exports = async function (fastify) {
  // GET /api/amazon/lookup/:asins — Recupera i dettagli dei prodotti per uno o più ASIN (separati da virgola).
  fastify.get("/amazon/lookup/:asins", async (request) => {
    const store = getStore(request, fastify);
    const asins = parseProductIds(request.params.asins);
    const data = await amazonService.lookupByAsins(
      fastify.redis,
      fastify.amazon,
      {
        asins,
        store,
      },
      fastify.log,
    );
    return { status: 200, data };
  });

  // GET /api/amazon/search/:keyword — Ricerca prodotti per parola chiave; supporta filtri (prezzo, categoria, brand), ordinamento e paginazione.
  fastify.get("/amazon/search/:keyword", async (request) => {
    const store = getStore(request, fastify);
    const filter = buildSearchFilter(request.query);
    const data = await amazonService.searchItems(fastify.redis, fastify.amazon, {
      store,
      keyword: request.params.keyword,
      filter,
      sortBy: request.query.sortBy,
      page: request.query.page,
    });
    return { status: 200, data: data || {} };
  });
};
