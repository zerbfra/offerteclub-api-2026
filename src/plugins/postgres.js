const fp = require("fastify-plugin");
const knex = require("knex");
const config = require("../config");

/** Registra il client Knex/Postgres su Fastify */
async function postgresPlugin(fastify) {
  const db = knex({
    client: "pg",
    connection: {
      connectionString: config.postgres.datafeeds.url,
      ssl: { rejectUnauthorized: false },
    },
    searchPath: ["knex", "public"],
  });

  fastify.decorate("pg", db);
  fastify.addHook("onClose", async () => db.destroy());
}

module.exports = fp(postgresPlugin, { name: "postgres" });
