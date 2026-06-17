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
} = require("../services/datocms");

// Response "lista": `data` = array (fallback: array vuoto).
const asList = (data) => ({ status: 200, data });
const LIST_FALLBACK = Object.freeze({ status: 200, data: [] });

// Response "attivo/contenuto": serve `data` solo se presente e attivo, altrimenti
// active:false/data:null (stesso shape anche come fallback su errore). Vale sia
// per announcement (campo `active`) sia per home-event (getHomeEvent ritorna solo
// l'evento attivo, o null).
const INACTIVE = Object.freeze({ status: 200, active: false, data: null });
const asActive = (value) =>
  value && value.active ? { status: 200, active: true, data: value } : INACTIVE;

module.exports = async function (fastify) {
  // Wrappa un getter DatoCMS con cache Redis + fallback su errore, e ritorna un
  // handler Fastify. `format(value)` costruisce la response (sia da cache che da
  // fetch); `fallback` è la response servita se DatoCMS è irraggiungibile.
  const datoCached =
    ({ key, fetch, format, fallback }) =>
    async () => {
      try {
        const cached = await fastify.redis.get(key);
        if (cached != null) return format(JSON.parse(cached));
      } catch (err) {
        fastify.log.warn({ err }, `${key}: lettura cache Redis fallita`);
      }

      let value;
      try {
        value = await fetch();
      } catch (err) {
        fastify.log.error({ err }, `${key}: DatoCMS irraggiungibile`);
        return fallback;
      }

      try {
        await fastify.redis.set(
          key,
          JSON.stringify(value),
          "EX",
          fastify.config.datocms.cacheTtlSeconds,
        );
      } catch (err) {
        fastify.log.warn({ err }, `${key}: scrittura cache Redis fallita`);
      }

      return format(value);
    };

  // GET /api/cms/top-brands — Brand in evidenza (modello `top_brand`, ordinati
  // per creazione). `data` = array di stringhe.
  fastify.get(
    "/cms/top-brands",
    datoCached({ key: "cms:top-brands", fetch: getTopBrands, format: asList, fallback: LIST_FALLBACK }),
  );

  // GET /api/cms/chips — Chip rapidi home/chat (modello `chip`, type "ai"=prompt
  // chat / "search"=keyword ricerca, ordinati per `position`). Ogni elemento:
  // type, label, query.
  fastify.get(
    "/cms/chips",
    datoCached({ key: "cms:chips", fetch: getChips, format: asList, fallback: LIST_FALLBACK }),
  );

  // GET /api/cms/home-chips — Chip categoria home (modello `chip`, type "home",
  // ordinati per `position`). Ogni elemento: key, label, pinned (true = ancorato
  // in testa), params (JSON).
  fastify.get(
    "/cms/home-chips",
    datoCached({ key: "cms:home-chips", fetch: getHomeChips, format: asList, fallback: LIST_FALLBACK }),
  );

  // GET /api/cms/slides — Slide/banner home (modello `slide`, ordinate per
  // `order`). Ogni slide: `image` + destinazione al tap (type "web"=URL http /
  // "screen"=route Expo Router, in `target`).
  fastify.get(
    "/cms/slides",
    datoCached({ key: "cms:slides", fetch: getSlides, format: asList, fallback: LIST_FALLBACK }),
  );

  // GET /api/cms/announcement — Comunicazione speciale (modello singleton
  // `announcement`). `data`: title, body, color (hex), type/target (come slides).
  // active:false/data:null quando non attiva. Per attivarla: `active: true` su
  // DatoCMS.
  fastify.get(
    "/cms/announcement",
    datoCached({ key: "cms:announcement", fetch: getAnnouncement, format: asActive, fallback: INACTIVE }),
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
};
