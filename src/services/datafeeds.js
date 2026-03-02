const ALLOWED_PARAM_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const PAYLOAD_FIELDS = [
  "ean",
  "brand_name",
  "product_name",
  "search_price",
  "product_price_old",
  "aw_deep_link",
  "aw_product_id",
  "aw_image_url",
  "merchant_image_url",
  "merchant_product_id",
  "merchant_category",
  "product_GTIN",
];

const formatRow = (row) => ({
  id: row.id,
  store: row.store,
  ...Object.fromEntries(PAYLOAD_FIELDS.map((key) => [key, row.payload?.[key] ?? null])),
});

const getDataFeedByEans = async (pg, eanList, store) => {
  if (store === "amazon") {
    const err = new Error("Amazon datafeed not implemented");
    err.statusCode = 501;
    throw err;
  }

  const awinRes = await pg("awin").whereIn("ean", eanList);
  return awinRes.map(formatRow);
};

const getDataFeedByParam = async (pg, paramKey, paramValue, store) => {
  if (!ALLOWED_PARAM_KEY.test(paramKey)) {
    const err = new Error(`Invalid param key: ${paramKey}`);
    err.statusCode = 400;
    throw err;
  }

  const content = await pg("awin")
    .where({ store })
    .modify((queryBuilder) => {
      if (paramKey && paramValue) {
        queryBuilder.whereRaw("payload->>? = ?", [paramKey, paramValue]);
      }
    });

  return content.map(formatRow);
};

module.exports = {
  getDataFeedByEans,
  getDataFeedByParam,
};
