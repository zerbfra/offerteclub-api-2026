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

const formatAliexpressRow = (row) => {
  const p = row.payload ?? {};
  return {
    id: row.id,
    store: row.store,
    ean: p.gtin || p.eanCode || null,
    brand_name: p.Brand || null,
    product_name: p.Titolo || null,
    search_price: p["Prezzo Scontato con IVA"] || null,
    product_price_old: p["Prezzo con IVA"] || null,
    aw_deep_link: p.link || null,
    aw_product_id: p.Prodotto || null,
    aw_image_url: p[" Immagine link"] || null,
    merchant_image_url: p.imageWhite || null,
    merchant_product_id: p.skuId || null,
    merchant_category: p["Categoria prodotto"] || null,
    product_GTIN: p.gtin || null,
  };
};

const getDataFeedByEans = async (pg, eanList) => {
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

const getAliexpressByEans = async (pg, eanList) => {
  const rows = await pg("aliexpress").whereIn("ean", eanList);
  return rows.map(formatAliexpressRow);
};

module.exports = {
  getDataFeedByEans,
  getDataFeedByParam,
  getAliexpressByEans,
};
