/** Legge un valore da un oggetto usando path in dot notation (es. "redis.ttl.amazon"). */
function getAtPath(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

/** Ricava lo store dalla richiesta (header x-store/country-code o default). */
function getStore(request, fastify) {
  return (
    request.headers["x-store"] ||
    request.headers["country-code"] ||
    fastify.config.defaults.store
  );
}

/** Spezza la stringa di ASIN (separati da virgola) in array di codici. */
function parseAsins(value) {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Costruisce l’oggetto filtri di ricerca a partire dalla query string. */
function buildSearchFilter(query) {
  return {
    browseNodeId: query.category,
    maxPrice: query.maxPrice,
    minPrice: query.minPrice,
    brand: query.brand,
    searchIndex: query.searchIndex,
    deliveryFlags: ["FulfilledByAmazon"],
  };
}

module.exports = { getAtPath, getStore, parseAsins, buildSearchFilter };
