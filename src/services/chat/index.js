const path = require("path");
const config = require("../../config");
const { createQueryParser } = require("./query");
const { trackOpenAICost } = require("./usage");

const PROMPT_REQUEST_PATH = path.join(__dirname, "prompts", "promptRequest.txt");
const PROMPT_RESPONSE_PATH = path.join(__dirname, "prompts", "promptResponse.txt");

/**
 * Inizializza il runtime chat sopra le decoration di Fastify (openai, redis, amazon, pg).
 * Stato usage condiviso a livello di processo.
 */
const buildChatRuntime = (fastify) => {
  const usageState = { totalTokensUsed: 0, totalCost: 0 };
  const onUsage = (usage) => trackOpenAICost(usage, "gpt-4o-mini", usageState);

  const parseUserQuery = createQueryParser({
    openai: fastify.openai,
    promptPath: PROMPT_REQUEST_PATH,
    onUsage,
  });

  const enrichDeps = {
    redis: fastify.redis,
    amazon: fastify.amazon,
    pg: fastify.pg,
    log: fastify.log,
    store: config.defaults.store,
  };

  return {
    parseUserQuery,
    onUsage,
    usageState,
    enrichDeps,
    promptResponsePath: PROMPT_RESPONSE_PATH,
    indexName: config.meili.index,
    embedderName: config.meili.embedderName,
  };
};

module.exports = {
  buildChatRuntime,
  PROMPT_REQUEST_PATH,
  PROMPT_RESPONSE_PATH,
};
