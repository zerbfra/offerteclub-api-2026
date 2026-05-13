const config = require("../config");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CLICK_STATS_FETCH_LIMIT = 300;
const CLICK_STATS_MIN_CLICKS = 1;
const TOP_FIREBASE_ENRICH = 50;
const FIRESTORE_IN_MAX = 30;

const VALID_PERIODS = new Set(["today", "yesterday", "2days", "week"]);

const resolveHost = (url) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("awin1.com") || host.includes("awin.com")) {
      const dest =
        parsed.searchParams.get("ued") ||
        parsed.searchParams.get("url") ||
        parsed.searchParams.get("p");
      if (dest) return resolveHost(dest);
    }
    if (host.includes("amzlink.to") || host.includes("bttn.io")) {
      const dest = parsed.searchParams.get("btn_url") || parsed.searchParams.get("url");
      if (dest) return resolveHost(dest);
      return "amazon.it";
    }
    return host;
  } catch {
    return "";
  }
};

const getStore = (url) => {
  if (!url) return "altro";
  const host = resolveHost(url);
  if (!host) return "altro";
  if (
    host.includes("amazon.") ||
    host === "amzn.to" ||
    host.endsWith(".amzn.to") ||
    host.includes("amzn.eu")
  ) {
    return "amazon";
  }
  if (host.includes("aliexpress.")) return "aliexpress";
  if (host.includes("mediaworld.")) return "mediaworld";
  if (host.includes("unieuro.")) return "unieuro";
  if (host.includes("comet.")) return "comet";
  if (host.includes("ebay.")) return "ebay";
  return "altro";
};

const getDateRange = (period) => {
  const today = new Date();
  const fmt = (d) => d.toISOString().split("T")[0];

  switch (period) {
    case "yesterday": {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return { startDate: fmt(d), endDate: fmt(d) };
    }
    case "2days": {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return { startDate: fmt(d), endDate: fmt(today) };
    }
    case "week": {
      const d = new Date(today);
      d.setDate(d.getDate() - 7);
      return { startDate: fmt(d), endDate: fmt(today) };
    }
    case "today":
    default:
      return { startDate: fmt(today), endDate: fmt(today) };
  }
};

const parsePrice = (priceStr) => {
  if (!priceStr) return { current: null, original: null };
  const cleaned = priceStr.replace(/\s/g, "");
  const parts = cleaned.split(/invece\s*di/i);
  const parseSingle = (s) => {
    const match = s.match(/([\d.,]+)/);
    if (!match) return null;
    return parseFloat(match[1].replace(".", "").replace(",", "."));
  };
  return {
    current: parseSingle(parts[0]),
    original: parts[1] ? parseSingle(parts[1]) : null,
  };
};

const parseLimit = (value) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

const fetchClickStats = async ({ category, startDate, endDate, log }) => {
  const body = {
    limit: CLICK_STATS_FETCH_LIMIT,
    minClicks: CLICK_STATS_MIN_CLICKS,
    startDate: `${startDate} 00:00:00`,
    endDate: `${endDate} 23:59:59`,
  };
  if (category && category !== "all") body.category = category;

  const res = await fetch(`${config.yourlsStats.url}/clicks?blocking=true&result=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${config.yourlsStats.token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = new Error(`Yourls stats API error (status ${res.status})`);
    err.statusCode = 502;
    throw err;
  }

  const responseData = await res.json();
  const result = responseData.body || responseData;
  if (!result.success) {
    const err = new Error(result.error || "Yourls stats API failure");
    err.statusCode = 502;
    throw err;
  }

  const data = result.data || [];
  const filtered = data.filter(
    (item) =>
      item.title &&
      typeof item.title === "string" &&
      item.title.trim() !== "" &&
      item.title.trim() !== item.url?.trim(),
  );
  log?.info(
    { fetched: data.length, filtered: filtered.length, startDate, endDate, category },
    "yourls click stats fetched",
  );
  return filtered;
};

const aggregateByUrl = (clickStats) => {
  const merged = new Map();
  for (const entry of clickStats) {
    const key = entry.url;
    const clicks = parseInt(entry.clicks || 0, 10);
    const shortUrl = entry.keyword ? `https://ofclub.click/${entry.keyword}` : null;
    const existing = merged.get(key);
    if (existing) {
      existing.clicks += clicks;
      if (shortUrl) existing.shortUrls.push(shortUrl);
      if (clicks > existing.topClicksSingle) {
        existing.topClicksSingle = clicks;
        existing.title = entry.title || existing.title;
      }
    } else {
      merged.set(key, {
        url: entry.url,
        title: entry.title,
        store: getStore(entry.url),
        clicks,
        topClicksSingle: clicks,
        shortUrls: shortUrl ? [shortUrl] : [],
      });
    }
  }
  return [...merged.values()].sort((a, b) => b.clicks - a.clicks);
};

const fetchPostsByPayloadUrls = async (firestore, shortUrls) => {
  const result = {};
  for (let i = 0; i < shortUrls.length; i += FIRESTORE_IN_MAX) {
    const chunk = shortUrls.slice(i, i + FIRESTORE_IN_MAX);
    const snapshot = await firestore.collection("posts").where("payload.url", "in", chunk).get();
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const url = data.payload?.url;
      if (url) result[url] = { ...data, docId: doc.id };
    });
  }
  return result;
};

const enrichWithFirestore = async ({ firestore, ranked, log }) => {
  const topEntries = ranked.filter((e) => e.shortUrls.length > 0).slice(0, TOP_FIREBASE_ENRICH);
  const shortUrls = topEntries.flatMap((e) => e.shortUrls);
  if (shortUrls.length === 0) return;

  try {
    const postsByUrl = await fetchPostsByPayloadUrls(firestore, shortUrls);
    topEntries.forEach((e) => {
      const post = e.shortUrls.map((s) => postsByUrl[s]).find((p) => p?.payload);
      if (!post) return;
      const p = post.payload;
      const { current, original } = parsePrice(p.price || "");
      e.image = p.image || p.framedImage || "";
      e.price = current;
      e.originalPrice = original;
      e.discount =
        current != null && original != null && original > 0
          ? Math.round((1 - current / original) * 100)
          : null;
      e.fullUrl = p.fullUrl || p.url || e.url;
      e.note = p.note || "";
      e.channel = post.channel?.chat?.replace(/^@offertepunto/, "") || "";
      e.title = (p.title || e.title || "").replace(/^\s*\[[^\]]*\]\s*/, "");
      e.docId = post.docId || null;
      e.ean = p.ean || null;
      e.asin = p.asin || null;
    });
  } catch (err) {
    log?.error({ err }, "firebase enrichment error");
  }
};

const formatOffer = (entry, index) => ({
  rank: index + 1,
  docId: entry.docId || null,
  title: (entry.title || "").replace(/^\s*\[[^\]]*\]\s*/, "").substring(0, 120),
  url: entry.fullUrl || entry.url,
  store: entry.store,
  clicks: entry.clicks,
  image: entry.image || "",
  price: entry.price || null,
  originalPrice: entry.originalPrice || null,
  discount: entry.discount || null,
  note: entry.note || "",
  channel: entry.channel || "",
  ean: entry.ean || null,
  asin: entry.asin || null,
});

/**
 * Restituisce le offerte più cliccate aggregando click stats Yourls
 * e arricchendo con i dati del post Telegram da Firestore.
 */
const getTopOffers = async (firestore, { period, category, limit } = {}, log) => {
  if (period && !VALID_PERIODS.has(period)) {
    const err = new Error(`Invalid period, allowed: ${[...VALID_PERIODS].join(", ")}`);
    err.statusCode = 400;
    throw err;
  }

  const safePeriod = period || "today";
  const safeCategory = category || "all";
  const safeLimit = parseLimit(limit);

  const { startDate, endDate } = getDateRange(safePeriod);
  const clickStats = await fetchClickStats({
    category: safeCategory,
    startDate,
    endDate,
    log,
  });

  if (clickStats.length === 0) {
    return { offers: [], totalClicks: 0, period: safePeriod, startDate, endDate, count: 0 };
  }

  const ranked = aggregateByUrl(clickStats);
  await enrichWithFirestore({ firestore, ranked, log });

  const withPrice = ranked.filter((e) => e.price != null);
  const totalClicks = withPrice.reduce((sum, e) => sum + e.clicks, 0);
  const offers = withPrice.slice(0, safeLimit).map(formatOffer);

  return {
    offers,
    totalClicks,
    period: safePeriod,
    startDate,
    endDate,
    count: offers.length,
  };
};

module.exports = {
  getTopOffers,
};
