#!/usr/bin/env node
/**
 * Pulizia device doc stale (DISTRUTTIVO).
 *
 * Il push token Expo è per-installazione, non per-utente: ai cambi account /
 * reinstall l'app crea nuovi doc `users/*​/devices/*` senza cancellare i vecchi,
 * così lo stesso token finisce sotto più uid e il telefono riceve l'unione
 * delle preferenze. Per ogni pushToken teniamo SOLO il doc col `lastSeenAt`
 * più recente (fallback: createdAt) e cancelliamo gli altri, anche cross-uid.
 *
 * Uso:
 *   node scripts/cleanup-stale-device-tokens.js          # dry-run (default)
 *   node scripts/cleanup-stale-device-tokens.js --apply  # cancella davvero
 */
const path = require("path");
const admin = require("firebase-admin");
const config = require("../src/config");

const APPLY = process.argv.includes("--apply");

const loadServiceAccount = () => {
  if (config.firebase.credentialsJson) {
    const raw = config.firebase.credentialsJson.trim();
    const decoded = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(decoded);
  }
  return require(path.resolve(config.firebase.credentialsPath));
};

const ts = (v) => (v && typeof v._seconds === "number" ? v._seconds : 0);

(async () => {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
  }
  const firestore = admin.firestore();

  const snap = await firestore.collectionGroup("devices").get();
  const byToken = new Map(); // token -> [{ ref, uid, deviceId, score }]
  let noToken = 0;

  snap.forEach((doc) => {
    const d = doc.data() || {};
    const token = d.pushToken;
    if (typeof token !== "string" || !token) {
      noToken += 1;
      return;
    }
    const segs = doc.ref.path.split("/");
    const score = Math.max(ts(d.lastSeenAt), ts(d.createdAt));
    if (!byToken.has(token)) byToken.set(token, []);
    byToken.get(token).push({ ref: doc.ref, uid: segs[1], deviceId: doc.id, score });
  });

  const toDelete = [];
  for (const [token, docs] of byToken) {
    if (docs.length <= 1) continue;
    docs.sort((a, b) => b.score - a.score); // più recente in testa
    const [keep, ...stale] = docs;
    console.log(
      `\ntoken ${token.slice(0, 28)}…  (${docs.length} doc) → tengo uid ${keep.uid} (lastSeen ${keep.score})`,
    );
    for (const s of stale) {
      console.log(`   ✗ cancello uid ${s.uid} device ${s.deviceId} (lastSeen ${s.score})`);
      toDelete.push(s.ref);
    }
  }

  console.log(
    `\nDoc totali: ${snap.size} | senza token: ${noToken} | token distinti: ${byToken.size} | da cancellare: ${toDelete.length}`,
  );

  if (!APPLY) {
    console.log("\nDRY-RUN: nessuna cancellazione. Rilancia con --apply per eseguire.");
    process.exit(0);
  }

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 400) {
    const batch = firestore.batch();
    toDelete.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
    deleted += Math.min(400, toDelete.length - i);
  }
  console.log(`\nCancellati ${deleted} device doc stale.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
