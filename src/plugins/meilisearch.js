const fp = require("fastify-plugin");
const { MeiliSearch } = require("meilisearch");
const config = require("../config");

/** Registra il client Meilisearch su Fastify. */
async function meilisearchPlugin(fastify) {
  const client = new MeiliSearch({
    host: config.meili.host,
    apiKey: config.meili.apiKey,
  });
  fastify.decorate("meili", client);
}

module.exports = fp(meilisearchPlugin, { name: "meilisearch" });
