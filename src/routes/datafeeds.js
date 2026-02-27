const {
  getDataFeedByEans,
  getDataFeedByParam,
} = require("../services/datafeeds");

module.exports = async function (fastify) {
  // GET /datafeeds/ean/:eanList — Recupera prodotti dai datafeed per uno o più EAN (separati da virgola).
  fastify.get("/datafeeds/ean/:eanList", async (request) => {
    const eanList = request.params.eanList.split(",");
    const data = await getDataFeedByEans(eanList, request.query.store);
    return { status: 200, data };
  });

  // GET /datafeeds/:paramKey/:paramValue — Cerca nei datafeed per chiave/valore nel payload.
  fastify.get("/datafeeds/:paramKey/:paramValue", async (request) => {
    const { paramKey, paramValue } = request.params;
    const data = await getDataFeedByParam(paramKey, paramValue, request.query.store);
    return { status: 200, data };
  });
};
