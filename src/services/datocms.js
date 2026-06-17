// Connettore DatoCMS — Content Delivery API (GraphQL, sola lettura).
// Usa `fetch` nativo verso l'endpoint GraphQL con il read-only API token: per
// la lettura DatoCMS non fornisce un SDK dedicato (il `@datocms/cma-client` è
// per la Management API/scritture), quindi un client fetch minimale è la via
// ufficiale e senza dipendenze.

const config = require("../config");

/**
 * Esegue una query GraphQL sulla Content Delivery API di DatoCMS.
 * Lancia un Error con `statusCode` su token mancante / errori HTTP / GraphQL.
 */
async function datoQuery(query, variables = {}) {
  const { apiToken, endpoint, timeout } = config.datocms;
  if (!apiToken) {
    const err = new Error("DatoCMS non configurato (manca DATOCMS_API_TOKEN)");
    err.statusCode = 503;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`DatoCMS HTTP ${res.status}: ${body.slice(0, 200)}`);
      err.statusCode = 502;
      throw err;
    }

    const json = await res.json();
    if (json.errors?.length) {
      const err = new Error(
        `DatoCMS GraphQL: ${json.errors.map((e) => e.message).join("; ")}`,
      );
      err.statusCode = 502;
      throw err;
    }
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Slides ──────────────────────────────────────────────────────────────────
// Modello DatoCMS `slide`: image (FileField), slidetype, target, order.
const SLIDES_QUERY = `
  query Slides {
    allSlides(orderBy: order_ASC) {
      id
      slidetype
      target
      image { url }
    }
  }
`;

// Mappa il record DatoCMS sulla forma stabile attesa dal client (image/type/target).
const mapSlide = (record) => ({
  image: record.image?.url || null,
  type: record.slidetype || null,
  target: record.target || null,
});

/** Slide ordinate per `order`, già nella forma servita al client. */
async function getSlides() {
  const data = await datoQuery(SLIDES_QUERY);
  return (data.allSlides || [])
    .map(mapSlide)
    .filter((s) => s.image && s.type && s.target);
}

// ─── Top brands ───────────────────────────────────────────────────────────────
// Modello DatoCMS `top_brand`: name. Ordine = creazione (_createdAt_ASC).
// `first: 100` per evitare il troncamento silenzioso al default di 20 record.
const TOP_BRANDS_QUERY = `
  query TopBrands {
    allTopBrands(orderBy: _createdAt_ASC, first: 100) {
      name
    }
  }
`;

/** Lista nomi dei top brand, ordinati per creazione. */
async function getTopBrands() {
  const data = await datoQuery(TOP_BRANDS_QUERY);
  return (data.allTopBrands || []).map((b) => b.name).filter(Boolean);
}

// ─── Chips ────────────────────────────────────────────────────────────────────
// Modello DatoCMS `chip` (sortable), condiviso da chip rapidi e chip home tramite
// `chiptype` (= type): "ai"/"search" → chip rapidi (label, query); "home" → chip
// della home (chipkey, pinned, params JSON). Ordine = `position` (riordinabile da
// UI). In DatoCMS `type` è riservato, quindi il campo è `chiptype`.
const CHIPS_QUERY = `
  query Chips {
    allChips(filter: { chiptype: { in: ["ai", "search"] } }, orderBy: position_ASC, first: 100) {
      chiptype
      label
      query
    }
  }
`;

const mapChip = (record) => ({
  type: record.chiptype || null,
  label: record.label || null,
  query: record.query || null,
});

/** Chip rapidi (ai/search) ordinati per `position`, forma client (type/label/query). */
async function getChips() {
  const data = await datoQuery(CHIPS_QUERY);
  return (data.allChips || [])
    .map(mapChip)
    .filter((c) => c.type && c.label && c.query);
}

// Chip della home (chiptype "home"). `params` è un campo json: la delivery API
// lo restituisce già come oggetto, quindi non serve parsing.
const HOME_CHIPS_QUERY = `
  query HomeChips {
    allChips(filter: { chiptype: { eq: "home" } }, orderBy: position_ASC, first: 100) {
      chipkey
      label
      pinned
      params
    }
  }
`;

const mapHomeChip = (record) => ({
  key: record.chipkey || null,
  label: record.label || null,
  pinned: record.pinned ?? false,
  params: record.params || null,
});

/** Chip della home ordinati per `position`, forma client (key/label/pinned/params). */
async function getHomeChips() {
  const data = await datoQuery(HOME_CHIPS_QUERY);
  return (data.allChips || [])
    .map(mapHomeChip)
    .filter((c) => c.key && c.label);
}

// ─── Announcement ─────────────────────────────────────────────────────────────
// Modello singleton DatoCMS `announcement`: active, anntype, title, body,
// target, color (ColorField → si serve l'hex come stringa).
const ANNOUNCEMENT_QUERY = `
  query Announcement {
    announcement {
      active
      anntype
      title
      body
      target
      color { hex }
    }
  }
`;

const mapAnnouncement = (record) => ({
  active: record.active,
  title: record.title || null,
  body: record.body || null,
  color: record.color?.hex || null,
  type: record.anntype || null,
  target: record.target || null,
});

/** Comunicazione speciale mappata, o null se il record non esiste. */
async function getAnnouncement() {
  const data = await datoQuery(ANNOUNCEMENT_QUERY);
  return data.announcement ? mapAnnouncement(data.announcement) : null;
}

// ─── Home event ───────────────────────────────────────────────────────────────
// Modello DatoCMS `event` (Events, sortable): un evento `active` alla volta è
// quello servito (primo per `position` se più di uno). NB: la delivery API espone
// gli api_key snake_case in camelCase (title_lines → titleLines, ecc.).
//   eventkey → key | titleLines (textarea) splittato per riga → array
//   bg/accent/badgeColor/titleAccent → ColorField (.hex) | glow* → stringa rgba
const HOME_EVENT_QUERY = `
  query HomeEvent {
    allEvents(filter: { active: { eq: true } }, orderBy: position_ASC, first: 1) {
      eventkey
      active
      titleLines
      subtitle
      badgeLabel
      bg { hex }
      accent { hex }
      badgeColor { hex }
      titleAccent { hex }
      glowTop
      glowBottom
      startsAt
      endsAt
    }
  }
`;

const mapEvent = (r) => ({
  key: r.eventkey || null,
  active: r.active,
  titleLines: (r.titleLines || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean),
  subtitle: r.subtitle || null,
  badgeLabel: r.badgeLabel || null,
  bg: r.bg?.hex || null,
  accent: r.accent?.hex || null,
  badgeColor: r.badgeColor?.hex || null,
  glowTop: r.glowTop || null,
  glowBottom: r.glowBottom || null,
  titleAccent: r.titleAccent?.hex || null,
  startsAt: r.startsAt || null,
  endsAt: r.endsAt || null,
});

/** Evento home attivo (primo per position), o null se nessuno è attivo. */
async function getHomeEvent() {
  const data = await datoQuery(HOME_EVENT_QUERY);
  const record = (data.allEvents || [])[0];
  return record ? mapEvent(record) : null;
}

module.exports = {
  datoQuery,
  getSlides,
  getAnnouncement,
  getTopBrands,
  getChips,
  getHomeChips,
  getHomeEvent,
};
