# OfferteClub Web Gateway

Gateway HTTP (Fastify + Redis) che espone gli stessi endpoint della vecchia API per i prodotti Amazon: lookup per ASIN e ricerca per keyword. Vedi [PLAN.md](./PLAN.md) per l’architettura completa.

## Requisiti

- Node.js 20+
- Redis (locale o remoto)

## Setup

1. Copia le variabili d’ambiente:
   ```bash
   cp .env.example .env
   ```
2. Compila le variabili in `.env` (in particolare `AMAZON_CREDENTIAL_ID`, `AMAZON_CREDENTIAL_SECRET`; le altre hanno default).
3. Redis in sviluppo:
   ```bash
   docker compose up -d redis
   ```
4. Installa le dipendenze (già fatto se hai seguito il piano):
   ```bash
   npm install
   ```

## Avvio

```bash
npm start
# oppure in sviluppo con watch
npm run dev
```

Server in ascolto su `http://0.0.0.0:3000`.

## Endpoint

- **GET /health** — Health check (`{ status: 'ok', redis: boolean }`).
- **GET /api/amazon/lookup/:asins** — Lookup prodotti per ASIN (virgola-separated). Header: `x-store` o `country-code` (es. `it`, `es`). Risposta: `{ status, data }` (array di item).
- **GET /api/amazon/search/:keyword** — Ricerca per keyword. Query: `category`, `maxPrice`, `minPrice`, `brand`, `searchIndex`, `page`, `sortBy`. Risposta: `{ status, data }` (SearchResult).

## Test rapidi

```bash
curl http://localhost:3000/health
curl -H "x-store: it" "http://localhost:3000/api/amazon/lookup/B0DLFMFBJW,B0BFC7WQ6R"
curl -H "x-store: it" "http://localhost:3000/api/amazon/search/cuffie"
```
