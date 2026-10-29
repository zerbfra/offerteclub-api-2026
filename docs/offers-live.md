# Offerte live — integrazione pagina web

Feed in tempo reale delle offerte del canale Telegram `@offertepuntolive`.
La pagina carica lo storico via REST e riceve le nuove offerte via Socket.IO
appena vengono scritte su Firestore.

Base URL: `https://api-v2.offerte.club`

Origin ammessi su Socket.IO: `https://offerte.club`, `https://andreagaleazzi.com`
(e sottodomini, es. `www.`), `http://localhost` / `http://127.0.0.1` su qualsiasi
porta. Da altri domini la connessione viene rifiutata.

## Flusso

1. Connessione Socket.IO a `https://api-v2.offerte.club`.
2. Su ogni `connect` (anche le riconnessioni):
   - `emit("offers:live:join")` per entrare nella room;
   - `GET /api/offers/live` per (ri)caricare lo storico.
3. Su `offers:live:new` aggiungere l'offerta in cima alla lista.
4. Deduplicare per `docId`: dopo una riconnessione la stessa offerta può arrivare
   sia dalla REST che dal socket.

Il server non conserva gli eventi persi mentre il client è disconnesso: per questo
la REST va richiamata a ogni `connect`.

## `GET /api/offers/live`

| Query | Descrizione |
|---|---|
| `limit` | 1-100, default 20 |
| `before` | epoch ms. Passare il `date` dell'ultima offerta ricevuta per la pagina successiva ("carica altre") |
| `hours` | solo le offerte delle ultime N ore (es. `48`). Senza `limit` esplicito restituisce fino a 100 offerte |

Risposta:

```json
{ "status": 200, "data": { "offers": [Offer, ...], "count": 20 } }
```

Ordinate per `date` decrescente. `before` o `hours` non validi → `400`.

### Filtro ore da iframe

Il sito che incorpora la pagina passa le ore nell'URL dell'iframe:

```html
<iframe src="https://offerte.club/live?hours=48"></iframe>
```

La pagina le legge e le inoltra all'API:

```js
const hours = new URLSearchParams(location.search).get("hours");
const qs = hours ? `?hours=${encodeURIComponent(hours)}` : "?limit=20";
fetch(`${API}/api/offers/live${qs}`);
```

Le offerte che arrivano dal socket sono sempre nuove, quindi rientrano nella
finestra. Se la pagina resta aperta a lungo, eliminare lato client quelle con
`date < Date.now() - hours * 3600 * 1000`.

## Socket.IO

| Direzione | Evento | Dati |
|---|---|---|
| client → server | `offers:live:join` | — |
| client → server | `offers:live:leave` | — |
| server → client | `offers:live:new` | `Offer` |

Client: `socket.io-client` v4 (server 4.8).

## Offer

```json
{
  "docId": "ieaZkJOw6nTkbWGHfq6Z",
  "channel": { "chat": "@offertepuntolive" },
  "country": "it",
  "date": 1780268280284,
  "payload": {
    "title": "UGREEN DX4800 Plus NAS, ...",
    "price": "301,42€ invece di 396,42",
    "image": "https://ae-pic-a1.aliexpress-media.com/kf/....png",
    "framedImage": "https://assets.offerte.club/bot_uploads/upload_....jpg",
    "url": "https://ofclub.click/9nrqqc9",
    "shop": "aliexpress",
    "code": "SSIT50, ITSS50",
    "comment": "🅿️ Il prezzo segnalato è già comprensivo dello sconto PayPal di 45€",
    "asin": "aliex--1005012380952518"
  }
}
```

Campi `payload` utili per la card:

- `title`, `image` (foto prodotto) o `framedImage` (immagine già impaginata del post);
- `price`: stringa così com'è nel post, es. `"301,42€ invece di 396,42"`;
- `url`: link tracciato `ofclub.click`, **da usare per il bottone** (conta i click);
- `shop`: `amazon`, `aliexpress`, ...;
- `code` (codice sconto), `comment`, `time`: opzionali, possono mancare.

Altri campi (`openUrl`, `fullUrl`, `originalUrl`, `waUrl`, `provider`, ...) sono
interni e non vanno usati.

## Esempio (vanilla JS)

```html
<script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>
<ul id="offers"></ul>
<script>
  const API = "https://api-v2.offerte.club";
  const list = document.getElementById("offers");
  const seen = new Set();
  const hours = new URLSearchParams(location.search).get("hours");
  const qs = hours ? `?hours=${encodeURIComponent(hours)}` : "?limit=20";

  // elementi creati a mano (niente innerHTML): i dati arrivano dal post
  const card = (o) => {
    const li = document.createElement("li");
    li.dataset.date = o.date;
    const img = document.createElement("img");
    img.src = o.payload.image;
    img.alt = "";
    img.width = 120;
    const a = document.createElement("a");
    a.href = o.payload.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = o.payload.title;
    const price = document.createElement("span");
    price.className = "price";
    price.textContent = o.payload.price;
    li.append(img, a, price);
    return li;
  };

  const add = (o, top) => {
    if (seen.has(o.docId)) return;
    seen.add(o.docId);
    top ? list.prepend(card(o)) : list.append(card(o));
  };

  // con ?hours=N, ogni minuto toglie le offerte uscite dalla finestra
  if (hours) {
    setInterval(() => {
      const min = Date.now() - Number(hours) * 3600 * 1000;
      list.querySelectorAll("li").forEach((li) => {
        if (Number(li.dataset.date) < min) li.remove();
      });
    }, 60 * 1000);
  }

  const loadHistory = async () => {
    const res = await fetch(`${API}/api/offers/live${qs}`);
    const { data } = await res.json();
    // dalla più vecchia alla più nuova, così prepend lascia la più recente in cima
    data.offers.slice().reverse().forEach((o) => add(o, true));
  };

  const socket = io(API);
  socket.on("connect", () => {
    socket.emit("offers:live:join");
    loadHistory();
  });
  socket.on("offers:live:new", (o) => add(o, true));
</script>
```

## Esempio (React)

```jsx
import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const API = "https://api-v2.offerte.club";

export function useLiveOffers(hours) {
  const [offers, setOffers] = useState([]);
  const qs = hours ? `?hours=${encodeURIComponent(hours)}` : "?limit=20";

  useEffect(() => {
    const merge = (incoming) =>
      setOffers((prev) => {
        const byId = new Map([...incoming, ...prev].map((o) => [o.docId, o]));
        return [...byId.values()].sort((a, b) => b.date - a.date);
      });

    const socket = io(API);
    socket.on("connect", async () => {
      socket.emit("offers:live:join");
      const res = await fetch(`${API}/api/offers/live${qs}`);
      merge((await res.json()).data.offers);
    });
    socket.on("offers:live:new", (o) => merge([o]));
    return () => socket.disconnect();
  }, [qs]);

  return offers;
}

// uso: useLiveOffers(new URLSearchParams(location.search).get("hours"))
```

## Sviluppo in locale

- Contro produzione: basta aprire la pagina da `http://localhost:<porta>`.
- Contro API locale: `API = "http://localhost:<PORT>"` (porta di `npm run dev`).
