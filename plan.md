# OFFERTECLUB WEB GATEWAY — PIANO ARCHITETTURALE

> Gateway HTTP costruito su Fastify + Redis che fa da mediatore tra il frontend e le API esterne
> (Amazon CreatorsAPI, e future integrazioni). La vecchia implementazione in Express
> (`_old_offerteclub_web_api`) e il nuovo SDK Amazon (`creatorsapi-nodejs-sdk`) sono in `_pre/`
> come riferimento e sorgente da cui estrarre codice.

---

## 1. PERCHÉ UN GATEWAY

La vecchia API Express era un monolite con ~15 integrazioni mischiata nello stesso processo
(Amazon, Firebase, Postgres, ClickHouse, Elasticsearch, Keepa, Telegram...). Ogni deploy
toccava tutto. Ogni errore rischiava di bloccare tutto.

Il gateway nasce con uno scopo preciso: **separare il layer HTTP e cache** dal business logic
specifico. L'idea è:

```
Client (web/app)
       │
       ▼
[GATEWAY — Fastify + Redis]   ← questo progetto
       │
       ├── Amazon CreatorsAPI
       ├── [future: Keepa]
       ├── [future: CMS]
       └── [future: altri microservizi]
```

Il gateway:

- gestisce rate limiting, header parsing (store/lang), cors
- implementa il pattern **cache-aside** su Redis per tutte le risorse esterne
- espone endpoint unificati verso il client
- **non** contiene business logic applicativa (deals, utenti, ecc.)

---

## 2. STACK TECNICO

| Componente | Scelta                                         | Motivazione                                                       |
| ---------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| HTTP       | **Fastify v5**                                 | Plugin system nativo, schema validation, 2x più veloce di Express |
| Cache      | **ioredis**                                    | API async moderna, supporto TLS, pipelining                       |
| Amazon SDK | **creatorsapi-nodejs-sdk** (locale da `_pre/`) | SDK ufficiale Amazon v1.2.0 con OAuth2 (LWA/Cognito)              |
| Runtime    | **Node.js 20+**                                | LTS, ESM support, native fetch                                    |
| Config     | **dotenv**                                     | Standard de facto                                                 |
| Container  | **Docker Compose**                             | Redis locale in sviluppo                                          |

**Perché il nuovo SDK e non `paapi5-nodejs-sdk-5`?**

La vecchia API usava Amazon Product Advertising API 5 (PAAPI5) con chiavi IAM (AWS_ID/AWS_SECRET).
Il nuovo SDK `creatorsapi-nodejs-sdk` usa **OAuth2** (LWA o Cognito) ed è l'SDK ufficiale
Amazon per i creator. L'SDK è già presente in `_pre/creatorsapi-nodejs-sdk/` e va usato come
dipendenza locale (`file:`) oppure copiato in `vendor/`.

---

## 3. STRUTTURA DEL PROGETTO

```
offerteclub_web_gateway/
│
├── plan.md                        ← questo file
├── package.json
├── .env
├── .env.example
├── docker-compose.yml
│
├── vendor/
│   └── creatorsapi-nodejs-sdk/    ← SDK Amazon copiato da _pre/ (npm install locale)
│
└── src/
    ├── server.js                  ← entry point: crea app, chiama listen()
    ├── app.js                     ← factory: registra plugin e routes
    ├── config.js                  ← centralizza process.env con valori di default
    │
    ├── plugins/                   ← Fastify plugins: decorano l'istanza fastify
    │   ├── redis.js               ← ioredis → fastify.redis
    │   └── amazon.js              ← CreatorsAPI client → fastify.amazon
    │
    ├── routes/                    ← handler HTTP: registrano endpoint
    │   └── amazon.js              ← GET /api/amazon/lookup/:asins
    │
    ├── services/                  ← business logic: orchestrano lib + cache
    │   └── amazon.js              ← cache-aside: mget Redis → fetch SDK → mset Redis
    │
    └── lib/                       ← wrapper puri attorno a SDK/client terzi
        └── amazon.js              ← getItems(), searchItems(), getBrowseNodes()
```

### Principio di naming: atomico per contesto

Ogni cartella definisce il contesto; il nome del file descrive il dominio.
`routes/amazon.js` ≠ `services/amazon.js` ≠ `lib/amazon.js` — stessa parola, scope diverso.

Non si usa mai il suffisso `-Client`, `-Service`, `-Helper`, `-Util`.

### Flusso di una richiesta

```
GET /api/amazon/lookup/B0DLFMFBJW,B0BFC7WQ6R
         │
         ▼
  routes/amazon.js          ← valida params, estrae store da header
         │
         ▼
  services/amazon.js        ← logica cache-aside
    ├── redis.mget(keys)
    ├── se miss → lib/amazon.js → SDK → risposta
    └── redis.mset(nuovi, TTL)
         │
         ▼
  JSON response unificata
```

---

## 4. CONFIGURAZIONE (`config.js`)

Tutti i valori di `process.env` passano per `config.js`. Nessun altro file legge
`process.env` direttamente. Questo rende il progetto testabile e le dipendenze esplicite.

**Nota multi-marketplace**: `credentialId` e `credentialSecret` sono unici per account,
ma ogni marketplace Amazon ha il proprio dominio e il proprio partner tag affiliato.
La map `stores` centralizza questa relazione — aggiungere un nuovo store è modificare
solo questo file.

```js
// src/config.js
module.exports = {
  port: process.env.PORT || 3000,
  redis: {
    url: process.env.REDIS_URL,
    ttl: {
      amazon: parseInt(process.env.REDIS_AMAZON_TTL_HOURS || "3") * 3600,
    },
  },
  amazon: {
    credentialId: process.env.AMAZON_CREDENTIAL_ID,
    credentialSecret: process.env.AMAZON_CREDENTIAL_SECRET,
    version: process.env.AMAZON_VERSION || "3.2", // EU LWA
    // Map per-store: marketplace + partnerTag specifici per ogni paese
    stores: {
      it: {
        marketplace: "www.amazon.it",
        partnerTag: process.env.AMAZON_PARTNER_TAG_IT || "offertetech08-21",
      },
      es: {
        marketplace: "www.amazon.es",
        partnerTag: process.env.AMAZON_PARTNER_TAG_ES || "offerteclubes-21",
      },
    },
  },
  defaults: {
    store: process.env.DEFAULT_STORE || "it",
    lang: process.env.DEFAULT_LANG || "it",
  },
};
```

---

## 5. PLUGINS FASTIFY

### `plugins/redis.js`

Inizializza ioredis e lo decora sull'istanza Fastify come `fastify.redis`.
Usa `fastify-plugin` per condividere il decoratore tra tutti i plugin figli.

```js
// src/plugins/redis.js
const fp = require("fastify-plugin");
const Redis = require("ioredis");
const config = require("../config");

async function redisPlugin(fastify) {
  const client = new Redis(config.redis.url);
  client.on("error", (err) => fastify.log.error({ err }, "redis error"));
  fastify.decorate("redis", client);
  fastify.addHook("onClose", async () => client.quit());
}

module.exports = fp(redisPlugin, { name: "redis" });
```

### `plugins/amazon.js`

Istanzia il client CreatorsAPI e lo decora come `fastify.amazon`.
Il client gestisce internamente il token OAuth2 con caching e refresh.

```js
// src/plugins/amazon.js
const fp = require("fastify-plugin");
const { ApiClient, DefaultApi } = require("../../vendor/creatorsapi-nodejs-sdk/dist/index");
const config = require("../config");

async function amazonPlugin(fastify) {
  const apiClient = new ApiClient();
  apiClient.credentialId = config.amazon.credentialId;
  apiClient.credentialSecret = config.amazon.credentialSecret;
  apiClient.version = config.amazon.version;

  const api = new DefaultApi(apiClient);
  fastify.decorate("amazon", api);
}

module.exports = fp(amazonPlugin, { name: "amazon" });
```

---

## 6. LIB (`lib/amazon.js`)

Wrapper puro attorno al SDK: nessuna logica di cache, nessun riferimento a Fastify.
Riceve il client `api` come parametro (dependency injection) per facilitare i test.

```js
// src/lib/amazon.js
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

async function getItems(api, { marketplace, partnerTag, itemIds, resources = RESOURCES }) {
  // partnerTag e itemIds sono required nel costruttore del SDK
  const req = new GetItemsRequestContent(partnerTag, itemIds);
  req.resources = resources;
  return api.getItems(marketplace, req);
}

async function searchItems(
  api,
  { marketplace, partnerTag, keywords, searchIndex, itemCount = 10, resources = RESOURCES },
) {
  const req = new SearchItemsRequestContent();
  req.partnerTag = partnerTag;
  req.keywords = keywords;
  req.searchIndex = searchIndex;
  req.itemCount = itemCount;
  req.resources = resources;
  return api.searchItems(marketplace, { searchItemsRequestContent: req });
}

module.exports = { getItems, searchItems };
```

---

## 7. SERVICES (`services/amazon.js`)

Contiene la logica **cache-aside**: legge Redis, identifica i miss, va su Amazon,
salva i risultati e ritorna il merge. Non dipende da Fastify ma riceve `redis` e `amazon`
come argomenti (ancora dependency injection).

```js
// src/services/amazon.js
const { chunk } = require("lodash");
const amazonLib = require("../lib/amazon");
const config = require("../config");

const CHUNK_SIZE = 10; // limite Amazon CreatorsAPI per getItems

async function lookupByAsins(redis, amazon, { asins, store }) {
  const storeConfig = config.amazon.stores[store] || config.amazon.stores[config.defaults.store];
  const { marketplace, partnerTag } = storeConfig;
  const ttl = config.redis.ttl.amazon;

  // 1. Legge Redis in bulk (mget accetta array diretto)
  const keys = asins.map((asin) => `amazon_${store}:${asin}`);
  const cached = await redis.mget(keys);

  const hits = {};
  const misses = [];

  asins.forEach((asin, i) => {
    if (cached[i]) {
      hits[asin] = JSON.parse(cached[i]);
    } else {
      misses.push(asin);
    }
  });

  // 2. Fetch Amazon solo per i miss, in chunk da 10
  const fetched = [];
  for (const batch of chunk(misses, CHUNK_SIZE)) {
    try {
      const result = await amazonLib.getItems(amazon, { marketplace, partnerTag, itemIds: batch });
      if (result?.itemsResult?.items) fetched.push(...result.itemsResult.items);
      // partial errors: alcuni ASIN falliti ma la risposta è comunque valida
      if (result?.errors?.length) {
        result.errors.forEach(e => console.warn(`Amazon partial error [${e.code}]: ${e.message}`));
      }
    } catch (err) {
      // errore totale del batch: log e continua con gli altri chunk
      console.error(`Amazon getItems error [${batch.join(",")}]`, err?.status, err?.message);
    }
  }

  // 3. Salva i nuovi risultati in Redis con TTL
  if (fetched.length > 0) {
    const pipeline = redis.pipeline();
    fetched.forEach((item) => {
      pipeline.set(`amazon_${store}:${item.asin}`, JSON.stringify(item), "EX", ttl);
    });
    await pipeline.exec();
  }

  // 4. Merge e ritorna
  return [...Object.values(hits), ...fetched];
}

module.exports = { lookupByAsins };
```

---

## 8. ROUTES (`routes/amazon.js`)

Endpoint HTTP con schema Fastify per validazione e serializzazione automatica.
L'header `x-store` (o `country-code`) determina il marketplace Amazon.

```js
// src/routes/amazon.js
const amazonService = require("../services/amazon");

module.exports = async function (fastify) {
  fastify.get(
    "/amazon/lookup/:asins",
    {
      schema: {
        params: {
          type: "object",
          properties: { asins: { type: "string" } },
          required: ["asins"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "number" },
              data: { type: "array" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const store = request.headers["x-store"] || fastify.config.defaults.store;
      const asins = request.params.asins
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const data = await amazonService.lookupByAsins(fastify.redis, fastify.amazon, {
        asins,
        store,
      });
      return { status: 200, data };
    },
  );
};
```

---

## 9. APP E SERVER

```js
// src/app.js — factory Fastify
const fastify = require("fastify");
const config = require("./config");

async function build(opts = {}) {
  const app = fastify({ logger: true, ...opts });

  // Decora config sull'istanza
  app.decorate("config", config);

  // Plugins (ordine importante: redis e amazon prima delle routes)
  await app.register(require("./plugins/redis"));
  await app.register(require("./plugins/amazon"));

  // Routes con prefisso /api
  await app.register(require("./routes/amazon"), { prefix: "/api" });

  return app;
}

module.exports = build;
```

```js
// src/server.js — entry point
const build = require("./app");
const config = require("./config");

async function start() {
  const app = await build();
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
```

---

## 10. FASI DI IMPLEMENTAZIONE

### FASE 0 — Setup progetto

- [ ] Crea `package.json` con dipendenze: fastify, fastify-plugin, ioredis, lodash, dotenv
- [ ] Copia `_pre/creatorsapi-nodejs-sdk` in `vendor/creatorsapi-nodejs-sdk`
- [ ] Build SDK: `cd vendor/creatorsapi-nodejs-sdk && npm install && npm run build` (Babel transpila `src/` → `dist/`)
- [ ] Aggiunge `"creatorsapi-nodejs-sdk": "file:vendor/creatorsapi-nodejs-sdk"` in package.json
- [ ] Crea `.env.example` con tutte le variabili necessarie (nessun valore reale)
- [ ] Crea `docker-compose.yml` con Redis (immagine `redis:7-alpine`)
- [ ] Crea `.gitignore` (node_modules, .env, dist)

### FASE 1 — Core infrastructure

- [ ] `src/config.js` — lettura env
- [ ] `src/plugins/redis.js` — ioredis + decorator
- [ ] `src/plugins/amazon.js` — CreatorsAPI client + decorator
- [ ] `src/app.js` — factory Fastify con registrazione plugin
- [ ] `src/server.js` — listen

### FASE 2 — Amazon integration

- [ ] `src/lib/amazon.js` — wrapper `getItems()` e `searchItems()`
- [ ] `src/services/amazon.js` — cache-aside `lookupByAsins()`
- [ ] `src/routes/amazon.js` — `GET /api/amazon/lookup/:asins`
- [ ] Test manuale con curl / Postman

### FASE 3 — Hardening

- [ ] Aggiunge `@fastify/rate-limit` (30 req/min per IP)
- [ ] Aggiunge `@fastify/cors`
- [ ] Schema validazione su tutti i route params
- [ ] Gestione errori globale (`fastify.setErrorHandler`)
- [ ] Health check: `GET /health` → `{ status: 'ok', redis: bool }`

### FASE 4 — Estensioni future (non implementare ora)

- [ ] `routes/search.js` + `services/search.js` → ricerca per keyword
- [ ] `plugins/keepa.js` + `routes/keepa.js` → storico prezzi
- [ ] `plugins/cms.js` + `routes/cms.js` → proxy CMS headless
- [ ] Rate limiting per API key (non per IP)

---

## 11. VARIABILI D'AMBIENTE (`.env.example`)

```env
PORT=3000
DEFAULT_STORE=it
DEFAULT_LANG=it

# Redis
REDIS_URL=redis://localhost:6379
REDIS_AMAZON_TTL_HOURS=3

# Amazon CreatorsAPI — credenziali da Associates Central → Tools → Creators API
AMAZON_CREDENTIAL_ID=
AMAZON_CREDENTIAL_SECRET=
AMAZON_VERSION=3.2

# Partner tag per marketplace (overridono i default in config.js)
AMAZON_PARTNER_TAG_IT=offertetech08-21
AMAZON_PARTNER_TAG_ES=offerteclubes-21
```

**ATTENZIONE:** le credenziali AWS IAM presenti nel `.env` di `_old_offerteclub_web_api`
(AWS_ID, AWS_SECRET) appartengono alla vecchia PAAPI5 e **non vanno usate** con il nuovo
SDK OAuth2. Il nuovo SDK usa `AMAZON_CREDENTIAL_ID` / `AMAZON_CREDENTIAL_SECRET` che si
ottengono dal portale Amazon Associates / CreatorsAPI.

---

## 12. DOCKER COMPOSE (sviluppo locale)

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --save 60 1

volumes:
  redis_data:
```

---

## 13. CONVENZIONI E REGOLE

1. **Naming atomico**: `amazon.js`, `redis.js`, `config.js` — no suffissi descrittivi del pattern
2. **Dependency injection**: `lib/` e `services/` ricevono le dipendenze come parametri
3. **Un file, un dominio**: `routes/` → HTTP; `services/` → business logic; `lib/` → SDK wrapper
4. **Config centralizzata**: nessun `process.env` fuori da `config.js`
5. **Errori parziali**: un errore su Amazon non blocca i risultati in cache
6. **Pipeline Redis**: usare `redis.pipeline()` per operazioni bulk (mset)
7. **Schema Fastify**: ogni route ha schema per params, query e response (performance + docs)
8. **`fastify-plugin`**: obbligatorio nei plugin per esporre i decoratori al parent scope

---

## 14. DECISIONI APERTE

| Decisione                 | Opzioni                                  | Default suggerito                                                                                 |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Dove tenere il vendor SDK | `vendor/` locale vs `file:../_pre/...`   | `vendor/` — più pulito, no dipendenza da path esterno                                             |
| Auth Amazon versione      | `3.2` (EU LWA) vs `2.2` (EU Cognito)     | `3.2` — LWA è più moderno e stabile                                                               |
| Redis in produzione       | Docker vs managed (DigitalOcean/Upstash) | managed con TLS (`rediss://`)                                                                     |
| Logging                   | Fastify pino built-in vs winston         | Pino built-in — zero overhead                                                                     |
| Casing `item.asin`        | ~~`item.ASIN`~~                          | **Risolto**: `item.asin` minuscolo — confermato da `Item.js` riga 59 del SDK |

---

_Ultimo aggiornamento: 2026-02-26_
