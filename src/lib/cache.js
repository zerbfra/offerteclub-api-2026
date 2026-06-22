// Cache-aside generica su Redis (stessa filosofia del `datoCached` di cms.js,
// ma riusabile e con chiave dinamica). `withCache` prova a leggere `key`: se
// presente, ritorna il valore deserializzato; altrimenti esegue `fetch()`,
// scrive il risultato con TTL (EX) e lo ritorna.
//
// Gli errori Redis NON sono mai fatali: si degrada a una fetch diretta e si
// logga a warn. Gli errori di `fetch()` invece propagano (li gestisce
// l'error handler Fastify, es. statusCode 400/502) e NON finiscono in cache,
// così non si "avvelena" la cache con risposte d'errore.

/** Compone una chiave cache da segmenti, normalizzando null/undefined a stringa vuota. */
const cacheKey = (...parts) => parts.map((p) => (p == null ? "" : String(p))).join(":");

/** Ritorna il valore da cache, oppure lo calcola con `fetch()` e lo memorizza con TTL. */
async function withCache(redis, log, { key, ttlSeconds, fetch }) {
  try {
    const cached = await redis.get(key);
    if (cached != null) return JSON.parse(cached);
  } catch (err) {
    log.warn({ err, key }, "cache: lettura Redis fallita");
  }

  const value = await fetch();

  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    log.warn({ err, key }, "cache: scrittura Redis fallita");
  }

  return value;
}

module.exports = { withCache, cacheKey };
