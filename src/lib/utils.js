/** Legge un valore da un oggetto usando path in dot notation (es. "redis.ttl.amazon"). */
function getAtPath(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

/** Ricava lo store dalla richiesta (header x-store/country-code o default). */
function getStore(request, fastify) {
  return (
    request.headers["x-store"] || request.headers["country-code"] || fastify.config.defaults.store
  );
}

/** Spezza la stringa di EAN/ASIN/SKU (separati da virgola) in array di codici. */
function parseProductIds(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Costruisce l’oggetto filtri di ricerca a partire dalla query string. */
function buildSearchFilter(query) {
  return {
    browseNodeId: query.category,
    maxPrice: query.maxPrice,
    minPrice: query.minPrice,
    brand: query.brand,
    searchIndex: query.searchIndex,
  };
}

/**
 * Tronca testo a una lunghezza massima. Accetta stringa o array (join + tronca).
 */
const truncateText = (value, maxLength, options = {}) => {
  if (value == null) return null;
  const { arrayMaxItems } = options;
  let raw;
  if (Array.isArray(value)) {
    const slice = arrayMaxItems != null ? value.slice(0, arrayMaxItems) : value;
    raw = slice.join(" ").trim();
  } else {
    raw = typeof value === "string" ? value.trim() : String(value).trim();
  }
  if (!raw) return null;
  return raw.length <= maxLength ? raw : raw.slice(0, maxLength) + "...";
};

const withRetry = async (fn, options = {}) => {
  const { maxAttempts = 2, delayMs = 1000, isRetryable } = options;
  const shouldRetry =
    isRetryable ??
    ((err) =>
      (err.status >= 500 && err.status < 600) ||
      err.code === "ETIMEDOUT" ||
      err.code === "ECONNRESET");
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !shouldRetry(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
};

const isValidEan = (value) => {
  const s = (value ?? "").toString().trim();
  if (!s) return false;
  if (s === "undefined" || s === "000000000000") return false;
  return /^\d{8}$/.test(s) || /^\d{13}$/.test(s);
};

const isValidAsin = (value) => {
  const s = (value ?? "").toString().trim();
  return s.length > 0;
};

const toFloatOrNull = (value) => {
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
};

const formatPriceDisplay = (current, oldPrice) => {
  if (current == null) return null;
  const formattedCurrent = current.toFixed(2).replace(".", ",") + "€";
  if (oldPrice == null) return formattedCurrent;
  if (Math.abs(Number(current) - Number(oldPrice)) < 0.01) return formattedCurrent;
  const formattedOld = oldPrice.toFixed(2).replace(".", ",");
  return `${formattedCurrent} invece di ${formattedOld}`;
};

module.exports = {
  getAtPath,
  getStore,
  parseProductIds,
  buildSearchFilter,
  truncateText,
  withRetry,
  isValidEan,
  isValidAsin,
  toFloatOrNull,
  formatPriceDisplay,
};
