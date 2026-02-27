const knex = require("knex")

const pg = (pgUrl) => knex({
  client: "pg",
  connection: {
    connectionString: pgUrl,
    ssl: { rejectUnauthorized: false },
  },
  searchPath: ["knex", "public"],
})

module.exports = pg
