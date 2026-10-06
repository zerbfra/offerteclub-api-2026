const crypto = require("crypto");
const admin = require("firebase-admin");
const { getUserDeviceTokens, sendBatch } = require("./expo");
const { enqueueReceipts } = require("./receipts");
const { notificationExpiresAt } = require("./ttl");

const STATUS_PREFIX = "push:broadcast:";
const statusKey = (id) => `${STATUS_PREFIX}${id}`;

// Quanti uid leggiamo in parallelo da `users/{uid}/devices`.
const DEVICES_CONCURRENCY = 25;

// Limite Expo/APNs/FCM sul payload totale della notifica.
const MAX_PAYLOAD_BYTES = 4096;

const isString = (v) => typeof v === "string" && v.length > 0;
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isBool = (v) => typeof v === "boolean";
const oneOf = (values) => (v) => values.includes(v);

/**
 * Campi del messaggio Expo Push accettati dal body così come sono
 * (https://docs.expo.dev/push-notifications/sending-notifications/#message-request-format).
 * `to`, `title`, `body` e `data` sono gestiti a parte.
 */
const EXPO_FIELDS = {
  // Android & iOS
  ttl: (v) => isNumber(v) && v >= 0,
  expiration: (v) => isNumber(v) && v > 0,
  priority: oneOf(["default", "normal", "high"]),
  richContent: (v) => v && typeof v === "object" && !Array.isArray(v) && isString(v.image),
  categoryId: isString,
  collapseId: isString,
  // iOS
  subtitle: isString,
  sound: (v) => v === null || isString(v),
  badge: (v) => Number.isInteger(v) && v >= 0,
  interruptionLevel: oneOf(["active", "critical", "passive", "time-sensitive"]),
  threadId: isString,
  targetContentId: isString,
  relevanceScore: (v) => isNumber(v) && v >= 0 && v <= 1,
  filterCriteria: isString,
  mutableContent: isBool,
  contentAvailable: isBool,
  // Android
  channelId: isString,
  icon: isString,
  tag: isString,
};

// Default allineati a fan-out e /push/test.
const EXPO_DEFAULTS = { sound: "default", priority: "high", channelId: "default" };

/**
 * Valida e costruisce la parte "fissa" del messaggio Expo (tutto tranne `to`).
 * Ritorna { message } oppure { error }.
 */
const buildBroadcastMessage = ({ title, body, data, expo }) => {
  if (!isString(title) || !isString(body)) return { error: "title, body required" };
  if (expo !== undefined && (expo === null || typeof expo !== "object" || Array.isArray(expo))) {
    return { error: "expo must be an object" };
  }

  const message = { title, body, ...EXPO_DEFAULTS };
  for (const [key, value] of Object.entries(expo || {})) {
    const validate = EXPO_FIELDS[key];
    if (!validate) {
      return {
        error: `unknown expo field "${key}", allowed: ${Object.keys(EXPO_FIELDS).join(", ")}`,
      };
    }
    if (!validate(value)) return { error: `invalid value for expo.${key}` };
    message[key] = value;
  }
  message.data = data;

  const size = Buffer.byteLength(JSON.stringify(message), "utf8");
  if (size > MAX_PAYLOAD_BYTES) {
    return { error: `payload too big (${size} bytes, max ${MAX_PAYLOAD_BYTES})` };
  }
  return { message };
};

/**
 * Destinatari del broadcast: utenti con `notifPrefs.pushEnabled == true`,
 * eventualmente ristretti alla lista `uids`. L'opt-out dell'utente è sempre
 * rispettato, anche quando gli uid sono passati esplicitamente.
 */
const resolveRecipients = async (firestore, uids) => {
  if (Array.isArray(uids)) {
    const unique = [...new Set(uids)];
    const result = [];
    for (let i = 0; i < unique.length; i += 100) {
      const refs = unique.slice(i, i + 100).map((uid) => firestore.collection("users").doc(uid));
      const docs = await firestore.getAll(...refs);
      docs.forEach((d) => {
        if (d.data()?.notifPrefs?.pushEnabled === true) result.push(d.id);
      });
    }
    return result;
  }

  const snap = await firestore
    .collection("users")
    .where("notifPrefs.pushEnabled", "==", true)
    .select()
    .get();
  return snap.docs.map((d) => d.id);
};

/**
 * Raccoglie i device token di tutti gli uid, deduplicando i token condivisi
 * tra più uid (stesso device, account diversi): ogni device riceve una push.
 * Ritorna { tokensByUid: Map<uid, tokens[]>, devices }.
 */
const collectTokens = async (firestore, uids) => {
  const tokensByUid = new Map();
  const seen = new Set();
  let devices = 0;
  for (let i = 0; i < uids.length; i += DEVICES_CONCURRENCY) {
    const slice = uids.slice(i, i + DEVICES_CONCURRENCY);
    const results = await Promise.all(slice.map((uid) => getUserDeviceTokens(firestore, uid)));
    results.forEach((tokens, j) => {
      const fresh = tokens.filter((t) => !seen.has(t.token));
      if (fresh.length === 0) return;
      fresh.forEach((t) => seen.add(t.token));
      tokensByUid.set(slice[j], fresh);
      devices += fresh.length;
    });
  }
  return { tokensByUid, devices };
};

const saveStatus = (redis, ttlSeconds, status) =>
  redis.set(statusKey(status.id), JSON.stringify(status), "EX", ttlSeconds);

const getBroadcastStatus = async (redis, id) => {
  const raw = await redis.get(statusKey(id));
  return raw ? JSON.parse(raw) : null;
};

/**
 * Prenota un id di broadcast (SET NX). Ritorna `null` se l'id è già stato
 * usato, così un retry del client non rimanda la stessa campagna due volte.
 */
const reserveBroadcast = async (redis, ttlSeconds, { id, summary }) => {
  const broadcastId = id || crypto.randomUUID();
  const status = {
    id: broadcastId,
    status: "queued",
    createdAt: new Date().toISOString(),
    request: summary,
  };
  const ok = await redis.set(
    statusKey(broadcastId),
    JSON.stringify(status),
    "EX",
    ttlSeconds,
    "NX",
  );
  return ok === "OK" ? status : null;
};

/**
 * Esegue il broadcast: risolve i destinatari, invia in chunk da 100 (gestiti
 * dall'SDK, che fa anche retry/backoff sui 429), scrive il mirror in
 * `users/{uid}/notifications` e accoda i receipts. Aggiorna lo stato su Redis.
 */
const runBroadcast = async (deps, { status, uids, message, mirror }) => {
  const { firestore, redis, expo, config, log } = deps;
  const ttl = config.push.idempotencyTtlSeconds;

  Object.assign(status, { status: "running", startedAt: new Date().toISOString() });
  await saveStatus(redis, ttl, status);

  try {
    const recipients = await resolveRecipients(firestore, uids);
    const { tokensByUid, devices } = await collectTokens(firestore, recipients);
    Object.assign(status, { recipients: recipients.length, users: tokensByUid.size, devices });
    await saveStatus(redis, ttl, status);
    log?.info({ id: status.id, recipients: recipients.length, devices }, "[push] broadcast start");

    const deviceByToken = new Map();
    const messages = [];
    for (const tokens of tokensByUid.values()) {
      for (const t of tokens) {
        deviceByToken.set(t.token, t);
        messages.push({ ...message, to: t.token });
      }
    }

    const tickets = await sendBatch(expo, messages, log);
    const errors = {};
    let ok = 0;
    for (const { ticket } of tickets) {
      if (ticket.status === "ok") ok += 1;
      else {
        const code = ticket.details?.error || "unknown";
        errors[code] = (errors[code] || 0) + 1;
      }
    }

    if (mirror) {
      const writer = firestore.bulkWriter();
      writer.onWriteError((err) => {
        log?.warn({ err, id: status.id }, "[push] broadcast mirror write failed");
        return false;
      });
      for (const uid of tokensByUid.keys()) {
        const ref = firestore.collection("users").doc(uid).collection("notifications").doc();
        writer.create(ref, {
          ...mirror,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: notificationExpiresAt(),
          read: false,
        });
      }
      await writer.close();
    }

    await enqueueReceipts(
      redis,
      tickets.map((entry) => ({ ...entry, device: deviceByToken.get(entry.message.to) || null })),
      config.push.receiptDelaySeconds,
      ttl,
    );

    Object.assign(status, {
      status: "done",
      finishedAt: new Date().toISOString(),
      tickets: {
        sent: messages.length,
        ok,
        error: tickets.length - ok,
        failed: messages.length - tickets.length,
      },
      errors,
    });
    log?.info({ ...status }, "[push] broadcast done");
  } catch (err) {
    log?.error({ err, id: status.id }, "[push] broadcast failed");
    Object.assign(status, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: err.message,
    });
  }
  await saveStatus(redis, ttl, status);
  return status;
};

module.exports = {
  EXPO_FIELDS,
  buildBroadcastMessage,
  resolveRecipients,
  collectTokens,
  reserveBroadcast,
  runBroadcast,
  getBroadcastStatus,
};
