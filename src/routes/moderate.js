module.exports = async function (fastify) {
  fastify.post("/moderate", async (request) => {
    const text = (request.body?.text ?? "").toString().slice(0, 2000);
    if (!text.trim()) return { flagged: false };

    try {
      const result = await fastify.openai.moderations.create({
        model: "omni-moderation-latest",
        input: text,
      });
      return { flagged: result?.results?.[0]?.flagged === true };
    } catch (err) {
      fastify.log.error({ err }, "[moderate] error");
      return { flagged: false };
    }
  });
};
