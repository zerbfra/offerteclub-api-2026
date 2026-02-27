const { getDataFeedByEans, getDataFeedByParam } = require("../services/datafeeds");
const { parseProductIds } = require("../lib/utils");

module.exports = async function (fastify) {
  // GET /datafeeds/ean/:eans — Recupera prodotti dai datafeed per uno o più EAN (separati da virgola).
  fastify.get("/datafeeds/ean/:eans", async (request) => {
    const eans = parseProductIds(request.params.eans);
    const data = await getDataFeedByEans(eans, request.query.store);
    return { status: 200, data };
  });

  // GET /datafeeds/:paramKey/:paramValue — Cerca nei datafeed per chiave/valore nel payload.
  fastify.get("/datafeeds/:paramKey/:paramValue", async (request) => {
    const { paramKey, paramValue } = request.params;
    const data = await getDataFeedByParam(paramKey, paramValue, request.query.store);
    return { status: 200, data };
  });
};
