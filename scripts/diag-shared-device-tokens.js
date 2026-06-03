#!/usr/bin/env node
/**
 * Diagnostica (READ-ONLY) per l'ipotesi "device condiviso tra più utenti".
 *
 * Scandisce tutti i doc `users/*​/devices/*` e raggruppa per pushToken,
 * elencando i pushToken registrati sotto >1 uid. Sono questi i casi in cui
 * un singolo telefono riceve le push di più account (preferenze diverse).
 *
 * Uso:
 *   node scripts/diag-shared-device-tokens.js
 */
const path = require("path");
const admin = require("firebase-admin");
const config = require("../src/config");

const loadServiceAccount = () => {
  if (config.firebase.credentialsJson) {
    const raw = config.firebase.credentialsJson.trim();
    const decoded = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(decoded);
  }
  return require(path.resolve(config.firebase.credentialsPath));
};

(async () => {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
  }
  const firestore = admin.firestore();

  const snap = await firestore.collectionGroup("devices").get();
  const byToken = new Map(); // pushToken -> Set<uid>
  let totalDocs = 0;

  snap.forEach((doc) => {
    const token = doc.data()?.pushToken;
    if (typeof token !== "string" || !token) return;
    totalDocs += 1;
    // path: users/{uid}/devices/{deviceId}
    const segs = doc.ref.path.split("/");
    const uid = segs[1];
    if (!byToken.has(token)) byToken.set(token, new Set());
    byToken.get(token).add(uid);
  });

  const shared = [...byToken.entries()]
    .filter(([, uids]) => uids.size > 1)
    .sort((a, b) => b[1].size - a[1].size);

  console.log(`Device doc totali con pushToken: ${totalDocs}`);
  console.log(`pushToken distinti: ${byToken.size}`);
  console.log(`pushToken condivisi tra >1 uid: ${shared.length}`);
  console.log("");

  for (const [token, uids] of shared) {
    console.log(`token ${token.slice(0, 28)}…  →  ${uids.size} uid: ${[...uids].join(", ")}`);
  }

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
