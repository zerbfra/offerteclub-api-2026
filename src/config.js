require("dotenv").config();

const { getAtPath } = require("./lib/utils");

const toInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toBool = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
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
  firebase: {
    credentialsPath: process.env.FIREBASE_CREDENTIALS_PATH,
    credentialsJson: process.env.FIREBASE_CREDENTIALS_JSON,
  },
  yourlsStats: {
    url: process.env.DO_FUNCTIONS_URL,
    token: process.env.DO_FUNCTIONS_TOKEN,
  },
  datocms: {
    apiToken: process.env.DATOCMS_API_TOKEN,
    endpoint: process.env.DATOCMS_ENDPOINT || "https://graphql.datocms.com/",
    timeout: toInt(process.env.DATOCMS_TIMEOUT_MS, 10_000),
    cacheTtlSeconds: toInt(process.env.DATOCMS_CACHE_TTL_SECONDS, 300),
  },
  push: {
    adminToken: process.env.PUSH_ADMIN_TOKEN,
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
    listenerEnabled: toBool(process.env.PUSH_LISTENER_ENABLED, false),
    country: process.env.PUSH_COUNTRY || "it",
    idempotencyTtlSeconds: toInt(process.env.PUSH_IDEMPOTENCY_TTL_SECONDS, 7 * 24 * 3600),
    receiptDelaySeconds: toInt(process.env.PUSH_RECEIPT_DELAY_SECONDS, 15 * 60),
    receiptPollIntervalSeconds: toInt(process.env.PUSH_RECEIPT_POLL_INTERVAL_SECONDS, 60),
    payloadExcludeKeys: (process.env.PUSH_PAYLOAD_EXCLUDE_KEYS || "browseNodeChain,features,variations")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
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
  "yourlsStats.url",
  "yourlsStats.token",
]);

if (!config.firebase.credentialsJson && !config.firebase.credentialsPath) {
  throw new Error(
    "Missing Firebase credentials: set FIREBASE_CREDENTIALS_JSON (inline JSON) or FIREBASE_CREDENTIALS_PATH (file path)",
  );
}

module.exports = config;
