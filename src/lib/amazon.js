const {
  GetItemsRequestContent,
  SearchItemsRequestContent,
} = require("../../vendor/creatorsapi-nodejs-sdk/dist/index");

const RESOURCES = [
  "images.primary.medium",
  "itemInfo.title",
  "itemInfo.features",
  "offersV2.listings.price",
  "offersV2.listings.availability",
  "offersV2.listings.condition",
  "offersV2.listings.merchantInfo",
];

/** Chiama l’API Amazon GetItems per ottenere i dettagli dei prodotti per ID. */
async function getItems(api, { marketplace, partnerTag, itemIds, resources = RESOURCES }) {
  const req = new GetItemsRequestContent(partnerTag, itemIds);
  req.resources = resources;
  return api.getItems(marketplace, req);
}

/** Chiama l’API Amazon SearchItems con keyword, filtri e paginazione. */
async function searchItems(api, options) {
  const {
    marketplace,
    partnerTag,
    keywords,
    searchIndex,
    itemCount = 10,
    resources = RESOURCES,
    itemPage,
    sortBy,
    browseNodeId,
    maxPrice,
    minPrice,
    brand,
    deliveryFlags,
  } = options;

  const req = new SearchItemsRequestContent();

  // Campi obbligatori
  req.partnerTag = partnerTag;
  req.keywords = keywords;
  req.searchIndex = searchIndex;
  req.itemCount = itemCount;
  req.resources = resources;

  // Campi opzionali (solo se valorizzati)
  if (itemPage != null) req.itemPage = itemPage;
  if (sortBy) req.sortBy = sortBy;
  if (browseNodeId) req.browseNodeId = browseNodeId;
  if (maxPrice != null) req.maxPrice = maxPrice;
  if (minPrice != null) req.minPrice = minPrice;
  if (brand) req.brand = brand;
  if (deliveryFlags?.length) req.deliveryFlags = deliveryFlags;

  return api.searchItems(marketplace, { searchItemsRequestContent: req });
}

module.exports = { getItems, searchItems };
