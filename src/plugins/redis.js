const fp = require("fastify-plugin");
const Redis = require("ioredis");
const config = require("../config");

/** Registra il client Redis su Fastify e gestisce la chiusura all’onClose. */
async function redisPlugin(fastify) {
  const client = new Redis(config.redis.url);
  client.on("error", (err) => fastify.log.error({ err }, "redis error"));
  fastify.decorate("redis", client);
  fastify.addHook("onClose", async () => client.quit());
}

module.exports = fp(redisPlugin, { name: "redis" });
