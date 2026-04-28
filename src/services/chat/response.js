const path = require("path");
const { loadPrompt } = require("./query");
const { withRetry, truncateText } = require("../../lib/utils");
const { getOpenAIOutputText, normalizeOpenAIUsage } = require("./utils");

const buildProductsPayload = (hits) => {
  if (!Array.isArray(hits)) return [];
  return hits.map((hit, i) => {
    const baseInfo = {
      position: i + 1,
      title: hit.title || "N/A",
      price: hit.price_display || "N/A",
      category: hit.category || "N/A",
      features: hit.features || null,
      color: hit.attr_color_name || null,
      style: hit.attr_style_name || null,
      size: hit.attr_size_name || null,
      shop: hit.shop || null,
      asin: hit.asin || null,
      ean: hit.ean && String(hit.ean).trim() && hit.ean !== "undefined" ? hit.ean : null,
      url: hit.url && String(hit.url).trim() ? hit.url.trim() : null,
      available_in_shops:
        Array.isArray(hit.available_in_shops) && hit.available_in_shops.length > 0
          ? hit.available_in_shops
          : null,
    };
    if (hit.icecat_id) {
      baseInfo.icecat = {
        brand: hit.icecat_brand,
        title: hit.icecat_title,
        short_desc: truncateText(hit.icecat_short_desc, 250),
        bullets: truncateText(hit.icecat_bullets, 200, { arrayMaxItems: 3 }),
        attributes: hit.icecat_attributes,
      };
    } else if (hit.web_search_short_desc) {
      baseInfo.web_search = {
        brand: hit.web_search_brand || null,
        short_desc: truncateText(hit.web_search_short_desc, 250),
        bullets: truncateText(hit.web_search_bullets, 200, { arrayMaxItems: 3 }),
        category: hit.web_search_category || null,
      };
    }
    return baseInfo;
  });
};

const DEFAULT_PROMPT_RESPONSE_PATH = path.join(__dirname, "prompts", "promptResponse.txt");

const buildUserContent = ({
  userQuestion,
  parsedQuery,
  results,
  missingComparisonBrands,
  missingComparisonProductNames,
}) => {
  const productsInfo = buildProductsPayload(results?.hits ?? []);

  const missingBrandsNote =
    missingComparisonBrands && missingComparisonBrands.length > 0
      ? `\n    ATTENZIONE - Marche richieste dall'utente ma NON trovate: ${missingComparisonBrands.join(", ")}.
       Potrebbero non essere disponibili in catalogo, oppure non ci sono prodotti di questi brand che corrispondono alla categoria/filtri richiesti.
       Spiega all'utente in modo chiaro e cortese che al momento non sono disponibili prodotti di questi brand, e proponi i prodotti mostrati come valide alternative da considerare.`
      : "";

  const missingVariantsNote =
    missingComparisonProductNames && missingComparisonProductNames.length > 0
      ? `\n    ATTENZIONE - Varianti/nomi prodotto richiesti per il confronto ma NON trovati: ${missingComparisonProductNames.join(", ")}.
       Spiega all'utente che queste varianti non sono al momento disponibili e proponi i prodotti mostrati come alternative.`
      : "";

  return `Domanda utente: "${userQuestion}"
    Filtri applicati: ${parsedQuery?.filters ?? "nessuno"}
    Query di ricerca: "${parsedQuery?.searchQuery ?? ""}"
    Prodotti trovati (${results?.hits?.length ?? 0}):
    ${JSON.stringify(productsInfo, null, 2)}${missingBrandsNote}${missingVariantsNote}

    Presenta questi risultati all'utente in modo naturale e conversazionale.`;
};

const formatAssistantResponse = async (openai, options = {}) => {
  const {
    userQuestion,
    parsedQuery,
    results,
    missingComparisonBrands,
    missingComparisonProductNames,
    promptPath = DEFAULT_PROMPT_RESPONSE_PATH,
    onUsage,
    previousResponseId,
  } = options;

  const instructions = loadPrompt(promptPath);
  const userContent = buildUserContent({
    userQuestion,
    parsedQuery,
    results,
    missingComparisonBrands,
    missingComparisonProductNames,
  });

  try {
    const requestParams = {
      model: "gpt-4o-mini",
      instructions,
      input: userContent,
      temperature: 0.7,
    };
    if (!previousResponseId) {
      requestParams.prompt_cache_key = "response_formatter";
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
    return { text: outputText.trim(), responseId: response.id };
  } catch (error) {
    const code = error.status ?? error.code;
    console.error(
      "❌ Errore nella formattazione della risposta:",
      error.message,
      code != null ? `(code: ${code})` : "",
    );
    const hits = results?.hits ?? [];
    let fallback = `Ho trovato ${hits.length} risultati:\n\n`;
    hits.forEach((hit, i) => {
      fallback += `${i + 1}. ${hit.title || "N/A"}\n`;
      fallback += `   Prezzo: ${hit.price_display || "N/A"} | Categoria: ${
        hit.category || "N/A"
      }\n\n`;
    });
    return { text: fallback, responseId: null };
  }
};

const formatAssistantResponseStream = async (openai, options = {}, onChunk) => {
  const {
    userQuestion,
    parsedQuery,
    results,
    missingComparisonBrands,
    missingComparisonProductNames,
    promptPath = DEFAULT_PROMPT_RESPONSE_PATH,
    onUsage,
    previousResponseId,
  } = options;

  const instructions = loadPrompt(promptPath);
  const userContent = buildUserContent({
    userQuestion,
    parsedQuery,
    results,
    missingComparisonBrands,
    missingComparisonProductNames,
  });

  try {
    const requestParams = {
      model: "gpt-4o-mini",
      instructions,
      input: userContent,
      temperature: 0.7,
      stream: true,
    };
    if (!previousResponseId) {
      requestParams.prompt_cache_key = "response_formatter";
    } else {
      requestParams.previous_response_id = previousResponseId;
    }
    const stream = await withRetry(() => openai.responses.create(requestParams), {
      maxAttempts: 2,
      delayMs: 1000,
    });

    let fullText = "";
    let responseId = null;
    let usage = null;

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        fullText += event.delta;
        if (onChunk) await Promise.resolve(onChunk(event.delta));
      }
      if (event.type === "response.completed") {
        responseId = event.response.id;
        usage = event.response.usage;
      }
    }

    const normalizedUsage = normalizeOpenAIUsage(usage);
    if (onUsage && normalizedUsage) {
      onUsage(normalizedUsage);
    }

    return { text: fullText.trim(), responseId };
  } catch (error) {
    const code = error.status ?? error.code;
    console.error(
      "❌ Errore nella formattazione della risposta (stream):",
      error.message,
      code != null ? `(code: ${code})` : "",
    );
    const hits = results?.hits ?? [];
    let fallback = `Ho trovato ${hits.length} risultati:\n\n`;
    hits.forEach((hit, i) => {
      fallback += `${i + 1}. ${hit.title || "N/A"}\n`;
      fallback += `   Prezzo: ${hit.price_display || "N/A"} | Categoria: ${
        hit.category || "N/A"
      }\n\n`;
    });
    if (onChunk) await Promise.resolve(onChunk(fallback));
    return { text: fallback, responseId: null };
  }
};

module.exports = {
  buildProductsPayload,
  formatAssistantResponse,
  formatAssistantResponseStream,
};
