const {
  getAwinDatafeedByEans,
  searchAwinDatafeedByParam,
  getAmazonDealsByParam,
  getAliexpressByEans,
} = require("../services/datafeeds");
const { parseProductIds } = require("../lib/utils");

// Valida i parametri comuni delle route di ricerca. Se non validi invia la
// risposta 400 e ritorna null; altrimenti ritorna i valori normalizzati.
// La tokenizzazione (incl. il caso "parola corta → stringa contigua") è nel
// service via `searchTerms`: qui niente vincoli di lunghezza, mai 400 per i token.
function parseSearchQuery(request, reply) {
  const { field, q, store } = request.query;
  if (!field || !q) {
    reply.status(400).send({ status: 400, error: "field e q sono obbligatori" });
    return null;
  }
  const parsedLimit = Number.parseInt(request.query.limit, 10);
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
  return { field, q, store, limit };
}

module.exports = async function (fastify) {
  // GET /api/datafeeds/ean/:eans — Recupera prodotti dai datafeed per uno o più EAN (separati da virgola).
  fastify.get("/datafeeds/ean/:eans", async (request) => {
    const eans = parseProductIds(request.params.eans);
    const [awinData, aliexpressData] = await Promise.all([
      getAwinDatafeedByEans(fastify.pg, eans),
      getAliexpressByEans(fastify.pg, eans),
    ]);
    return { status: 200, data: [...awinData, ...aliexpressData] };
  });

  // GET /api/datafeeds/awin/search?field=<key>&q=<text>&store=<store>&limit=<n>
  // — Ricerca parziale (ILIKE %text%) su una chiave del payload awin. `store`
  // e `limit` opzionali.
  fastify.get("/datafeeds/awin/search", async (request, reply) => {
    const parsed = parseSearchQuery(request, reply);
    if (!parsed) return reply;
    const data = await searchAwinDatafeedByParam(
      fastify.pg,
      parsed.field,
      parsed.q,
      parsed.store,
      parsed.limit,
    );
    return { status: 200, data };
  });

  // GET /api/datafeeds/amazon-deals/search?field=<column>&q=<text>&limit=<n>&order=<dealPrice>&browseNode=<id>
  // — Deals Amazon, ricerca multi-parola (ILIKE in AND) sulla colonna
  // whitelisted. `limit` opzionale. `order=dealPrice` ordina per prezzo
  // decrescente, altrimenti per attinenza (default). `browseNode` (intero):
  // filtro esatto aggiuntivo su browseNodeId1. Ritorna solo i deal attivi
  // ora (now tra dealStartTime e dealEndTime).
  fastify.get("/datafeeds/amazon-deals/search", async (request, reply) => {
    const parsed = parseSearchQuery(request, reply);
    if (!parsed) return reply;
    const data = await getAmazonDealsByParam(
      fastify.pg,
      parsed.field,
      parsed.q,
      parsed.limit,
      request.query.order,
      request.query.browseNode,
    );
    return { status: 200, data };
  });
};
