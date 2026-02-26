const fastify = require("fastify");
const config = require("./config");

async function build(opts = {}) {
  const app = fastify({ logger: true, ...opts });

  app.decorate("config", config);

  // REGISTER MIDDLEWARES
  await app.register(require("@fastify/cors"), { origin: true });
  await app.register(require("@fastify/rate-limit"), {
    max: 30,
    timeWindow: "1 minute",
  });

  // REGISTER ERROR HANDLER
  app.setErrorHandler((err, request, reply) => {
    app.log.error({ err, url: request.url }, err.message);
    const status = err.statusCode || 500;
    reply.status(status).send({
      status,
      message: err.message || "Internal Server Error",
      data: [],
    });
  });

  // REGISTER PLUGINS
  await app.register(require("./plugins/redis"));
  await app.register(require("./plugins/amazon"));

  // REGISTER ROUTES
  await app.register(require("./routes/amazon"), { prefix: "/api" });

  return app;
}

module.exports = build;
