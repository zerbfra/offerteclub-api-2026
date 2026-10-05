# Push broadcast — integrazione (es. bot Telegram)

API per inviare una notifica push dell'app a tutti gli utenti (o a una lista di
uid) e seguirne l'avanzamento. Pensata per essere chiamata da un tool interno,
ad esempio un bot Telegram usato dallo staff.

## Autenticazione

Tutte le chiamate richiedono l'header:

```
Authorization: Bearer <PUSH_ADMIN_TOKEN>
```

Il token è lo stesso di `POST /api/push/test`. Va tenuto solo lato server del bot
(variabile d'ambiente), mai esposto agli utenti Telegram. Il bot deve inoltre
limitare i comandi agli admin (whitelist di `chat.id`/`from.id`), perché chiunque
possa scrivere al bot potrebbe altrimenti mandare push a tutta la base utenti.

## Flusso consigliato

1. **Dry run** → `POST /api/push/broadcast` con `dryRun: true`: mostra all'admin
   quante persone/device la riceveranno e l'anteprima del messaggio.
2. **Conferma** dell'admin (bottone inline).
3. **Invio** → stessa richiesta senza `dryRun`, con un `id` univoco. Risposta `202`.
4. **Stato** → `GET /api/push/broadcast/:id` ogni qualche secondo finché `status`
   è `done` o `failed`, poi riepilogo all'admin.

Usare lo **stesso `id`** tra conferma e invio rende sicuri i doppi click e i
retry: un secondo `POST` con un `id` già usato risponde `409` e non reinvia.

## `POST /api/push/broadcast`

### Body

| Campo | Tipo | Obbl. | Descrizione |
|---|---|---|---|
| `title` | string | sì | Titolo della notifica |
| `body` | string | sì | Testo della notifica |
| `type` | string | no | `generic` (default), `price_drop`, `discount_threshold`, `favorite_hit`, `community_hot`, `most_liked`, `web_landing`. Determina come l'app mostra/apre la notifica |
| `dealId` | string | no | Offerta da aprire al tap |
| `image` | string (URL) | no | Immagine mostrata dall'app (in `data.image` e nell'inbox) |
| `webUrl` | string (URL) | con `web_landing` | Pagina web da aprire nella modale |
| `webTitle` | string | no | Titolo della modale web |
| `data` | object | no | Campi extra passati all'app in `data` (i campi sopra hanno la precedenza) |
| `expo` | object | no | Opzioni del messaggio Expo, vedi sotto |
| `uids` | string[] | no | Limita l'invio a questi uid (max 10000). Senza: tutti gli utenti con push attive |
| `inbox` | boolean | no | Default `true`: salva la notifica anche nella sezione Notifiche dell'app |
| `id` | string | no | Id idempotente, `[A-Za-z0-9_-]`, max 64 caratteri. Se omesso viene generato |
| `dryRun` | boolean | no | `true` → nessun invio, ritorna solo i conteggi e l'anteprima |

Gli utenti con `notifPrefs.pushEnabled != true` sono **sempre esclusi**, anche se
presenti in `uids`. Un device registrato su più account riceve una sola push.

### Opzioni `expo`

| Campo | Piattaforma | Tipo | Note |
|---|---|---|---|
| `ttl` | Android, iOS | number (secondi) | Per quanto tempo ritentare la consegna se il device è offline |
| `expiration` | Android, iOS | number (unix seconds) | Alternativa a `ttl` |
| `priority` | Android, iOS | `default` \| `normal` \| `high` | Default `high` |
| `richContent` | Android, iOS | `{ "image": "<url>" }` | Immagine nativa nella notifica (iOS richiede `mutableContent` + estensione nell'app) |
| `categoryId` | Android, iOS | string | Categoria con azioni definita nell'app |
| `collapseId` | Android, iOS | string | Notifiche con lo stesso id si sostituiscono |
| `subtitle` | iOS | string | Sottotitolo sotto il titolo |
| `sound` | iOS | string \| null | Default `"default"`; `null` = silenziosa |
| `badge` | iOS | intero ≥ 0 | Numero sul badge dell'icona |
| `interruptionLevel` | iOS | `active` \| `critical` \| `passive` \| `time-sensitive` | |
| `threadId` | iOS | string | Raggruppamento visivo |
| `targetContentId` | iOS | string | |
| `relevanceScore` | iOS | 0–1 | Priorità nel riepilogo notifiche |
| `filterCriteria` | iOS | string | |
| `mutableContent` | iOS | boolean | |
| `contentAvailable` | iOS | boolean | Avvia l'app in background |
| `channelId` | Android | string | Default `"default"` |
| `icon` | Android | string | Nome di una drawable dell'app |
| `tag` | Android | string | Sostituisce una notifica già mostrata con lo stesso tag |

Campi sconosciuti o valori non validi → `400`. Il payload totale (title, body,
subtitle, data, …) deve stare sotto i **4 KB**, altrimenti `400`.

### Risposte

Dry run — `200`:

```json
{
  "status": 200,
  "data": {
    "dryRun": true,
    "recipients": 1520,
    "users": 1340,
    "devices": 1410,
    "message": { "title": "…", "body": "…", "sound": "default", "priority": "high", "channelId": "default", "data": { "type": "generic" } }
  }
}
```

- `recipients`: utenti con push attive (filtrati per `uids` se presente)
- `users`: di questi, quelli con almeno un device registrato
- `devices`: push che verranno effettivamente inviate

Invio — `202`:

```json
{ "status": 202, "data": { "id": "bf-2026" } }
```

Errori:

| Codice | Quando |
|---|---|
| `400` | Validazione fallita (`message` spiega il motivo) |
| `401` | Token mancante o errato |
| `409` | `id` già usato; `data` contiene lo stato di quel broadcast |

## `GET /api/push/broadcast/:id`

```json
{
  "status": 200,
  "data": {
    "id": "bf-2026",
    "status": "done",
    "createdAt": "2026-10-05T18:59:20.715Z",
    "startedAt": "2026-10-05T18:59:20.716Z",
    "finishedAt": "2026-10-05T19:00:02.101Z",
    "request": { "type": "generic", "title": "…", "body": "…", "uids": "all", "inbox": true },
    "recipients": 1520,
    "users": 1340,
    "devices": 1410,
    "tickets": { "sent": 1410, "ok": 1398, "error": 12, "failed": 0 },
    "errors": { "DeviceNotRegistered": 12 }
  }
}
```

- `status`: `queued` → `running` → `done` | `failed` (con `error`)
- `tickets.ok`: push accettate da Expo; `error`: rifiutate (dettaglio in `errors`);
  `failed`: blocchi che non è stato possibile inviare (errore di rete/Expo)
- `DeviceNotRegistered` è normale (app disinstallata): quei device vengono puliti
  automaticamente
- Lo stato resta consultabile per 7 giorni; poi `404`

## Esempio: bot Telegram (Node.js + grammY)

```js
const { Bot, InlineKeyboard } = require("grammy");

const API = process.env.OFFERTECLUB_API_URL; // es. https://api.offerteclub.it
const TOKEN = process.env.PUSH_ADMIN_TOKEN;
const ADMINS = new Set(process.env.ADMIN_IDS.split(",").map(Number));

const bot = new Bot(process.env.BOT_TOKEN);
const drafts = new Map(); // id -> payload in attesa di conferma

const api = async (method, path, body) => {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { code: res.status, json: await res.json() };
};

bot.use((ctx, next) => (ADMINS.has(ctx.from?.id) ? next() : undefined));

// /push Titolo | Testo
bot.command("push", async (ctx) => {
  const [title, body] = ctx.match.split("|").map((s) => s.trim());
  if (!title || !body) return ctx.reply("Uso: /push Titolo | Testo");

  const id = `tg-${Date.now()}`;
  const payload = { id, type: "generic", title, body, expo: { ttl: 6 * 3600 } };

  const { code, json } = await api("POST", "/push/broadcast", { ...payload, dryRun: true });
  if (code !== 200) return ctx.reply(`Errore: ${json.message}`);

  drafts.set(id, payload);
  const { users, devices } = json.data;
  await ctx.reply(
    `«${title}»\n${body}\n\nUtenti: ${users} · Device: ${devices}\nInviare?`,
    { reply_markup: new InlineKeyboard().text("Invia", `send:${id}`).text("Annulla", `cancel:${id}`) },
  );
});

bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
  drafts.delete(ctx.match[1]);
  await ctx.editMessageText("Annullato.");
});

bot.callbackQuery(/^send:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const payload = drafts.get(id);
  if (!payload) return ctx.answerCallbackQuery("Bozza scaduta");
  drafts.delete(id);
  await ctx.answerCallbackQuery();

  const { code, json } = await api("POST", "/push/broadcast", payload);
  if (code !== 202 && code !== 409) return ctx.editMessageText(`Errore: ${json.message}`);
  await ctx.editMessageText("Invio in corso…");

  // Polling dello stato
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const { json: s } = await api("GET", `/push/broadcast/${id}`);
    const st = s.data;
    if (st?.status === "done") {
      const t = st.tickets;
      return ctx.editMessageText(`Inviata ✅\nDevice: ${t.sent} · OK: ${t.ok} · Errori: ${t.error + t.failed}`);
    }
    if (st?.status === "failed") return ctx.editMessageText(`Fallita ❌ ${st.error}`);
  }
  await ctx.editMessageText(`Ancora in corso, controlla /status ${id}`);
});

bot.command("status", async (ctx) => {
  const { code, json } = await api("GET", `/push/broadcast/${ctx.match.trim()}`);
  await ctx.reply(code === 200 ? JSON.stringify(json.data, null, 2) : json.message);
});

bot.start();
```

Note:

- Le bozze in `drafts` sono in memoria: se il bot si riavvia tra anteprima e
  conferma, l'admin deve rilanciare `/push`.
- Per le immagini si può aggiungere `image` (mostrata dall'app) e/o
  `expo.richContent.image` (immagine nativa nella notifica).
- Per aprire un'offerta al tap usare `dealId`; per una pagina web
  `type: "web_landing"` + `webUrl`.
