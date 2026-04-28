const path = require("path");
const { getSession, resetSession, updateSession } = require("./session");
const { formatAssistantResponse, formatAssistantResponseStream } = require("./response");
const { appendLogTurn } = require("./log");

const MESSAGE_NOT_RELEVANT =
  "Mi dispiace, posso aiutarti solo con la ricerca di prodotti e offerte. " +
  "Non posso rispondere a domande al di fuori di questo ambito. " +
  'Prova a chiedermi qualcosa come: "Cerca un robot aspirapolvere economico", ' +
  '"Mi consigli uno smartphone con buone recensioni?", "Prodotti in offerta sotto i 50€".';

const MESSAGE_NO_RESULTS =
  "Mi dispiace, non ho trovato prodotti che corrispondono alla tua ricerca. " +
  "Prova a modificare i criteri o a fare una domanda diversa.";

const DEFAULT_PROMPT_RESPONSE_PATH = path.join(__dirname, "prompts", "promptResponse.txt");

/**
 * Gestisce il risultato della pipeline: sessione, rilevanza, formattazione risposta, update sessione.
 * @param {Object} redis - client Redis (decorato da Fastify)
 * @param {string} userId - id sessione utente
 * @param {string} userQuestion
 * @param {Object} searchResult - output di runSearchPipeline
 * @param {Object} options - { openai, promptPath?, onUsage?, onChunk?, botType? }
 */
const handlePipelineResult = async (redis, userId, userQuestion, searchResult, options = {}) => {
  const { openai, promptPath = DEFAULT_PROMPT_RESPONSE_PATH, onUsage, onChunk, botType } = options;
  const {
    parsedQuery,
    results,
    fallbackLevel,
    simplifiedQuery,
    missingComparisonBrands,
    missingComparisonProductNames,
    queryResponseId,
    shouldResetContext,
  } = searchResult;

  let session = await getSession(redis, userId);

  if (shouldResetContext) {
    await resetSession(redis, userId);
    session = await getSession(redis, userId);
  }

  if (!parsedQuery.isRelevant) {
    await updateSession(redis, userId, {
      queryResponseId: queryResponseId ?? session.queryResponseId,
    });

    if (botType) {
      await appendLogTurn(redis, userId, botType, {
        question: userQuestion,
        outcome: "not_relevant",
        answer: null,
        products: [],
      });
    }

    return {
      outcome: "not_relevant",
      message: MESSAGE_NOT_RELEVANT,
      parsedQuery,
      shouldResetContext,
    };
  }

  const lastParsedQuery = {
    searchQuery: parsedQuery.searchQuery,
    filters: parsedQuery.filters ?? null,
    intentType: parsedQuery.intentType,
    sortBy: parsedQuery.sortBy,
    sortOrder: parsedQuery.sortOrder,
  };

  if (results.hits.length === 0) {
    await updateSession(redis, userId, {
      queryResponseId: queryResponseId ?? session.queryResponseId,
      formatResponseId: null,
      lastParsedQuery,
    });

    if (botType) {
      await appendLogTurn(redis, userId, botType, {
        question: userQuestion,
        outcome: "no_results",
        answer: MESSAGE_NO_RESULTS,
        products: [],
      });
    }

    return {
      outcome: "no_results",
      message: MESSAGE_NO_RESULTS,
      parsedQuery,
      results,
      fallbackLevel,
      simplifiedQuery,
      shouldResetContext,
    };
  }

  const formatOptions = {
    userQuestion,
    parsedQuery,
    results,
    missingComparisonBrands,
    missingComparisonProductNames,
    promptPath,
    previousResponseId: session.formatResponseId,
    onUsage,
  };

  const formatResult = onChunk
    ? await formatAssistantResponseStream(openai, formatOptions, onChunk)
    : await formatAssistantResponse(openai, formatOptions);

  await updateSession(redis, userId, {
    queryResponseId: queryResponseId ?? session.queryResponseId,
    formatResponseId: formatResult.responseId ?? session.formatResponseId,
    lastParsedQuery,
  });

  if (botType) {
    await appendLogTurn(redis, userId, botType, {
      question: userQuestion,
      outcome: "results",
      answer: formatResult.text,
      products: results.hits,
    });
  }

  return {
    outcome: "results",
    parsedQuery,
    results,
    fallbackLevel,
    simplifiedQuery,
    missingComparisonBrands,
    assistantText: formatResult.text,
    formatResponseId: formatResult.responseId,
    queryResponseId,
    shouldResetContext,
  };
};

module.exports = {
  handlePipelineResult,
  MESSAGE_NOT_RELEVANT,
  MESSAGE_NO_RESULTS,
};
