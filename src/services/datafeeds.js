const pg = require("../plugins/postgres")(process.env.POSTGRES_DATAFEEDS_URL);

const ALLOWED_PARAM_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const getDataFeedByEans = async (eanList, store) => {
  if (store !== "amazon") {
    const awinRes = await pg("awin").whereIn("ean", eanList);
    return awinRes;
  }

  // TODO: gestire il feed amazon
  return [];
};

const getDataFeedByParam = async (paramKey, paramValue, store) => {
  if (!ALLOWED_PARAM_KEY.test(paramKey)) {
    const err = new Error(`Invalid param key: ${paramKey}`);
    err.statusCode = 400;
    throw err;
  }

  const content = await pg("awin")
    .where({ store })
    .modify((queryBuilder) => {
      if (paramValue && paramKey) {
        queryBuilder.whereRaw(`payload->>'${paramKey}' = ?`, paramValue);
      }
    });

  return content;
};

module.exports = {
  getDataFeedByEans,
  getDataFeedByParam,
};
