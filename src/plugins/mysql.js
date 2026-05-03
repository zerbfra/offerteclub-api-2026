const fp = require("fastify-plugin");
const knex = require("knex");
const config = require("../config");

async function mysqlPlugin(fastify) {
  const db = knex({
    client: "mysql2",
    connection: {
      uri: config.mysql.telegramStats.url,
      ssl: { rejectUnauthorized: false },
    },
    pool: { min: 0, max: 5 },
  });

  fastify.decorate("mysql", db);
  fastify.addHook("onClose", async () => db.destroy());
}

module.exports = fp(mysqlPlugin, { name: "mysql" });
