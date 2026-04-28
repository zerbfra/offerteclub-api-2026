const SESSION_TTL_SECONDS = 30 * 60;
const KEY_PREFIX = "session:";

const DEFAULT_SESSION = {
  queryResponseId: null,
  formatResponseId: null,
  lastParsedQuery: null,
};

const getSession = async (redis, userId) => {
  const data = await redis.get(KEY_PREFIX + userId);
  if (data) {
    await redis.expire(KEY_PREFIX + userId, SESSION_TTL_SECONDS);
    return JSON.parse(data);
  }
  return { ...DEFAULT_SESSION };
};

const resetSession = async (redis, userId) => {
  await redis.del(KEY_PREFIX + userId);
};

const updateSession = async (redis, userId, updates) => {
  const current = await getSession(redis, userId);
  if (updates.queryResponseId !== undefined) current.queryResponseId = updates.queryResponseId;
  if (updates.formatResponseId !== undefined) current.formatResponseId = updates.formatResponseId;
  if (updates.lastParsedQuery !== undefined) current.lastParsedQuery = updates.lastParsedQuery;
  await redis.set(KEY_PREFIX + userId, JSON.stringify(current), "EX", SESSION_TTL_SECONDS);
};

module.exports = {
  getSession,
  resetSession,
  updateSession,
};
