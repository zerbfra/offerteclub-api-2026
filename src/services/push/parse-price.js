// Porting JS del parser presente nell'app mobile (lib/firebase.ts::parsePrice).
// Mantenere allineato se la logica lato app cambia.

const parsePrice = (priceStr) => {
  if (priceStr == null) return { current: null, original: null };
  if (typeof priceStr === "number") {
    return { current: Number.isFinite(priceStr) ? priceStr : null, original: null };
  }
  if (typeof priceStr !== "string" || !priceStr) {
    return { current: null, original: null };
  }

  const cleaned = priceStr.replace(/\s/g, "");
  const parts = cleaned.split(/invece\s*di/i);

  const parseSingle = (s) => {
    const match = s.match(/([\d.,]+)/);
    if (!match) return null;
    return parseFloat(match[1].replace(".", "").replace(",", "."));
  };

  return {
    current: parseSingle(parts[0]),
    original: parts[1] ? parseSingle(parts[1]) : null,
  };
};

const computeDiscount = (priceStr) => {
  const { current, original } = parsePrice(priceStr);
  if (current != null && original != null && original > 0) {
    return Math.round((1 - current / original) * 100);
  }
  return null;
};

module.exports = { parsePrice, computeDiscount };
