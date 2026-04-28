const {
  isValidEan,
  isValidAsin,
  toFloatOrNull,
  formatPriceDisplay,
} = require("../../../lib/utils");
const amazonService = require("../../amazon");
const {
  getDataFeedByEans,
  getAliexpressByEans,
} = require("../../datafeeds");
const { buildAmazonEnrichmentMap, buildDatafeedMaps } = require("./utils");

/**
 * Arricchisce i risultati Meilisearch con dati Amazon (CreatorsAPI) e datafeed (awin + aliexpress).
 * Chiamate dirette ai service locali — nessun HTTP self-call.
 *
 * @param {Array<Object>} hits
 * @param {{ redis, amazon, pg, log, store? }} deps
 * @returns {Promise<Array<Object>>}
 */
const enrichProducts = async (hits, deps = {}) => {
  if (!Array.isArray(hits) || hits.length === 0) return hits;

  const { redis, amazon, pg, log, store = "it" } = deps;
  if (!redis || !amazon || !pg) return hits;

  const enrichedHits = hits.map((h) => ({ ...h }));
  const amazonHits = [];
  const eanHits = [];

  enrichedHits.forEach((hit, index) => {
    if (hit._source === "promo") return;

    const shop = (hit.shop || "").toString().toLowerCase().trim();
    const asin = hit.asin;
    const ean = hit.ean;

    if (shop === "amazon" && isValidAsin(asin)) {
      amazonHits.push({ index, asin });
    }

    if (isValidEan(ean)) {
      eanHits.push({ index, ean, shop });
    }
  });

  const uniqueAmazonAsins = Array.from(new Set(amazonHits.map((h) => h.asin)));
  const uniqueEans = Array.from(new Set(eanHits.map((h) => h.ean)));

  if (uniqueAmazonAsins.length > 0) {
    try {
      const items = await amazonService.lookupByAsins(
        redis,
        amazon,
        { asins: uniqueAmazonAsins, store },
        log,
      );
      const map = buildAmazonEnrichmentMap(items);

      for (const { index, asin } of amazonHits) {
        const info = map.get(asin);
        if (!info) continue;

        const hit = enrichedHits[index];
        const updated = { ...hit };

        if (info.title) updated.title = info.title;
        if (info.price != null) {
          updated.price = info.price;
          const newDisplay = formatPriceDisplay(info.price, info.savingBasisAmount);
          if (newDisplay) updated.price_display = newDisplay;
        }
        const currentUrl = (hit.url || "").trim();
        if (!currentUrl || !/^https?:\/\//i.test(currentUrl)) {
          if (info.detailPageURL) updated.url = info.detailPageURL;
        }

        enrichedHits[index] = updated;
      }
    } catch (err) {
      (log?.warn || console.warn).call(log || console, "[chat-enrichment] amazon lookup fallita:", err.message || err);
    }
  }

  if (uniqueEans.length > 0) {
    try {
      const [awinData, aliexpressData] = await Promise.all([
        getDataFeedByEans(pg, uniqueEans),
        getAliexpressByEans(pg, uniqueEans),
      ]);
      const { byEan } = buildDatafeedMaps([...awinData, ...aliexpressData]);

      for (const { index, ean, shop: mainShop } of eanHits) {
        const hit = enrichedHits[index];
        const items = byEan.get(ean) || [];
        const mainShopLower = (mainShop || "").toString().toLowerCase().trim();

        const byStore = new Map();
        for (const item of items) {
          const itemStore = (item.store || "").toString().trim();
          if (!itemStore || itemStore.toLowerCase() === mainShopLower) continue;
          if (byStore.has(itemStore.toLowerCase())) continue;
          const priceDisplay = formatPriceDisplay(
            toFloatOrNull(item.search_price),
            toFloatOrNull(item.product_price_old),
          );
          const productUrl = (item.aw_deep_link ?? "").toString().trim();
          byStore.set(itemStore.toLowerCase(), {
            shop: itemStore,
            price_display: priceDisplay || null,
            url: productUrl && /^https?:\/\//i.test(productUrl) ? productUrl : null,
          });
        }
        const altShops = Array.from(byStore.values());

        const updated = { ...hit };
        if (altShops.length > 0) {
          updated.available_in_shops = altShops;
        }

        if (mainShop !== "amazon" && items.length > 0) {
          const match = items.find(
            (item) => (item.store || "").toString().toLowerCase().trim() === mainShop,
          );
          if (match) {
            const title = match.product_name || null;
            const currentPrice = toFloatOrNull(match.search_price);
            const oldPrice = toFloatOrNull(match.product_price_old);

            if (title) {
              updated.title = title;
            }
            if (currentPrice != null) {
              updated.price = currentPrice;
              const display = formatPriceDisplay(currentPrice, oldPrice);
              if (display) {
                updated.price_display = display;
              }
            }
          }
        }

        enrichedHits[index] = updated;
      }
    } catch (err) {
      (log?.warn || console.warn).call(log || console, "[chat-enrichment] datafeed fallita:", err.message || err);
    }
  }

  return enrichedHits;
};

module.exports = {
  enrichProducts,
};
