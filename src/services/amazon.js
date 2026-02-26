const { chunk } = require("lodash");
const amazonLib = require("../lib/amazon");
const config = require("../config");

const CHUNK_SIZE = 10;

/** Recupera prodotti per ASIN: prima da Redis, poi da API Amazon; aggiorna la cache. */
async function lookupByAsins(redis, amazon, { asins, store }, log) {
  const storeConfig = config.amazon.stores[store] || config.amazon.stores[config.defaults.store];
  const { marketplace, partnerTag } = storeConfig;
  const ttl = config.redis.ttl.amazon;

  const keys = asins.map((asin) => `amazon_${store}:${asin}`);
  const cached = await redis.mget(keys);

  const hits = {};
  const misses = [];

  asins.forEach((asin, i) => {
    if (cached[i]) {
      hits[asin] = JSON.parse(cached[i]);
    } else {
      misses.push(asin);
    }
  });

  const fetched = [];
  for (const batch of chunk(misses, CHUNK_SIZE)) {
    try {
      const result = await amazonLib.getItems(amazon, {
        marketplace,
        partnerTag,
        itemIds: batch,
      });
      if (result?.itemsResult?.items) {
        fetched.push(...result.itemsResult.items);
      }
      if (result?.errors?.length) {
        result.errors.forEach((e) =>
          log.warn({ code: e.code }, `Amazon partial error: ${e.message}`),
        );
      }
    } catch (err) {
      log.error({ err, batch }, "Amazon getItems error");
    }
  }

  if (fetched.length > 0) {
    const pipeline = redis.pipeline();
    fetched.forEach((item) => {
      if (item.asin) {
        pipeline.set(`amazon_${store}:${item.asin}`, JSON.stringify(item), "EX", ttl);
      }
    });
    await pipeline.exec();
  }

  return [...Object.values(hits), ...fetched];
}

/** Esegue una ricerca prodotti su Amazon con filtri, ordinamento e paginazione. */
async function searchItems(redis, amazon, { store, keyword, filter = {}, sortBy, page }) {
  const storeConfig = config.amazon.stores[store] || config.amazon.stores[config.defaults.store];
  const { marketplace, partnerTag } = storeConfig;

  const itemPage = page != null ? parseInt(String(page), 10) : 1;
  const maxPrice = filter.maxPrice != null ? parseInt(String(filter.maxPrice), 10) : undefined;
  const minPrice = filter.minPrice != null ? parseInt(String(filter.minPrice), 10) : undefined;

  const result = await amazonLib.searchItems(amazon, {
    marketplace,
    partnerTag,
    keywords: keyword,
    searchIndex: filter.searchIndex,
    itemCount: 10,
    itemPage: Number.isNaN(itemPage) ? 1 : itemPage,
    sortBy: sortBy || "Relevance",
    browseNodeId: filter.browseNodeId,
    maxPrice,
    minPrice,
    brand: filter.brand,
    deliveryFlags: filter.deliveryFlags || ["FulfilledByAmazon"],
  });

  return result;
}

module.exports = { lookupByAsins, searchItems };
