const { isValidEan, isValidAsin, toFloatOrNull, formatPriceDisplay } = require("../../../lib/utils");

/**
 * Trasforma il risultato di amazonService.lookupByAsins (array di item Amazon)
 * in una mappa { asin → { title, price, savingBasisAmount, price_display, detailPageURL } }.
 */
const buildAmazonEnrichmentMap = (items) => {
  const map = new Map();
  if (!Array.isArray(items)) return map;

  for (const item of items) {
    const asin = item?.asin;
    if (!isValidAsin(asin)) continue;

    const title = item?.itemInfo?.title?.displayValue || null;
    const listing = Array.isArray(item?.offersV2?.listings) ? item.offersV2.listings[0] : null;

    const priceAmount = toFloatOrNull(listing?.price?.money?.amount);
    const displayAmount = listing?.price?.money?.displayAmount || null;
    const savingBasisAmount = toFloatOrNull(listing?.price?.savingBasis?.amount);

    const price =
      priceAmount != null
        ? priceAmount
        : toFloatOrNull(displayAmount?.replace(/[^\d.,]/g, "").replace(",", "."));

    const priceDisplay =
      displayAmount || (price != null ? formatPriceDisplay(price, savingBasisAmount) : null);

    const detailPageURL = (item?.detailPageURL ?? "").toString().trim();
    const url = detailPageURL && /^https?:\/\//i.test(detailPageURL) ? detailPageURL : null;

    map.set(asin, {
      title: title || null,
      price,
      savingBasisAmount,
      price_display: priceDisplay,
      detailPageURL: url,
    });
  }

  return map;
};

/**
 * Trasforma il risultato di datafeedService (awin + aliexpress concatenati)
 * in mappe { ean → [items] } e { ean → Set<store> }.
 */
const buildDatafeedMaps = (rows) => {
  const byEan = new Map();
  const shopsByEan = new Map();
  if (!Array.isArray(rows)) return { byEan, shopsByEan };

  for (const item of rows) {
    const ean = (item?.ean ?? "").toString().trim();
    if (!isValidEan(ean)) continue;

    if (!byEan.has(ean)) {
      byEan.set(ean, []);
      shopsByEan.set(ean, new Set());
    }

    byEan.get(ean).push(item);

    if (item.store) {
      shopsByEan.get(ean).add(item.store);
    }
  }

  return { byEan, shopsByEan };
};

module.exports = {
  buildAmazonEnrichmentMap,
  buildDatafeedMaps,
};
