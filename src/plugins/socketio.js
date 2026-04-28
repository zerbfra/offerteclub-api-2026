const fp = require("fastify-plugin");
const { Server } = require("socket.io");
const config = require("../config");
const { runSearchPipeline } = require("../services/chat/pipeline");
const { handlePipelineResult } = require("../services/chat/handler");
const { getSession, resetSession } = require("../services/chat/session");
const { serializeProducts } = require("../services/chat/serializer");

const setupHandlers = (io, fastify) => {
  const chat = fastify.chat;

  io.on("connection", (socket) => {
    fastify.log.info(`[socket] connected: ${socket.id}`);

    socket.on("chat:send", async ({ sessionId, question } = {}) => {
      if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
        return socket.emit("chat:error", { message: "sessionId richiesto" });
      }
      if (!question || typeof question !== "string" || !question.trim()) {
        return socket.emit("chat:error", { message: "question richiesta" });
      }

      const sid = sessionId.trim();
      const q = question.trim();

      try {
        const index = fastify.meili.index(chat.indexName);
        const session = await getSession(fastify.redis, sid);

        const searchResult = await runSearchPipeline(index, q, {
          embedderName: chat.embedderName,
          parseUserQuery: chat.parseUserQuery,
          limitDisplay: 5,
          limitFetch: 15,
          session,
          enrichDeps: chat.enrichDeps,
        });

        socket.emit("chat:searching", {
          parsedQuery: {
            searchQuery: searchResult.parsedQuery.searchQuery,
            filters: searchResult.parsedQuery.filters || null,
            intentType: searchResult.parsedQuery.intentType,
            explanation: searchResult.parsedQuery.explanation,
            isRelevant: searchResult.parsedQuery.isRelevant,
          },
        });

        const handled = await handlePipelineResult(fastify.redis, sid, q, searchResult, {
          openai: fastify.openai,
          promptPath: chat.promptResponsePath,
          onUsage: chat.onUsage,
          onChunk: (chunk) => {
            socket.emit("chat:chunk", { text: chunk });
          },
          botType: "webapi",
        });

        if (handled.outcome === "not_relevant") {
          socket.emit("chat:result", {
            outcome: "not_relevant",
            assistantText: handled.message,
            products: [],
          });
        } else if (handled.outcome === "no_results") {
          socket.emit("chat:result", {
            outcome: "no_results",
            assistantText: handled.message,
            products: [],
          });
        } else {
          socket.emit("chat:result", {
            outcome: "results",
            assistantText: handled.assistantText,
            products: serializeProducts(handled.results?.hits ?? []),
          });
        }
      } catch (err) {
        fastify.log.error({ err }, "[socket] chat:send error");
        socket.emit("chat:error", { message: "Errore interno del server" });
      }
    });

    socket.on("chat:reset", async ({ sessionId } = {}) => {
      if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
        return socket.emit("chat:error", { message: "sessionId richiesto" });
      }
      try {
        await resetSession(fastify.redis, sessionId.trim());
        socket.emit("chat:reset:done", { ok: true });
      } catch (err) {
        fastify.log.error({ err }, "[socket] reset session error");
        socket.emit("chat:error", { message: "Errore reset sessione" });
      }
    });

    socket.on("disconnect", () => {
      fastify.log.info(`[socket] disconnected: ${socket.id}`);
    });
  });
};

/**
 * Attacca Socket.IO al server HTTP di Fastify.
 * Dipende da fastify.chat (plugin chat) → openai → meili → redis.
 */
async function socketioPlugin(fastify) {
  let io;

  fastify.addHook("onReady", async () => {
    io = new Server(fastify.server, {
      cors: {
        origin: config.chat.corsOrigin,
        methods: ["GET", "POST"],
      },
    });
    fastify.decorate("io", io);
    setupHandlers(io, fastify);
  });

  fastify.addHook("onClose", async () => {
    if (io) await new Promise((resolve) => io.close(resolve));
  });
}

module.exports = fp(socketioPlugin, { name: "socketio", dependencies: ["chat", "meilisearch"] });
