const { fanOutPush } = require("./fan-out");

/**
 * Avvia il listener Firestore su `posts`. Ignora i documenti pre-esistenti
 * filtrando per `date >= startupAt`; le push allo storico vengono evitate sia
 * dalla query che, in caso di restart, dall'idempotency su Redis.
 *
 * Ritorna una funzione di stop (unsubscribe).
 */
const startPostsListener = (deps) => {
  const { firestore, config, log } = deps;
  const startupAt = Date.now();
  log?.info({ startupAt, country: config.push.country }, "[push] starting posts listener");

  const unsubscribe = firestore
    .collection("posts")
    .where("country", "==", config.push.country)
    .where("date", ">=", startupAt)
    .onSnapshot(
      (snap) => {
        snap.docChanges().forEach(async (change) => {
          if (change.type !== "added") return;
          const post = change.doc.data();
          try {
            await fanOutPush({ deps, postId: change.doc.id, post });
          } catch (err) {
            log?.error({ err, postId: change.doc.id }, "[push] fanOut failed");
          }
        });
      },
      (err) => {
        log?.error({ err }, "[push] snapshot error");
      },
    );

  return unsubscribe;
};

module.exports = { startPostsListener };
