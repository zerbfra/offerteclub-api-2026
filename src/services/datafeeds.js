const { searchTerms } = require("../lib/utils");

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

const getAwinDatafeedByEans = async (pg, eanList) => {
  const awinRes = await pg("awin").whereIn("ean", eanList);
  return awinRes.map(formatRow);
};

const assertValidParamKey = (paramKey) => {
  if (!ALLOWED_PARAM_KEY.test(paramKey)) {
    const err = new Error(`Invalid param key: ${paramKey}`);
    err.statusCode = 400;
    throw err;
  }
};

// Campi "promossi" a colonna reale (generated da payload) con indice trigram:
// la ricerca li interroga direttamente sulla colonna (usa l'indice) invece di
// `payload->>`. Gli altri restano sul fallback JSON.
const PROMOTED_COLUMNS = new Set(["product_name"]);

// Ricerca multi-parola case-insensitive. `searchTerms` decide gli operandi
// ILIKE (in AND): più parole "lunghe" → un match per parola, ordine
// indifferente ("dreame lavapavimenti" trova "lavapavimenti dreame"); se c'è
// una parola corta (< 3 char, es. "iphone 17") → unica stringa contigua.
// Attinenza con `word_similarity(query, testo)` (non penalizza i titoli lunghi
// come `similarity()`). Dedup per `ean` tenendo il `search_price` più basso.
// `limit`, se presente, è il MAX per negozio (top-N per `store`); senza filtro
// store ogni negozio è rappresentato, con `?store=` resta limite totale.
const searchAwinDatafeedByParam = async (pg, paramKey, paramValue, store, limit) => {
  assertValidParamKey(paramKey);

  // `colSql` è una costante hardcoded (no injection): l'identifier passa dal
  // binding `??` (quotato da Knex), il resto dal binding `?`.
  const colSql = PROMOTED_COLUMNS.has(paramKey) ? "??" : "payload->>?";
  const terms = searchTerms(paramValue);
  if (!terms.length) return [];

  // 1) filtro per token + store, con prezzo numerico (cast guardato da regex
  //    per non far esplodere la query su valori sporchi) e score di attinenza.
  const filtered = pg("awin")
    .select("awin.*")
    // Regex SENZA `?`: Knex tratterebbe il `?` come placeholder di binding.
    // `{0,1}` = parte decimale opzionale.
    .select(
      pg.raw(
        "CASE WHEN payload->>'search_price' ~ '^[0-9]+(\\.[0-9]+){0,1}$' " +
          "THEN (payload->>'search_price')::numeric END AS _price",
      ),
    )
    .select(pg.raw(`word_similarity(?, ${colSql}) AS _score`, [paramValue, paramKey]))
    // EAN dalla stessa fonte della response (formatRow usa payload->>'ean',
    // non la colonna `ean`). NULLIF: stringa vuota = nessun ean.
    .select(pg.raw("NULLIF(payload->>'ean','') AS _ean"));
  if (store) filtered.where({ store });
  for (const term of terms) {
    filtered.whereRaw(`${colSql} ILIKE ?`, [paramKey, `%${term}%`]);
  }

  // 2) dedup per ean (prezzo più basso). I record senza ean restano tutti.
  // 3) rank per attinenza dentro ogni negozio.
  let query = pg
    .with("filtered", filtered)
    .with("deduped", (qb) =>
      qb
        .select("*")
        .select(
          pg.raw(
            "row_number() OVER (PARTITION BY _ean ORDER BY _price ASC NULLS LAST) AS _ean_rn",
          ),
        )
        .from("filtered"),
    )
    .with("ranked", (qb) =>
      qb
        .select("*")
        .select(
          pg.raw("row_number() OVER (PARTITION BY store ORDER BY _score DESC) AS _store_rn"),
        )
        .from("deduped")
        .whereRaw("_ean_rn = 1 OR _ean IS NULL"),
    )
    .select("*")
    .from("ranked")
    .orderByRaw("_score DESC, store");

  if (limit) query = query.whereRaw("_store_rn <= ?", [limit]);

  const content = await query;
  return content.map(formatRow);
};

const getAliexpressByEans = async (pg, eanList) => {
  const rows = await pg("aliexpress").whereIn("ean", eanList);
  return rows.map(formatAliexpressRow);
};

// View che arricchisce i deal con le info di all_feeds_standard (match per
// asin, INNER: i deal senza asin in all_feeds_standard non compaiono).
const DEALS_VIEW = "amazon_deals_enriched";

// `field` finisce come nome colonna in SQL: whitelist obbligatoria (no
// injection). Include sia le colonne del deal sia i campi di all_feeds_standard
// esposti (coi loro nomi originali) dalla view amazon_deals_enriched.
const DEALS_COLUMNS = new Set([
  "dealID",
  "dealType",
  "dealState",
  "category",
  "asin",
  "dealTitle",
  "dealStartTime",
  "dealEndTime",
  "referencePrice",
  "referencePriceType",
  "dealPrice",
  "discountString",
  "dealURL",
  "imageURL",
  "browseNodeId1",
  "subcategoryPath1",
  "browseNodeId2",
  "subcategoryPath2",
  "marketingMessage",
  "browseNode1",
  "browseNode2",
  "ean",
  "itemIsFBA",
  "itemPrice",
  "largeImageURL",
  "listPrice",
  "salesRank",
  "title",
  "feed_name",
]);

const formatDealRow = (row) => ({
  dealId: row.dealID,
  dealType: row.dealType,
  dealState: row.dealState,
  category: row.category,
  asin: row.asin,
  dealTitle: row.dealTitle,
  dealStartTime: row.dealStartTime,
  dealEndTime: row.dealEndTime,
  referencePrice: row.referencePrice,
  referencePriceType: row.referencePriceType,
  dealPrice: row.dealPrice,
  discountString: row.discountString,
  dealURL: row.dealURL,
  imageURL: row.imageURL,
  browseNodeId1: row.browseNodeId1,
  subcategoryPath1: row.subcategoryPath1,
  browseNodeId2: row.browseNodeId2,
  subcategoryPath2: row.subcategoryPath2,
  marketingMessage: row.marketingMessage,
  standard: {
    browseNode1: row.browseNode1,
    browseNode2: row.browseNode2,
    ean: row.ean,
    itemIsFBA: row.itemIsFBA,
    itemPrice: row.itemPrice,
    largeImageURL: row.largeImageURL,
    listPrice: row.listPrice,
    salesRank: row.salesRank,
    title: row.title,
    feed_name: row.feed_name,
  },
});

// Ricerca deals Amazon (sulla view arricchita) per colonna/valore. Multi-parola
// case-insensitive via `searchTerms` (operandi in AND): parole lunghe → match
// per parola, ordine indifferente; parola corta (< 3 char, es. "iphone 17") →
// unica stringa contigua.
// `::text` così funziona anche su colonne numeriche (category, prezzi,
// browseNodeId). `??` quota l'identifier (preserva il case di es. dealID).
// `field` accetta sia le colonne del deal sia i campi di all_feeds_standard
// coi loro nomi originali (whitelist DEALS_COLUMNS).
// Ritorna SOLO i deal attivi ora: now() dentro [dealStartTime, dealEndTime).
// I deal con finestra NULL (date mancanti nel feed) sono esclusi.
// Ordinamento: `order="dealPrice"` → prezzo decrescente (NULLS LAST);
// qualsiasi altro valore/assente → default per attinenza
// `word_similarity(q, field)` DESC (come la ricerca awin). `limit` opzionale.
// `browseNode`: filtro esatto aggiuntivo su browseNodeId1. Uno o più id
// separati da virgola (`460078031,5715226031` → IN); i valori non interi
// vengono ignorati.
const getAmazonDealsByParam = async (pg, field, q, limit, order, browseNode) => {
  if (!DEALS_COLUMNS.has(field)) {
    const err = new Error(`Invalid field: ${field}`);
    err.statusCode = 400;
    throw err;
  }

  const terms = searchTerms(q);
  if (!terms.length) return [];

  const nodeFilter = String(browseNode ?? "")
    .split(",")
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n));

  const rows = await pg(DEALS_VIEW).modify((qb) => {
    for (const term of terms) {
      qb.whereRaw("??::text ILIKE ?", [field, `%${term}%`]);
    }
    if (nodeFilter.length) qb.whereIn("browseNodeId1", nodeFilter);
    qb.whereRaw('now() >= "dealStartTime" AND now() < "dealEndTime"');
    if (order === "dealPrice") {
      qb.orderByRaw('"dealPrice" DESC NULLS LAST');
    } else {
      qb.orderByRaw("word_similarity(?, ??::text) DESC", [q, field]);
    }
    if (limit) qb.limit(limit);
  });
  return rows.map(formatDealRow);
};

module.exports = {
  getAwinDatafeedByEans,
  searchAwinDatafeedByParam,
  getAmazonDealsByParam,
  getAliexpressByEans,
};
