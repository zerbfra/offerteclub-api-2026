require("dotenv").config();

const { getAtPath } = require("./lib/utils");

const config = {
  port: parseInt(process.env.PORT, 10),
  redis: {
    url: process.env.REDIS_URL,
    ttl: {
      amazon: parseInt(process.env.REDIS_AMAZON_TTL_HOURS, 10) * 3600,
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
]);

module.exports = config;
