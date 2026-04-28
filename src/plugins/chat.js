const fp = require("fastify-plugin");
const { buildChatRuntime } = require("../services/chat");

/**
 * Inizializza il runtime chat (parser query, usage tracker, enrichment deps, paths)
 * e lo decora su fastify.chat. Richiede openai, redis, amazon, postgres.
 */
async function chatPlugin(fastify) {
  const runtime = buildChatRuntime(fastify);
  fastify.decorate("chat", runtime);
}

module.exports = fp(chatPlugin, {
  name: "chat",
  dependencies: ["openai", "redis", "amazon", "postgres"],
});
