/**
 * Tracking costi OpenAI.
 * Costi per 1M tokens (Gennaio 2025; cache = 50% sconto su input).
 */
const PRICING = {
  "gpt-4o-mini": {
    input: 0.15,
    inputCached: 0.075,
    output: 0.6,
  },
};

const trackOpenAICost = (
  usage,
  model = "gpt-4o-mini",
  state = { totalTokensUsed: 0, totalCost: 0 },
) => {
  const cached = usage.cached_tokens ?? 0;
  const inputFull = Math.max(0, usage.prompt_tokens - cached);
  const prices = PRICING[model] || PRICING["gpt-4o-mini"];
  const inputCost = (inputFull / 1e6) * prices.input + (cached / 1e6) * prices.inputCached;
  const outputCost = (usage.completion_tokens / 1e6) * prices.output;
  const requestCost = inputCost + outputCost;

  state.totalTokensUsed = (state.totalTokensUsed || 0) + usage.total_tokens;
  state.totalCost = (state.totalCost || 0) + requestCost;

  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    requestCost,
    totalCostSession: state.totalCost,
    cachedTokens: cached,
  };
};

module.exports = {
  PRICING,
  trackOpenAICost,
};
