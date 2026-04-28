const fs = require("fs");
const path = require("path");
const { withRetry } = require("../../lib/utils");
const { extractJsonFromText, getOpenAIOutputText, normalizeOpenAIUsage } = require("./utils");
const config = require("../../config");

const SHOP_FILTER = config.meili.shopFilter;

const promptCache = new Map();

const loadPrompt = (promptPath) => {
  const absolutePath = path.isAbsolute(promptPath) ? promptPath : path.join(__dirname, promptPath);

  if (!promptCache.has(absolutePath)) {
    promptCache.set(absolutePath, fs.readFileSync(absolutePath, "utf8"));
  }

  return promptCache.get(absolutePath);
};

const getSemanticRatio = (parsedQuery) =>
  parsedQuery?.intentType === "bisogno" ? 0.82 : 0.6;

const createQueryParser =
  ({ openai, promptPath, onUsage }) =>
  async (userQuestion, { previousResponseId, previousParsedQuery } = {}) => {
    const instructions = loadPrompt(promptPath);

    let inputText = userQuestion;
    if (previousParsedQuery && previousParsedQuery.searchQuery != null) {
      const filtersStr =
        previousParsedQuery.filters != null && previousParsedQuery.filters !== ""
          ? previousParsedQuery.filters
          : "nessuno";
      inputText =
        `CONTESTO PRECEDENTE (usa per raffinamenti): searchQuery="${previousParsedQuery.searchQuery}", filters="${filtersStr}"\n\n` +
        `Nuova domanda utente: ${userQuestion}\n\n(Output: JSON.)`;
    } else {
      inputText = `${userQuestion}\n(Output: JSON.)`;
    }

    try {
      const requestParams = {
        model: "gpt-4o-mini",
        instructions,
        input: inputText,
        text: { format: { type: "json_object" } },
        temperature: 0.3,
      };
      if (!previousResponseId) {
        requestParams.prompt_cache_key = "query_parser";
      } else {
        requestParams.previous_response_id = previousResponseId;
      }

      const response = await withRetry(() => openai.responses.create(requestParams), {
        maxAttempts: 2,
        delayMs: 1000,
      });

      const normalizedUsage = normalizeOpenAIUsage(response.usage);

      if (onUsage && normalizedUsage) {
        onUsage(normalizedUsage);
      }

      const outputText = getOpenAIOutputText(response);
      const jsonStr = extractJsonFromText(outputText);
      const parsed = JSON.parse(jsonStr);
      return { ...parsed, _responseId: response.id };
    } catch (error) {
      const code = error.status ?? error.code;
      console.error(
        "❌ Errore nel parsing con OpenAI:",
        error.message,
        code != null ? `(code: ${code})` : "",
      );

      return {
        isRelevant: true,
        searchQuery: userQuestion,
        filters: null,
        explanation: "Uso la domanda originale senza filtri",
        shouldResetContext: false,
        _responseId: null,
      };
    }
  };

const isValidFilter = (filters) => {
  if (!filters || filters === "null" || String(filters).trim() === "") return false;
  const f = String(filters);
  if (/\bLIKE\b/i.test(f) || /\bsearchQuery\b/.test(f)) return false;
  return true;
};

const getSortFromParsedQuery = (parsedQuery) => {
  const sortBy = parsedQuery?.sortBy;
  const sortOrder = parsedQuery?.sortOrder || "desc";
  if (sortBy === "timestamp" || sortBy === "price") {
    return [`${sortBy}:${sortOrder}`];
  }
  return null;
};

const buildSearchOptions = (
  parsedQuery,
  { embedderName, limit = 5, sort, filters: filtersOverride } = {},
) => {
  const sortArray = sort || getSortFromParsedQuery(parsedQuery);
  const searchOptions = {
    hybrid: {
      semanticRatio: getSemanticRatio(parsedQuery),
      embedder: embedderName,
    },
    limit,
  };
  if (sortArray && sortArray.length > 0) {
    searchOptions.sort = sortArray;
  }

  const effectiveFilter = filtersOverride !== undefined ? filtersOverride : parsedQuery.filters;
  const shopFilter = SHOP_FILTER ? `shop = "${SHOP_FILTER}"` : null;
  if (isValidFilter(effectiveFilter) && shopFilter) {
    searchOptions.filter = `${effectiveFilter} AND ${shopFilter}`;
  } else if (isValidFilter(effectiveFilter)) {
    searchOptions.filter = effectiveFilter;
  } else if (shopFilter) {
    searchOptions.filter = shopFilter;
  }

  return searchOptions;
};

const extractMainKeywords = (query) => {
  if (!query || typeof query !== "string") {
    return query;
  }

  const words = query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.,;:!?()[\]{}'"]/g, ""))
    .filter((word) => word.length >= 2);

  return words.join(" ").trim() || query;
};

const extractEssentialFilters = (filters) => {
  if (!filters || typeof filters !== "string") {
    return null;
  }

  const essentialParts = [];
  const exclusionParts = [];

  const brandExclusionMatch = filters.match(/icecat_brand\s*!=\s*"([^"]+)"/g);
  if (brandExclusionMatch) {
    exclusionParts.push(...brandExclusionMatch);
  }

  const categoryExclusionMatch = filters.match(/icecat_category\s*!=\s*"([^"]+)"/g);
  if (categoryExclusionMatch) {
    exclusionParts.push(...categoryExclusionMatch);
  }

  const brandMatch = filters.match(/icecat_brand\s*=\s*"([^"]+)"/);
  if (brandMatch) {
    essentialParts.push(`icecat_brand = "${brandMatch[1]}"`);
  }

  const icecatCategoryMatch = filters.match(/icecat_category\s*=\s*"([^"]+)"/);
  if (icecatCategoryMatch) {
    essentialParts.push(`icecat_category = "${icecatCategoryMatch[1]}"`);
  } else {
    const categoryMatch = filters.match(/category\s*=\s*"([^"]+)"/);
    if (categoryMatch) {
      essentialParts.push(`category = "${categoryMatch[1]}"`);
    }
  }

  if (/has_discount\s*=\s*true/i.test(filters)) {
    essentialParts.push("has_discount = true");
  }

  const allParts = [...essentialParts, ...exclusionParts];
  return allParts.length > 0 ? allParts.join(" AND ") : null;
};

const hasSpecificBrand = (filters) => {
  if (!filters || typeof filters !== "string") {
    return false;
  }
  const brandMatch = filters.match(/icecat_brand\s*=\s*"([^"]+)"/);
  return Boolean(brandMatch);
};

const diversifyByBrand = (hits, maxPerBrand = 2, options = {}) => {
  if (!hits || hits.length === 0) {
    return hits;
  }

  const brandCount = new Map();
  const diversified = [];

  for (const hit of hits) {
    const brand = hit.icecat_brand || "Unknown";
    const count = brandCount.get(brand) || 0;

    if (count < maxPerBrand) {
      brandCount.set(brand, count + 1);
      diversified.push(hit);
    }
  }

  if (options.fill === true && typeof options.limit === "number" && options.limit > 0) {
    if (diversified.length >= options.limit) {
      return diversified.slice(0, options.limit);
    }
    const diversifiedSet = new Set(diversified);
    const excluded = hits.filter((h) => !diversifiedSet.has(h));
    return [...diversified, ...excluded.slice(0, options.limit - diversified.length)];
  }

  return diversified;
};

const getMinPerBrandForComparison = (comparisonBrands) => {
  if (!comparisonBrands || comparisonBrands.length === 0) return 2;
  return comparisonBrands.length === 2 ? 2 : 1;
};

const extractNonBrandFilters = (filters) => {
  if (!filters || typeof filters !== "string") {
    return null;
  }
  const brandOrPattern =
    /\(icecat_brand\s*=\s*"[^"]+"\s*(?:OR\s+icecat_brand\s*=\s*"[^"]+"\s*)*\)/gi;
  let cleaned = filters.replace(brandOrPattern, "").trim();
  cleaned = cleaned.replace(/^AND\s+/i, "").trim();
  cleaned = cleaned.replace(/\s+AND$/i, "").trim();
  return cleaned.length > 0 ? cleaned : null;
};

const searchComparisonBrands = async (index, parsedQuery, comparisonBrands, options = {}) => {
  const { embedderName, limit = 5, sortArray } = options;
  const minPerBrand = getMinPerBrandForComparison(comparisonBrands);

  const nonBrandFilters = extractNonBrandFilters(parsedQuery.filters);

  console.log(
    `  [Confronto] Ricerca separata per ${comparisonBrands.length} brand: ${comparisonBrands.join(", ")}`,
  );
  if (nonBrandFilters) {
    console.log(`  [Confronto] Filtri aggiuntivi applicati: ${nonBrandFilters}`);
  }

  const searchPromises = comparisonBrands.map(async (brand) => {
    let combinedFilter = `icecat_brand = "${brand}"`;
    if (nonBrandFilters) {
      combinedFilter += ` AND ${nonBrandFilters}`;
    }

    const searchOpts = buildSearchOptions(parsedQuery, {
      embedderName,
      limit: Math.max(minPerBrand * 2, 5),
      sort: sortArray,
      filters: combinedFilter,
    });

    let searchResult = await index.search(parsedQuery.searchQuery, searchOpts);

    if (searchResult.hits.length === 0) {
      console.log(`  [Confronto] Brand "${brand}" - 0 risultati con query, fallback senza query`);
      const fallbackOpts = {
        filter:
          SHOP_FILTER && !combinedFilter.includes(`shop = "${SHOP_FILTER}"`)
            ? `${combinedFilter} AND shop = "${SHOP_FILTER}"`
            : combinedFilter,
        limit: Math.max(minPerBrand * 2, 5),
      };
      if (sortArray && sortArray.length > 0) {
        fallbackOpts.sort = sortArray;
      }
      searchResult = await index.search("", fallbackOpts);
    }

    console.log(`  [Confronto] Brand "${brand}" - trovati ${searchResult.hits.length} prodotti`);
    return { brand, hits: searchResult.hits };
  });

  const brandResults = await Promise.all(searchPromises);

  const mergedHits = [];
  const brandHitsMap = new Map(brandResults.map((brandRow) => [brandRow.brand, brandRow.hits]));
  const maxRounds = Math.max(...brandResults.map((brandRow) => brandRow.hits.length));

  for (let round = 0; round < maxRounds && mergedHits.length < limit; round++) {
    for (const brand of comparisonBrands) {
      const hits = brandHitsMap.get(brand) || [];
      if (round < hits.length) {
        mergedHits.push(hits[round]);
        if (mergedHits.length >= limit) break;
      }
    }
  }

  const missingComparisonBrands = comparisonBrands.filter(
    (brand) => !mergedHits.some((h) => (h.icecat_brand || "") === brand),
  );

  if (missingComparisonBrands.length > 0) {
    console.log(`  [Confronto] Brand NON trovati: ${missingComparisonBrands.join(", ")}`);
  }

  const results = {
    hits: mergedHits,
    estimatedTotalHits: mergedHits.length,
  };

  return { results, fallbackLevel: 0, usedFilters: "comparison", missingComparisonBrands };
};

const hitMatchesProductName = (hit, productName) => {
  if (!productName || typeof productName !== "string") return false;
  const needle = productName.toLowerCase();
  const title = (hit.title || hit.icecat_title || "").toLowerCase();
  return title.includes(needle);
};

const searchComparisonProductNames = async (
  index,
  parsedQuery,
  comparisonProductNames,
  options = {},
) => {
  const { embedderName, limit = 5, sortArray } = options;
  const minPerName = getMinPerBrandForComparison(comparisonProductNames);
  const baseQuery = (parsedQuery.searchQuery || "").trim();

  console.log(
    `  [Confronto varianti] Ricerca separata per ${comparisonProductNames.length} nomi: ${comparisonProductNames.join(", ")}`,
  );

  const searchOptsBase = buildSearchOptions(parsedQuery, {
    embedderName,
    limit: Math.max(minPerName * 2, 5),
    sort: sortArray,
  });

  const searchPromises = comparisonProductNames.map(async (name) => {
    const query = baseQuery ? `${baseQuery} ${name}`.trim() : name;
    let searchResult = await index.search(query, searchOptsBase);

    if (searchResult.hits.length === 0 && baseQuery) {
      console.log(`  [Confronto varianti] "${name}" - 0 con query, fallback solo nome`);
      searchResult = await index.search(name, {
        ...searchOptsBase,
        filter: searchOptsBase.filter,
      });
    }
    if (searchResult.hits.length === 0) {
      console.log(`  [Confronto varianti] "${name}" - 0 risultati`);
    } else {
      console.log(
        `  [Confronto varianti] "${name}" - trovati ${searchResult.hits.length} prodotti`,
      );
    }
    return { name, hits: searchResult.hits };
  });

  const nameResults = await Promise.all(searchPromises);

  const mergedHits = [];
  const nameHitsMap = new Map(nameResults.map((nameRow) => [nameRow.name, nameRow.hits]));
  const maxRounds = Math.max(...nameResults.map((nameRow) => nameRow.hits.length), 0);

  for (let round = 0; round < maxRounds && mergedHits.length < limit; round++) {
    for (const productName of comparisonProductNames) {
      const hits = nameHitsMap.get(productName) || [];
      if (round < hits.length) {
        mergedHits.push(hits[round]);
        if (mergedHits.length >= limit) break;
      }
    }
  }

  const missingComparisonProductNames = comparisonProductNames.filter(
    (productName) => !mergedHits.some((h) => hitMatchesProductName(h, productName)),
  );
  if (missingComparisonProductNames.length > 0) {
    console.log(
      `  [Confronto varianti] Nomi NON trovati: ${missingComparisonProductNames.join(", ")}`,
    );
  }

  const results = {
    hits: mergedHits,
    estimatedTotalHits: mergedHits.length,
  };

  return {
    results,
    fallbackLevel: 0,
    usedFilters: "comparisonVariants",
    missingComparisonProductNames,
  };
};

const searchWithFallback = async (index, parsedQuery, options = {}) => {
  const {
    embedderName,
    limit = 5,
    diversifyBrands = true,
    sort,
    comparisonBrands,
    comparisonProductNames,
  } = options;
  const sortArray = sort || getSortFromParsedQuery(parsedQuery);

  if (comparisonProductNames && comparisonProductNames.length > 0) {
    return await searchComparisonProductNames(index, parsedQuery, comparisonProductNames, {
      embedderName,
      limit,
      sortArray,
    });
  }

  if (comparisonBrands && comparisonBrands.length > 0) {
    return await searchComparisonBrands(index, parsedQuery, comparisonBrands, {
      embedderName,
      limit,
      sortArray,
    });
  }

  const hasBrand = hasSpecificBrand(parsedQuery.filters);
  const shouldDiversify = diversifyBrands && !hasBrand;

  const searchOptions1 = buildSearchOptions(parsedQuery, { embedderName, limit, sort: sortArray });
  let results = await index.search(parsedQuery.searchQuery, searchOptions1);

  if (results.hits.length > 0) {
    if (shouldDiversify) {
      results.hits = diversifyByBrand(results.hits, 1, { fill: true, limit });
    }
    return { results, fallbackLevel: 0, usedFilters: "all" };
  }

  const essentialFilters = extractEssentialFilters(parsedQuery.filters);
  if (essentialFilters) {
    const searchOptions2 = buildSearchOptions(parsedQuery, {
      embedderName,
      limit,
      sort: sortArray,
      filters: essentialFilters,
    });
    results = await index.search(parsedQuery.searchQuery, searchOptions2);

    if (results.hits.length > 0) {
      if (shouldDiversify) {
        results.hits = diversifyByBrand(results.hits, 1, { fill: true, limit });
      }
      return { results, fallbackLevel: 1, usedFilters: "essential", essentialFilters };
    }
  }

  const searchOptions3 = buildSearchOptions(parsedQuery, {
    embedderName,
    limit,
    sort: sortArray,
    filters: null,
  });
  results = await index.search(parsedQuery.searchQuery, searchOptions3);

  if (results.hits.length > 0) {
    if (shouldDiversify) {
      results.hits = diversifyByBrand(results.hits, 1, { fill: true, limit });
    }
    return { results, fallbackLevel: 2, usedFilters: "none" };
  }

  const simplifiedQuery = extractMainKeywords(parsedQuery.searchQuery);
  results = await index.search(simplifiedQuery, searchOptions3);

  if (results.hits.length > 0) {
    if (shouldDiversify) {
      results.hits = diversifyByBrand(results.hits, 1, { fill: true, limit });
    }
  }

  return {
    results,
    fallbackLevel: 3,
    usedFilters: "none",
    simplifiedQuery: simplifiedQuery !== parsedQuery.searchQuery ? simplifiedQuery : undefined,
  };
};

module.exports = {
  loadPrompt,
  createQueryParser,
  buildSearchOptions,
  getSortFromParsedQuery,
  searchWithFallback,
  extractMainKeywords,
  extractEssentialFilters,
  diversifyByBrand,
  hasSpecificBrand,
};
