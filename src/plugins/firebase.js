const fp = require("fastify-plugin");
const path = require("path");
const admin = require("firebase-admin");
const config = require("../config");

const loadServiceAccount = () => {
  if (config.firebase.credentialsJson) {
    const raw = config.firebase.credentialsJson.trim();
    const decoded = raw.startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(decoded);
  }
  return require(path.resolve(config.firebase.credentialsPath));
};

/** Registra Firebase Admin (Firestore) su Fastify. */
async function firebasePlugin(fastify) {
  const serviceAccount = loadServiceAccount();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  fastify.decorate("firebase", admin);
  fastify.decorate("firestore", admin.firestore());
}

module.exports = fp(firebasePlugin, { name: "firebase" });
