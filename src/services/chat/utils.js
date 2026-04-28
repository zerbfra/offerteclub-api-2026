/**
 * Utilità condivise per il chat bot (parsing OpenAI, estrazione output).
 */

const normalizeOpenAIUsage = (usage) => {
  if (!usage) return null;
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0,
  };
};

const extractJsonFromText = (raw) => {
  if (!raw || typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];
  return trimmed;
};

const getOpenAIOutputText = (response) => {
  const outputText =
    response.output_text ??
    (Array.isArray(response.output) &&
      response.output
        .filter((item) => item.type === "message" && item.content)
        .flatMap((item) =>
          (item.content || [])
            .filter((contentItem) => contentItem.type === "output_text" && contentItem.text)
            .map((contentItem) => contentItem.text),
        )
        .join(""));

  if (typeof outputText !== "string" || !outputText.trim()) {
    throw new Error("No output text from model");
  }

  return outputText;
};

module.exports = {
  extractJsonFromText,
  getOpenAIOutputText,
  normalizeOpenAIUsage,
};
