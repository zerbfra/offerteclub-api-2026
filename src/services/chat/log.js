const KEY_PREFIX = "log:";

const buildKey = (botType, userId) => `${KEY_PREFIX}${botType}:${userId}`;

const serializeProductsLog = (hits) => {
  if (!Array.isArray(hits)) return [];
  return hits.map((hit) => ({
    title: hit.title ?? null,
    ean:
      hit.ean && String(hit.ean).trim() && hit.ean !== "undefined" ? String(hit.ean).trim() : null,
    asin: hit.asin ?? null,
  }));
};

const appendLogTurn = async (redis, userId, botType, { question, outcome, answer, products }) => {
  if (!userId || !botType) return;
  try {
    const key = buildKey(botType, userId);
    const now = new Date().toISOString();

    const raw = await redis.get(key);
    const log = raw
      ? JSON.parse(raw)
      : { botType, userId, startedAt: now, updatedAt: now, turns: [] };

    log.updatedAt = now;
    log.turns.push({
      at: now,
      question,
      outcome,
      answer: answer ?? null,
      products: serializeProductsLog(products),
    });

    await redis.set(key, JSON.stringify(log));
  } catch (err) {
    console.warn("[chat-log] appendLogTurn failed (soft-fail):", err.message);
  }
};

const getLog = async (redis, userId, botType) => {
  if (!userId || !botType) return null;
  try {
    const raw = await redis.get(buildKey(botType, userId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn("[chat-log] getLog failed:", err.message);
    return null;
  }
};

const clearLog = async (redis, userId, botType) => {
  if (!userId || !botType) return;
  try {
    await redis.del(buildKey(botType, userId));
  } catch (err) {
    console.warn("[chat-log] clearLog failed:", err.message);
  }
};

module.exports = {
  appendLogTurn,
  getLog,
  clearLog,
  serializeProductsLog,
};
