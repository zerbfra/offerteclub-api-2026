// Mappa il chat Telegram (es. "@offertepuntotech") alla categoria utente
// usata in users/{uid}.notifPrefs.channels. Tieni allineato col client mobile.

const MAP = {
  offertepuntotech: "tech",
  offertepuntocasa: "casa",
  offertepuntomoda: "moda",
  offertepuntobeauty: "moda",
};

const parseChannel = (chat) => {
  if (typeof chat !== "string") return null;
  const key = chat.trim().replace(/^@+/, "").toLowerCase();
  return MAP[key] ?? null;
};

module.exports = { parseChannel };
