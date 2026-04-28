/**
 * Converte i results.hits di Meilisearch in oggetti JSON per il frontend Web API.
 * Link: solo hit.url (da Meilisearch o gateway arricchimento); se assente/invalido → null.
 */

const getProductUrl = (hit) => {
  const url = (hit.url || "").trim();
  if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
    return url;
  }
  return null;
};

const buildSpecs = (attrs) => {
  if (!attrs || typeof attrs !== "object") return {};
  const specs = {};
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v != null && String(v).trim() !== "") {
      specs[k] = String(v).trim();
    }
  }
  return specs;
};

const serializeProducts = (hits) => {
  if (!Array.isArray(hits)) return [];
  return hits.map((hit) => {
    const brand =
      (hit.icecat_brand && String(hit.icecat_brand).trim()) ||
      (hit.web_search_brand && String(hit.web_search_brand).trim()) ||
      null;
    const bullets = Array.isArray(hit.icecat_bullets)
      ? hit.icecat_bullets.slice(0, 3).map((b) => (b != null ? String(b) : ""))
      : [];
    const availableInShops = Array.isArray(hit.available_in_shops)
      ? hit.available_in_shops.map((entry) => ({
          shop: entry.shop || null,
          priceDisplay: entry.price_display || null,
          url:
            entry.url && /^https?:\/\//i.test(String(entry.url).trim()) ? entry.url : null,
        }))
      : [];

    return {
      id: hit.id ?? null,
      title: hit.title ?? null,
      brand,
      priceDisplay: hit.price_display ?? null,
      url: getProductUrl(hit),
      shop: hit.shop ?? null,
      asin: hit.asin ?? null,
      image: (hit.image && String(hit.image).trim()) || null,
      framedImage: (hit.framedImage && String(hit.framedImage).trim()) || null,
      brandLogo: (hit.icecat_brand_logo && String(hit.icecat_brand_logo).trim()) || null,
      availableInShops,
      specs: buildSpecs(hit.icecat_attributes),
      shortDesc:
        (hit.icecat_short_desc && String(hit.icecat_short_desc).trim()) ||
        (hit.web_search_short_desc && String(hit.web_search_short_desc).trim()) ||
        null,
      bullets: bullets.length ? bullets : null,
    };
  });
};

module.exports = {
  serializeProducts,
  getProductUrl,
  buildSpecs,
};
