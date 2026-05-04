const fp = require("fastify-plugin");
const path = require("path");
const admin = require("firebase-admin");
const config = require("../config");

/** Registra Firebase Admin (Firestore) su Fastify. */
async function firebasePlugin(fastify) {
  const serviceAccount = require(path.resolve(config.firebase.credentialsPath));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  fastify.decorate("firebase", admin);
  fastify.decorate("firestore", admin.firestore());
}

module.exports = fp(firebasePlugin, { name: "firebase" });
