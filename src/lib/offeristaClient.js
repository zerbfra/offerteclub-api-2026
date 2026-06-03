// Minimal Offerista/Shopfully REST client.
// Docs: https://delivery.offerista.com (Basic Auth, JSON, gzip).

const DEFAULT_BASE_URL = "https://delivery.offerista.com";

function basicAuthHeader(key, secret) {
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

function roundCoord(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return Math.round(n * 10000) / 10000;
}

// Build a geo query value `lat,lng[,radius]` with lat/lng rounded to 4 decimals
// per Offerista cache-optimization guidance.
function geoParam(latitude, longitude, radius) {
  const parts = [roundCoord(latitude), roundCoord(longitude)];
  if (radius != null) parts.push(radius);
  return parts.join(",");
}

// Build the `limit=<offset>,<count>` pagination param expected by Offerista.
function limitParam(offset, count) {
  return `${offset},${count}`;
}

function buildQuery(params) {
  if (!params) return "";
  const entries = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    const values = Array.isArray(v) ? v : [v];
    for (const item of values) {
      entries.push([k, String(item)]);
    }
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return qs ? `?${qs}` : "";
}

function createOfferistaClient(options = {}) {
  const baseUrl = (options.baseUrl || process.env.OFFERISTA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const key = options.key || process.env.OFFERISTA_KEY;
  const secret = options.secret || process.env.OFFERISTA_SECRET;
  if (!key || !secret) {
    throw new Error("Offerista credentials missing: set OFFERISTA_KEY and OFFERISTA_SECRET");
  }
  const userAgent = options.userAgent || "OfferteClub/discovery";
  const acceptLanguage = options.acceptLanguage || "it";

  async function request(path, params, opts = {}) {
    const url = `${baseUrl}${path}${buildQuery(params)}`;
    const maxAttempts = opts.maxAttempts ?? 2;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "Accept-Language": acceptLanguage,
            Authorization: basicAuthHeader(key, secret),
            "User-Agent": userAgent,
          },
        });
        if (res.status >= 500 && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        const text = await res.text();
        let body = null;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        return { status: res.status, ok: res.ok, body, url };
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
      }
    }
    throw lastErr ?? new Error(`Offerista request failed: ${url}`);
  }

  // Iterate a list endpoint with Offerista's `limit=<offset>,<count>` paging
  // until total is reached, response is empty, or maxPages is hit.
  async function* paginate(path, params, opts = {}) {
    const pageSize = Math.min(opts.pageSize ?? 1000, 1000);
    const maxPages = opts.maxPages ?? 50;
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const res = await request(path, { ...params, limit: limitParam(offset, pageSize) });
      if (!res.ok) {
        throw new Error(`Offerista ${path} HTTP ${res.status}: ${typeof res.body === "string" ? res.body : JSON.stringify(res.body)}`);
      }
      yield res;
      const items = extractItems(res.body);
      const total = res.body?.result?.total ?? res.body?.total;
      if (!items || items.length === 0) return;
      offset += items.length;
      if (total != null && offset >= total) return;
      if (items.length < pageSize) return;
    }
  }

  return { request, paginate, baseUrl };
}

// Offerista wraps list results in different shapes per endpoint
// (e.g. result.companies, result.stores, result.offers, result.brochures...).
// This helper picks the first array we find inside `result`.
function extractItems(body) {
  if (!body || typeof body !== "object") return [];
  const result = body.result || body;
  if (Array.isArray(result)) return result;
  for (const v of Object.values(result)) {
    if (Array.isArray(v)) return v;
  }
  return [];
}

module.exports = { createOfferistaClient, extractItems, geoParam, limitParam };
