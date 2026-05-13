const fp = require("fastify-plugin");
const config = require("../config");
const { buildExpoClient, getUserDeviceTokens, sendBatch } = require("../services/push/expo");
const { processDueReceipts } = require("../services/push/receipts");
const { startPostsListener } = require("../services/push/listener");

/**
 * Registra il sottosistema push:
 *  - inizializza il client Expo;
 *  - decora `fastify.push` con helper per la route di test e il fan-out;
 *  - se `config.push.listenerEnabled`, avvia onSnapshot su `posts`;
 *  - avvia un poller periodico dei receipts.
 *
 * Dipende da `firebase` (firestore) e `redis`.
 */
async function pushPlugin(fastify) {
  const expo = buildExpoClient(config);

  const deps = {
    firestore: fastify.firestore,
    redis: fastify.redis,
    expo,
    config,
    log: fastify.log,
  };

  let unsubscribeListener = null;
  let receiptTimer = null;

  fastify.decorate("push", {
    expo,
    getUserDeviceTokens: (uid) => getUserDeviceTokens(fastify.firestore, uid),
    sendBatch: (messages) => sendBatch(expo, messages, fastify.log),
  });

  fastify.addHook("onReady", async () => {
    if (config.push.listenerEnabled) {
      unsubscribeListener = startPostsListener(deps);
    } else {
      fastify.log.info("[push] listener disabled (set PUSH_LISTENER_ENABLED=true to enable)");
    }

    const pollIntervalMs = config.push.receiptPollIntervalSeconds * 1000;
    const tick = async () => {
      try {
        const stats = await processDueReceipts(deps);
        if (stats.processed > 0) {
          fastify.log.info({ ...stats }, "[push] receipts poll");
        }
      } catch (err) {
        fastify.log.error({ err }, "[push] receipt poll failed");
      }
    };
    receiptTimer = setInterval(tick, pollIntervalMs);
    receiptTimer.unref?.();
  });

  fastify.addHook("onClose", async () => {
    if (unsubscribeListener) {
      try {
        unsubscribeListener();
      } catch (err) {
        fastify.log.warn({ err }, "[push] listener unsubscribe failed");
      }
      unsubscribeListener = null;
    }
    if (receiptTimer) {
      clearInterval(receiptTimer);
      receiptTimer = null;
    }
  });
}

module.exports = fp(pushPlugin, { name: "push", dependencies: ["firebase", "redis"] });
