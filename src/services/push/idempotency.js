const IDEMPOTENCY_KEY_PREFIX = "push:pushed:";

const idempotencyKey = (postId) => `${IDEMPOTENCY_KEY_PREFIX}${postId}`;

/**
 * Marca un post come già processato. Ritorna `true` se è la prima volta
 * (la chiave non esisteva), `false` se era già marcato. Usa SET NX con TTL.
 */
const markPushed = async (redis, postId, ttlSeconds) => {
  const result = await redis.set(idempotencyKey(postId), "1", "EX", ttlSeconds, "NX");
  return result === "OK";
};

module.exports = { markPushed };
