const admin = require("firebase-admin");

// TTL applicato a `users/{uid}/notifications/{id}.expiresAt`.
// Firestore TTL policy va configurata su `notifications` (collection group) con
// `expiresAt` come campo timestamp; cancellerà i doc entro 24h dalla scadenza.
const NOTIFICATION_TTL_DAYS = 90;

const notificationExpiresAt = () =>
  admin.firestore.Timestamp.fromMillis(Date.now() + NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000);

module.exports = { notificationExpiresAt, NOTIFICATION_TTL_DAYS };
