require("dotenv").config();

const { getAtPath } = require("./lib/utils");

const toInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const config = {
  port: parseInt(process.env.PORT, 10),
  redis: {
    url: process.env.REDIS_URL,
    ttl: {
      amazon: parseInt(process.env.REDIS_AMAZON_TTL_HOURS, 10) * 3600,
    },
  },
  postgres: {
    datafeeds: {
      url: process.env.POSTGRES_DATAFEEDS_URL,
    },
  },
  mysql: {
    telegramStats: {
      url: process.env.MYSQL_URL,
    },
  },
  amazon: {
    credentialId: process.env.AMAZON_CREDENTIAL_ID,
    credentialSecret: process.env.AMAZON_CREDENTIAL_SECRET,
    version: process.env.AMAZON_VERSION,
    stores: {
      it: {
        marketplace: "www.amazon.it",
        partnerTag: process.env.AMAZON_PARTNER_TAG_IT,
      },
    },
  },
  defaults: {
    store: process.env.DEFAULT_STORE,
    lang: process.env.DEFAULT_LANG,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    timeout: toInt(process.env.OPENAI_TIMEOUT_MS, 30_000),
  },
  meili: {
    host: process.env.MEILISEARCH_HOST,
    apiKey: process.env.MEILISEARCH_API_KEY,
    index: process.env.INDEX_NAME,
    embedderName: process.env.EMBEDDER_NAME,
    diversifyFetchLimit: toInt(process.env.MEILI_DIVERSIFY_FETCH_LIMIT, 25),
    shopFilter: process.env.MEILI_SHOP_FILTER || "amazon",
  },
  chat: {
    corsOrigin: process.env.CHAT_CORS_ORIGIN || "*",
  },
};

function configRequired(config, requiredPaths) {
  const missing = requiredPaths.filter((path) => {
    const value = getAtPath(config, path);
    if (value === undefined || value === null || value === "") return true;
    if (typeof value === "number" && Number.isNaN(value)) return true;
    return false;
  });
  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(", ")}`);
  }
}

configRequired(config, [
  "port",
  "redis.url",
  "redis.ttl.amazon",
  "amazon.credentialId",
  "amazon.credentialSecret",
  "amazon.version",
  "amazon.stores.it.partnerTag",
  "defaults.store",
  "postgres.datafeeds.url",
  "mysql.telegramStats.url",
  "openai.apiKey",
  "meili.host",
  "meili.index",
  "meili.embedderName",
]);

module.exports = config;
