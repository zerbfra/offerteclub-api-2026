const fp = require("fastify-plugin");
const config = require("../config");

process.env.OPENAI_LOG = "error";

const OpenAI = require("openai");

/** Registra il client OpenAI su Fastify. */
async function openaiPlugin(fastify) {
  const client = new OpenAI({
    apiKey: config.openai.apiKey,
    timeout: config.openai.timeout,
  });
  fastify.decorate("openai", client);
}

module.exports = fp(openaiPlugin, { name: "openai" });
