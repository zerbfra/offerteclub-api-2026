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

module.exports = async function (fastify) {
  // GET /api/cms/top-brands — Lista dei brand in evidenza per la home/discovery.
  fastify.get("/cms/top-brands", async () => {
    return { status: 200, data: TOP_BRANDS };
  });
};
