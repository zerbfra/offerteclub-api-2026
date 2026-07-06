// Endpoint CMS-like. Top brands, chips, home-chips, slide, announcement e
// home-event arrivano tutti da DatoCMS (Content Delivery API, vedi
// services/datocms.js). La forma della response resta stabile così il client
// non cambia.
//
// Ogni endpoint segue lo stesso schema: leggi da cache Redis → fetch da DatoCMS
// → su errore servi un fallback → scrivi in cache. È incapsulato in
// `datoCached()`: ogni route dichiara solo chiave cache, getter, come formattare
// la response e il fallback.
//
// Route screen valide (Expo Router) — usate nel `target` di slides/announcement
// quando type = "screen":
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

const {
  getSlides,
  getAnnouncement,
  getTopBrands,
  getChips,
  getHomeChips,
  getHomeEvent,
  getConfiguration,
  getBioLinks,
} = require("../services/datocms");

// Prefisso comune di tutte le chiavi cache di questo modulo (vedi i vari
// `key:` sotto): usato dal reset per invalidarle in blocco.
const CACHE_KEY_PREFIX = "cms:";

// Response generica: mette il valore sotto `data` (array per le liste, oggetto o
// null per i contenuti singoli come l'announcement). Fallback dedicati per shape.
const asData = (data) => ({ status: 200, data });
const LIST_FALLBACK = Object.freeze({ status: 200, data: [] });
const NULL_FALLBACK = Object.freeze({ status: 200, data: null });

// Response "attivo/contenuto" per home-event: active:true + data se c'è un evento
// attivo, altrimenti active:false/data:null (anche come fallback su errore).
const INACTIVE = Object.freeze({ status: 200, active: false, data: null });
const asActive = (value) =>
  value && value.active ? { status: 200, active: true, data: value } : INACTIVE;

module.exports = async function (fastify) {
  // Wrappa un getter DatoCMS con cache Redis + fallback su errore, e ritorna un
  // handler Fastify. `key` e `fetch` possono essere statici o funzioni della
  // request (per le route parametriche). `format(value)` costruisce la response
  // (sia da cache che da fetch); `fallback` è la response servita se DatoCMS è
  // irraggiungibile.
  const datoCached =
    ({ key, fetch, format, fallback }) =>
    async (request) => {
      const cacheKey = typeof key === "function" ? key(request) : key;
      try {
        const cached = await fastify.redis.get(cacheKey);
        if (cached != null) return format(JSON.parse(cached));
      } catch (err) {
        fastify.log.warn({ err }, `${cacheKey}: lettura cache Redis fallita`);
      }

      let value;
      try {
        value = await fetch(request);
      } catch (err) {
        fastify.log.error({ err }, `${cacheKey}: DatoCMS irraggiungibile`);
        return fallback;
      }

      try {
        await fastify.redis.set(
          cacheKey,
          JSON.stringify(value),
          "EX",
          fastify.config.datocms.cacheTtlSeconds,
        );
      } catch (err) {
        fastify.log.warn({ err }, `${cacheKey}: scrittura cache Redis fallita`);
      }

      return format(value);
    };

  // GET /api/cms/top-brands — Brand in evidenza (modello `top_brand`, ordinati
  // per creazione). `data` = array di stringhe.
  fastify.get(
    "/cms/top-brands",
    datoCached({ key: "cms:top-brands", fetch: getTopBrands, format: asData, fallback: LIST_FALLBACK }),
  );

  // GET /api/cms/chips — Chip rapidi home/chat (modello `chip`, type "ai"=prompt
  // chat / "search"=keyword ricerca, ordinati per `position`). Ogni elemento:
  // type, label, query.
  fastify.get(
    "/cms/chips",
    datoCached({ key: "cms:chips", fetch: getChips, format: asData, fallback: LIST_FALLBACK }),
  );

  // GET /api/cms/home-chips — Chip categoria home (modello `chip`, type "home",
  // ordinati per `position`). Ogni elemento: key, label, pinned (true = ancorato
  // in testa), params (JSON).
  fastify.get(
    "/cms/home-chips",
    datoCached({ key: "cms:home-chips", fetch: getHomeChips, format: asData, fallback: LIST_FALLBACK }),
  );

  // GET /api/cms/slides — Slide/banner home (modello `slide`, ordinate per
  // `order`). Ogni slide: `image` + destinazione al tap (type "web"=URL http /
  // "screen"=route Expo Router, in `target`).
  fastify.get(
    "/cms/slides",
    datoCached({ key: "cms:slides", fetch: getSlides, format: asData, fallback: LIST_FALLBACK }),
  );

  // GET /api/cms/announcement — Comunicazione speciale (modello singleton
  // `announcement`). `data`: title, body, color (hex), type/target (come slides),
  // oppure null. On/off via publish/unpublish su DatoCMS: pubblica per mostrarla,
  // unpublish per nasconderla (→ data:null). Nessun flag `active`: il client
  // mostra la comunicazione se `data` è presente.
  fastify.get(
    "/cms/announcement",
    datoCached({ key: "cms:announcement", fetch: getAnnouncement, format: asData, fallback: NULL_FALLBACK }),
  );

  // GET /api/cms/home-event — Evento home / banner branded (modello `event`).
  // `data`: key, titleLines (array), subtitle, badgeLabel, colori (bg/accent/
  // badgeColor/titleAccent hex), glowTop/glowBottom (rgba), startsAt/endsAt. Per
  // cambiarlo: `active: true` sull'evento voluto in DatoCMS (più di uno → vince
  // il primo per `position`). active:false/data:null quando nessuno è attivo.
  fastify.get(
    "/cms/home-event",
    datoCached({ key: "cms:home-event", fetch: getHomeEvent, format: asActive, fallback: INACTIVE }),
  );

  // GET /api/cms/config/:identifier — Configurazione applicativa per chiave
  // (modello `configuration`, es. identifier "live_config"). `data` = oggetto
  // JSON della config (o null se l'identifier non esiste). Cache Redis breve.
  fastify.get(
    "/cms/config/:identifier",
    datoCached({
      key: (req) => `cms:config:${req.params.identifier}`,
      fetch: (req) => getConfiguration(req.params.identifier),
      format: asData,
      fallback: NULL_FALLBACK,
    }),
  );

  // GET /api/cms/bio-links — Linktree per la bio Instagram (modello `bio_link`,
  // ordinati per `date` decrescente, più recenti prima). Ogni elemento: `title`,
  // `url` e `date`. Cache Redis breve.
  fastify.get(
    "/cms/bio-links",
    datoCached({ key: "cms:bio-links", fetch: getBioLinks, format: asData, fallback: LIST_FALLBACK }),
  );

  // POST /api/cms/cache/reset — Invalida tutta la cache Redis del CMS (chiavi
  // `cms:*`): la prossima richiesta di ogni endpoint rilegge da DatoCMS. Utile
  // dopo una modifica ai contenuti senza aspettare la scadenza del TTL.
  // Auth: Bearer <CMS_ADMIN_TOKEN>. Se la env non è impostata la route risponde
  // sempre 401 (mai aperta per sbaglio).
  // Response: { status, data: { cleared, keys } }.
  fastify.post("/cms/cache/reset", async (request, reply) => {
    const auth = request.headers["authorization"] || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const { adminToken } = fastify.config.cms;
    if (!adminToken || token !== adminToken) {
      return reply.code(401).send({ status: 401, message: "unauthorized", data: [] });
    }

    // SCAN incrementale (mai KEYS, che blocca Redis) + UNLINK non bloccante.
    const keys = [];
    let cursor = "0";
    do {
      const [next, batch] = await fastify.redis.scan(
        cursor,
        "MATCH",
        `${CACHE_KEY_PREFIX}*`,
        "COUNT",
        100,
      );
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");

    if (keys.length > 0) await fastify.redis.unlink(...keys);

    fastify.log.info({ cleared: keys.length, keys }, "cache CMS invalidata");
    return { status: 200, data: { cleared: keys.length, keys } };
  });
};
