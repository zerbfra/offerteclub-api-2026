const { getDataFeedByEans, getDataFeedByParam, getAliexpressByEans } = require("../services/datafeeds");
const { parseProductIds } = require("../lib/utils");

module.exports = async function (fastify) {
  // GET /api/datafeeds/ean/:eans — Recupera prodotti dai datafeed per uno o più EAN (separati da virgola).
  fastify.get("/datafeeds/ean/:eans", async (request) => {
    const eans = parseProductIds(request.params.eans);
    const [awinData, aliexpressData] = await Promise.all([
      getDataFeedByEans(fastify.pg, eans),
      getAliexpressByEans(fastify.pg, eans),
    ]);
    return { status: 200, data: [...awinData, ...aliexpressData] };
  });

  // GET /api/datafeeds/:paramKey/:paramValue — Cerca nei datafeed per chiave/valore nel payload.
  fastify.get("/datafeeds/:paramKey/:paramValue", async (request) => {
    const { paramKey, paramValue } = request.params;
    const data = await getDataFeedByParam(fastify.pg, paramKey, paramValue, request.query.store);
    return { status: 200, data };
  });
};
