const { searchWithFallback, getSortFromParsedQuery, hasSpecificBrand } = require("./query");
const config = require("../../config");
const { enrichProducts } = require("./api_gateway/enrichment");

/**
 * Pipeline: domanda utente → risultati pronti.
 * 1. Parse domanda (OpenAI) → parsedQuery
 * 2. Ricerca con fallback (con sort + diversificazione brand)
 * 3. Slice a limitDisplay risultati
 * 4. Arricchimento (Amazon CreatorsAPI + datafeeds via service locali) - soft fail
 */
const runSearchPipeline = async (index, userQuestion, options = {}) => {
  const {
    embedderName,
    parseUserQuery,
    limitDisplay = 5,
    limitFetch = 15,
    session,
    enrichDeps,
  } = options;

  if (!parseUserQuery || typeof parseUserQuery !== "function") {
    throw new Error("runSearchPipeline: parseUserQuery is required");
  }

  const previousResponseId = session?.queryResponseId ?? null;
  const previousParsedQuery = session?.lastParsedQuery ?? null;
  const fullResult = await parseUserQuery(userQuestion, {
    previousResponseId,
    previousParsedQuery,
  });
  const {
    _responseId: queryResponseId,
    shouldResetContext = false,
    ...parsedQuery
  } = fullResult;

  const sort = getSortFromParsedQuery(parsedQuery);

  const willDiversify = !hasSpecificBrand(parsedQuery.filters);
  const fetchLimitForDiversify = config.meili.diversifyFetchLimit;

  const hasComparison =
    (parsedQuery.comparisonBrands && parsedQuery.comparisonBrands.length > 0) ||
    (parsedQuery.comparisonProductNames && parsedQuery.comparisonProductNames.length > 0);
  const fetchLimit = hasComparison
    ? Math.max(limitFetch, 20)
    : willDiversify
      ? Math.max(limitFetch, fetchLimitForDiversify)
      : limitFetch;

  const searchResult = await searchWithFallback(index, parsedQuery, {
    embedderName,
    limit: fetchLimit,
    diversifyBrands: true,
    sort,
    comparisonBrands: parsedQuery.comparisonBrands,
    comparisonProductNames: parsedQuery.comparisonProductNames,
  });

  const {
    results,
    fallbackLevel,
    usedFilters,
    essentialFilters,
    simplifiedQuery,
    missingComparisonBrands,
    missingComparisonProductNames,
  } = searchResult;
  results.hits = results.hits.slice(0, limitDisplay);

  if (enrichDeps) {
    try {
      results.hits = await enrichProducts(results.hits, enrichDeps);
    } catch (err) {
      console.warn(
        "[pipeline] Enrichment fallito:",
        err && err.message ? err.message : err,
      );
    }
  }

  return {
    parsedQuery,
    results,
    fallbackLevel,
    usedFilters,
    essentialFilters,
    simplifiedQuery,
    missingComparisonBrands: missingComparisonBrands ?? undefined,
    missingComparisonProductNames: missingComparisonProductNames ?? undefined,
    queryResponseId: queryResponseId ?? undefined,
    shouldResetContext,
  };
};

module.exports = {
  runSearchPipeline,
};
