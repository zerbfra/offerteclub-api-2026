const build = require("./app");
const config = require("./config");

/** Avvia il server in ascolto sulla porta configurata. */
async function start() {
  const app = await build();
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
