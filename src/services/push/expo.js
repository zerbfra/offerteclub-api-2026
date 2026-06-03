const { Expo } = require("expo-server-sdk");

const buildExpoClient = (config) =>
  new Expo({
    accessToken: config.push.expoAccessToken,
    useFcmV1: true,
  });

// Punteggio temporale di un device doc: ms del lastSeenAt (fallback createdAt).
// Gestisce sia i Timestamp dell'admin SDK sia i plain object {_seconds}.
const deviceScore = (data) => {
  const pick = (v) => {
    if (!v) return 0;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v._seconds === "number") return v._seconds * 1000;
    if (typeof v.seconds === "number") return v.seconds * 1000;
    return 0;
  };
  return Math.max(pick(data.lastSeenAt), pick(data.createdAt));
};

/**
 * Recupera tutti i device token validi per un uid.
 * Ritorna array di { token, deviceId, uid }.
 */
const getUserDeviceTokens = async (firestore, uid) => {
  const snap = await firestore.collection("users").doc(uid).collection("devices").get();
  const byToken = new Map(); // token -> { entry, score }
  snap.forEach((doc) => {
    const data = doc.data();
    if (!data || typeof data.pushToken !== "string" || !Expo.isExpoPushToken(data.pushToken)) return;
    // Dedup per pushToken: l'app crea un device doc nuovo ad ogni
    // registrazione/re-install senza cancellare i vecchi, quindi lo stesso
    // token può comparire più volte. Teniamo la registrazione PIÙ RECENTE
    // (lastSeenAt) così inviamo una sola push e ai receipts associamo il
    // device doc giusto da pulire in caso di DeviceNotRegistered.
    const score = deviceScore(data);
    const prev = byToken.get(data.pushToken);
    if (!prev || score > prev.score) {
      byToken.set(data.pushToken, { score, entry: { token: data.pushToken, deviceId: doc.id, uid } });
    }
  });
  return [...byToken.values()].map((v) => v.entry);
};

/**
 * Invia messaggi a Expo Push in chunk da 100. Ritorna array di
 * { ticket, message } per il successivo polling dei receipts.
 */
const sendBatch = async (expo, messages, log) => {
  if (!messages.length) return [];
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];
  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      ticketChunk.forEach((ticket, i) => {
        tickets.push({ ticket, message: chunk[i] });
      });
    } catch (err) {
      log?.error({ err }, "[push] sendPushNotificationsAsync failed");
    }
  }
  return tickets;
};

/**
 * Recupera i receipts per un set di ticketId. Va chiamato ~15 minuti dopo l'invio.
 * Ritorna mapping { ticketId: receipt }.
 */
const fetchReceipts = async (expo, ticketIds, log) => {
  if (!ticketIds.length) return {};
  const out = {};
  const chunks = expo.chunkPushNotificationReceiptIds(ticketIds);
  for (const chunk of chunks) {
    try {
      const r = await expo.getPushNotificationReceiptsAsync(chunk);
      Object.assign(out, r);
    } catch (err) {
      log?.error({ err }, "[push] getPushNotificationReceiptsAsync failed");
    }
  }
  return out;
};

/**
 * Rimuove il device doc Firestore per un token marcato DeviceNotRegistered.
 */
const cleanupDeviceToken = async (firestore, { uid, deviceId }, log) => {
  if (!uid || !deviceId) return;
  try {
    await firestore.collection("users").doc(uid).collection("devices").doc(deviceId).delete();
    log?.info({ uid, deviceId }, "[push] cleaned up invalid device token");
  } catch (err) {
    log?.warn({ err, uid, deviceId }, "[push] device cleanup failed");
  }
};

module.exports = {
  Expo,
  buildExpoClient,
  getUserDeviceTokens,
  sendBatch,
  fetchReceipts,
  cleanupDeviceToken,
};
