const { runSearchPipeline } = require("../services/chat/pipeline");
const { handlePipelineResult } = require("../services/chat/handler");
const { resetSession } = require("../services/chat/session");
const { serializeProducts } = require("../services/chat/serializer");

module.exports = async function (fastify) {
  const chat = fastify.chat;

  fastify.delete("/chat/:sessionId", async (request, reply) => {
    const { sessionId } = request.params;
    if (!sessionId) {
      return reply.status(400).send({ error: "sessionId richiesto" });
    }
    try {
      await resetSession(fastify.redis, sessionId);
      return { ok: true };
    } catch (err) {
      fastify.log.error({ err }, "[chat] reset session error");
      return reply.status(500).send({ error: "Errore interno del server" });
    }
  });

  fastify.post("/chat", async (request, reply) => {
    const sessionId = (request.body?.sessionId ?? "").toString().trim();
    if (!sessionId) {
      return reply.status(400).send({ error: "sessionId richiesto" });
    }
    const question = (request.body?.question ?? "").toString().trim();
    if (!question) {
      return reply.status(400).send({ error: "question richiesta" });
    }

    try {
      const index = fastify.meili.index(chat.indexName);
      const { getSession } = require("../services/chat/session");
      const session = await getSession(fastify.redis, sessionId);
      const base = { sessionId };

      const searchResult = await runSearchPipeline(index, question, {
        embedderName: chat.embedderName,
        parseUserQuery: chat.parseUserQuery,
        limitDisplay: 5,
        limitFetch: 15,
        session,
        enrichDeps: chat.enrichDeps,
      });

      const handled = await handlePipelineResult(
        fastify.redis,
        sessionId,
        question,
        searchResult,
        {
          openai: fastify.openai,
          promptPath: chat.promptResponsePath,
          onUsage: chat.onUsage,
          botType: "webapi",
        },
      );

      if (handled.outcome === "not_relevant") {
        return { ...base, outcome: "not_relevant", message: handled.message };
      }
      if (handled.outcome === "no_results") {
        return { ...base, outcome: "no_results", message: handled.message };
      }
      if (handled.outcome === "results") {
        return {
          ...base,
          outcome: "results",
          assistantText: handled.assistantText,
          products: serializeProducts(handled.results?.hits ?? []),
        };
      }
      return reply.status(500).send({ ...base, error: "Errore interno del server" });
    } catch (err) {
      fastify.log.error({ err }, "[chat] POST /chat error");
      return reply.status(500).send({ sessionId, error: "Errore interno del server" });
    }
  });
};
