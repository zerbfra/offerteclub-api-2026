// Endpoint CMS-like: per ora i contenuti sono hardcoded qui, in futuro
// arriveranno da un CMS esterno (es. Sanity/Strapi) — la forma della response
// resta stabile così il client non cambia.

const TOP_BRANDS = [
  "Apple",
  "Samsung",
  "Sony",
  "LG",
  "Bosch",
  "Philips",
  "Dyson",
  "Xiaomi",
  "Lenovo",
  "HP",
  "Asus",
  "Microsoft",
  "Nintendo",
  "JBL",
  "Logitech",
  "De’Longhi",
  "Tineco",
  "Roborock",
  "Anker",
  "Garmin",
];

const AI_CHIPS = [
  {
    label: "Notebook uni",
    query:
      "Cerco un notebook per università con buona autonomia, schermo 14-15 pollici, 16GB RAM e prezzo sotto 700€.",
  },
  {
    label: "Regalo <50€",
    query: "Mi suggerisci 3 idee regalo originali con un prezzo sotto i 50€?",
  },
  {
    label: "Gaming",
    query:
      "Voglio fare un setup gaming completo con un buon rapporto qualità/prezzo. Quali offerte mi consigli?",
  },
  {
    label: "Casa smart",
    query:
      "Sto cercando dispositivi smart home utili in sconto: aspirapolvere, illuminazione, assistenti vocali.",
  },
];

module.exports = async function (fastify) {
  // GET /api/cms/top-brands — Lista dei brand in evidenza per la home/discovery.
  fastify.get("/cms/top-brands", async () => {
    return { status: 200, data: TOP_BRANDS };
  });

  // GET /api/cms/ai-chips — Suggerimenti rapidi (chip) per la chat AI.
  fastify.get("/cms/ai-chips", async () => {
    return { status: 200, data: AI_CHIPS };
  });
};
