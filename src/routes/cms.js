// Endpoint CMS-like: per ora i contenuti sono hardcoded qui, in futuro
// arriveranno da un CMS esterno (es. Sanity/Strapi) — la forma della response
// resta stabile così il client non cambia.

const TOP_BRANDS = [
  "Apple",
  "Samsung",
  "Sony",
  "LG",
  "Bosch",
  "Philips",
  "Dyson",
  "Xiaomi",
  "Lenovo",
  "HP",
  "Asus",
  "Microsoft",
  "Nintendo",
  "JBL",
  "Logitech",
  "De’Longhi",
  "Tineco",
  "Roborock",
  "Anker",
  "Garmin",
];

// `type: "ai"`     → query = prompt in linguaggio naturale per la chat AI.
// `type: "search"` → query = keyword da passare alla ricerca prodotti.
const CHIPS = [
  {
    type: "ai",
    label: "Notebook uni",
    query:
      "Cerco un notebook per università con buona autonomia, schermo 14-15 pollici, 16GB RAM e prezzo sotto 700€.",
  },
  {
    type: "ai",
    label: "Smartphone economico",
    query:
      "Cerco uno smartphone economico, sotto i 300€, che abbia una buona fotocamera e una buona batteria",
  },
  {
    type: "ai",
    label: "Regalo <50€",
    query: "Mi suggerisci 3 idee regalo originali con un prezzo sotto i 50€?",
  },
  {
    type: "ai",
    label: "Gaming",
    query:
      "Voglio fare un setup gaming completo con un buon rapporto qualità/prezzo. Quali offerte mi consigli?",
  },
  {
    type: "ai",
    label: "Casa smart",
    query:
      "Sto cercando dispositivi smart home utili in sconto: aspirapolvere, illuminazione, assistenti vocali.",
  },
  {
    type: "search",
    label: "Smartphone",
    query: "smartphone",
  },
  {
    type: "search",
    label: "Robot aspirapolvere",
    query: "robot aspirapolvere",
  },
  {
    type: "search",
    label: "Friggitrice ad aria",
    query: "friggitrice ad aria",
  },
  {
    type: "search",
    label: "Nintendo Switch",
    query: "nintendo switch",
  },
  {
    type: "search",
    label: "Action cam",
    query: "action cam",
  },
  {
    type: "search",
    label: "Airpods",
    query: "airpods",
  },
];

const HOME_CHIPS = [
  {
    key: "marchi-top",
    label: "Marchi TOP",
    pinned: true,
    params: { title: "Marchi TOP", source: "firebase", brands: "" },
  },
  {
    key: "trending-tech",
    label: "Trending Tech",
    pinned: false,
    params: { title: "Trending Tech", source: "trending", channel: "offertepuntotech" },
  },
  {
    key: "trending-casa",
    label: "Trending Casa",
    pinned: false,
    params: { title: "Trending Casa", source: "trending", channel: "offertepuntocasa" },
  },
  {
    key: "piu-scontati",
    label: "Più scontati",
    pinned: false,
    params: { title: "I più scontati", source: "firebase", minDiscount: "30" },
  },
  {
    key: "piu-economici",
    label: "Più economici",
    pinned: false,
    params: { title: "I più economici", source: "firebase", maxPrice: "20" },
  },
];

// ─── Eventi home (banner branded) ───────────────────────────────────────────
// `endsAt`: ISO string o epoch ms (il client gestisce entrambi). null = no countdown.
// La `key` è una stringa libera: puoi inventarne di nuove senza toccare il client.
// `active`: esattamente uno a true = quello servito. Tutti a false = nessun
// evento (header viola standard). Se più di uno è true vince il primo in ordine.
const HOME_EVENT_STARTS_AT = "2001-05-31T23:59:59";
const HOME_EVENT_ENDS_AT = "2001-05-31T23:59:59";

const HOME_EVENTS = {
  "black-friday": {
    key: "black-friday",
    active: false,
    titleLines: ["Black", "Friday"],
    subtitle: "La settimana più bollente dell'anno",
    badgeLabel: "EVENTO IN CORSO",
    bg: "#0A0A12",
    accent: "#FF5A1F",
    badgeColor: "#FFD84D",
    glowTop: "rgba(255,90,31,0.35)",
    glowBottom: "rgba(255,46,92,0.28)",
    titleAccent: "#FF5A1F",
    startsAt: HOME_EVENT_STARTS_AT,
    endsAt: HOME_EVENT_ENDS_AT,
  },
  "prime-day": {
    key: "prime-day",
    active: false,
    titleLines: ["Prime", "Day"],
    subtitle: "48 ore di offerte esclusive per i membri",
    badgeLabel: "EVENTO IN CORSO",
    bg: "#0A1A2F",
    accent: "#0066C0",
    badgeColor: "#00D4E0",
    glowTop: "rgba(0,212,224,0.28)",
    glowBottom: "rgba(255,153,0,0.22)",
    titleAccent: "#00D4E0",
    startsAt: HOME_EVENT_STARTS_AT,
    endsAt: HOME_EVENT_ENDS_AT,
  },
  anniversary: {
    key: "anniversary",
    active: false,
    titleLines: ["11° Anni", "versario"],
    subtitle: "Il compleanno di AliExpress · 11 giorni di sconti",
    badgeLabel: "EVENTO IN CORSO",
    bg: "#8A0A0A",
    accent: "#E62117",
    badgeColor: "#FFD93D",
    glowTop: "rgba(255,217,61,0.32)",
    glowBottom: "rgba(255,61,95,0.25)",
    titleAccent: "#FFD93D",
    startsAt: HOME_EVENT_STARTS_AT,
    endsAt: HOME_EVENT_ENDS_AT,
  },
  "summer-sales": {
    key: "summer-sales",
    active: false,
    titleLines: ["Summer", "Sales"],
    subtitle: "Sole, mare e sconti freschi tutta l'estate",
    badgeLabel: "SALDI ESTIVI",
    bg: "#0A3A63",
    accent: "#27A5FD",
    badgeColor: "#FEFC03",
    glowTop: "rgba(39,165,253,0.34)",
    glowBottom: "rgba(254,252,3,0.22)",
    titleAccent: "#FEFC03",
    startsAt: HOME_EVENT_STARTS_AT,
    endsAt: HOME_EVENT_ENDS_AT,
  },
};

// ─── Slides (banner immagine cliccabili) ────────────────────────────────────
// Ogni slide ha una `image` (url da mostrare) e una destinazione al tap:
//   type: "web"    → `target` è un URL http da aprire (browser/in-app webview).
//   type: "screen" → `target` è una route Expo Router da aprire in app.
// L'ordine dell'array è significativo (ordine di visualizzazione nel carosello).
//
// Route screen valide (Expo Router):
//   /(tabs)            → Home
//   /(tabs)/reels      → Scopri (reel)
//   /(tabs)/favorites  → Preferiti
//   /(tabs)/profile    → Profilo
//   /live              → Diretta live
//   /notifications     → Notifiche
//   /search            → Ricerca
//   /chat              → Chat AI
//   /offer-preferences → Preferenze offerte
//   /edit-profile      → Modifica profilo
//   /onboarding        → Tutorial
//   /login             → Login
const SLIDES = [
  {
    image: "https://assets.offerte.club/BANNER/LIVE_ALI_SUMMER26/1.jpg",
    type: "screen",
    target: "/live",
  },
  {
    image: "https://assets.offerte.club/BANNER/LIVE_ALI_SUMMER26/2.jpg",
    type: "screen",
    target: "/live",
  },
  {
    image: "https://assets.offerte.club/BANNER/LIVE_ALI_SUMMER26/3.jpg",
    type: "web",
    target: "https://offerte.club",
  },
];

// ─── Comunicazione speciale (messaggio in-app) ──────────────────────────────
// Messaggio testuale da mostrare in app (es. avviso/comunicazione speciale).
// `active`: true = servito, false = nessuna comunicazione (data:null).
//   title  → titolo del messaggio
//   body   → corpo testo
//   color  → colore hex (es. accent/sfondo, gestito lato client)
//   type   → destinazione al tap: "web" (URL http) o "screen" (route Expo
//            Router). Vedi l'elenco route valide nel blocco SLIDES sopra.
//   target → URL http (type "web") o route Expo Router (type "screen").
const ANNOUNCEMENT = {
  active: true,
  title: "Comunicazione speciale",
  body: "Questo è il testo della comunicazione mostrata in app.",
  color: "#7C3AED",
  type: "screen",
  target: "/live",
};

module.exports = async function (fastify) {
  // GET /api/cms/top-brands — Lista dei brand in evidenza per la home/discovery.
  fastify.get("/cms/top-brands", async () => {
    return { status: 200, data: TOP_BRANDS };
  });

  // GET /api/cms/chips — Chip rapidi per home/chat. Ogni elemento ha `type`:
  // "ai" (prompt per la chat) oppure "search" (keyword per la ricerca).
  fastify.get("/cms/chips", async () => {
    return { status: 200, data: CHIPS };
  });

  // GET /api/cms/home-chips — Chip della home (categorie/scorciatoie).
  // L'ordine dell'array è significativo; `pinned: true` marca quelli da
  // ancorare in testa lato client.
  fastify.get("/cms/home-chips", async () => {
    return { status: 200, data: HOME_CHIPS };
  });

  // GET /api/cms/slides — Slide/banner immagine per la home. Ogni slide ha una
  // `image` e una destinazione al tap: type "web" (URL http) o "screen"
  // (route Expo Router, in `target`).
  fastify.get("/cms/slides", async () => {
    return { status: 200, data: SLIDES };
  });

  // GET /api/cms/announcement — Comunicazione speciale (messaggio testuale) o
  // nessuna. Per attivarla: `active: true` su ANNOUNCEMENT. `active:false`/
  // `data:null` quando non c'è nessuna comunicazione.
  fastify.get("/cms/announcement", async () => {
    if (!ANNOUNCEMENT.active) {
      return { status: 200, active: false, data: null };
    }
    return { status: 200, active: true, data: ANNOUNCEMENT };
  });

  // GET /api/cms/home-event — Evento home attivo (banner branded) o nessuno.
  // Per cambiare evento: mettere `active: true` sull'evento voluto in
  // HOME_EVENTS (e false sugli altri). Tutti false → active:false.
  fastify.get("/cms/home-event", async () => {
    const theme = Object.values(HOME_EVENTS).find((e) => e.active) || null;
    if (!theme) {
      return { status: 200, active: false, data: null };
    }
    return { status: 200, active: true, data: theme };
  });
};
