const fp = require("fastify-plugin");
const { ApiClient, DefaultApi } = require("../../vendor/creatorsapi-nodejs-sdk/dist/index");
const config = require("../config");

/** Registra il client API Amazon (Creators API) su Fastify. */
async function amazonPlugin(fastify) {
  const apiClient = new ApiClient();
  apiClient.credentialId = config.amazon.credentialId;
  apiClient.credentialSecret = config.amazon.credentialSecret;
  apiClient.version = config.amazon.version;

  const api = new DefaultApi(apiClient);
  fastify.decorate("amazon", api);
}

module.exports = fp(amazonPlugin, { name: "amazon" });
