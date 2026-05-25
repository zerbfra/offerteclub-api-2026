const { fetchReceipts, cleanupDeviceToken } = require("./expo");

const QUEUE_KEY = "push:receipts:pending";
const META_PREFIX = "push:receipts:meta:";

const metaKey = (ticketId) => `${META_PREFIX}${ticketId}`;

/**
 * Accoda ticket per il polling dei receipts. Salva in Redis:
 *  - una sorted set `push:receipts:pending` con score = unix timestamp di "ready"
 *  - una hash `push:receipts:meta:{ticketId}` con uid/deviceId del device target
 *
 * I ticket vengono ripescati dal poller solo quando il loro score è <= now.
 */
const enqueueReceipts = async (redis, ticketRecords, delaySeconds, ttlSeconds) => {
  const readyAt = Math.floor(Date.now() / 1000) + delaySeconds;
  const pipeline = redis.pipeline();
  let added = 0;
  for (const { ticket, message, device } of ticketRecords) {
    const ticketId = ticket && ticket.id;
    if (!ticketId) continue;
    pipeline.zadd(QUEUE_KEY, readyAt, ticketId);
    pipeline.hset(metaKey(ticketId), {
      uid: device?.uid || "",
      deviceId: device?.deviceId || "",
      token: message?.to || "",
    });
    pipeline.expire(metaKey(ticketId), ttlSeconds);
    added += 1;
  }
  if (added === 0) return 0;
  await pipeline.exec();
  return added;
};

const consumeDueTickets = async (redis, max = 500) => {
  const now = Math.floor(Date.now() / 1000);
  const ticketIds = await redis.zrangebyscore(QUEUE_KEY, "-inf", now, "LIMIT", 0, max);
  if (ticketIds.length === 0) return [];

  const pipeline = redis.pipeline();
  ticketIds.forEach((id) => pipeline.hgetall(metaKey(id)));
  const metaResults = await pipeline.exec();

  return ticketIds.map((id, i) => ({
    ticketId: id,
    meta: metaResults[i]?.[1] || {},
  }));
};

const dropTickets = async (redis, ticketIds) => {
  if (!ticketIds.length) return;
  const pipeline = redis.pipeline();
  pipeline.zrem(QUEUE_KEY, ...ticketIds);
  ticketIds.forEach((id) => pipeline.del(metaKey(id)));
  await pipeline.exec();
};

/**
 * Processa un batch di ticket scaduti: chiede i receipts a Expo, gestisce
 * gli errori `DeviceNotRegistered` cancellando il device doc, e rimuove
 * comunque tutti i ticket processati dalla coda Redis.
 */
const processDueReceipts = async ({ redis, firestore, expo, log }) => {
  const due = await consumeDueTickets(redis);
  if (due.length === 0) return { processed: 0, errors: 0, cleaned: 0 };

  const receipts = await fetchReceipts(
    expo,
    due.map((d) => d.ticketId),
    log,
  );

  let errors = 0;
  let cleaned = 0;
  const resolved = [];

  for (const { ticketId, meta } of due) {
    const receipt = receipts[ticketId];
    if (!receipt) continue;
    resolved.push(ticketId);

    if (receipt.status === "error") {
      errors += 1;
      const details = receipt.details || {};
      if (details.error === "DeviceNotRegistered") {
        await cleanupDeviceToken(firestore, { uid: meta.uid, deviceId: meta.deviceId }, log);
        cleaned += 1;
      } else {
        log?.warn({ ticketId, receipt }, "[push] receipt error");
      }
    }
  }

  await dropTickets(redis, resolved);
  return { processed: resolved.length, errors, cleaned };
};

module.exports = { enqueueReceipts, processDueReceipts };
