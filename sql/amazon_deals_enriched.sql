-- amazon_deals_enriched
-- Materialized view: deal Amazon (feed_it_amazon_df_deals_v2) arricchiti con le
-- info prodotto di all_feeds_standard, match per asin.
--
-- Interrogata dal service src/services/datafeeds.js (getAmazonDealsByParam),
-- esposta da GET /api/datafeeds/amazon-deals.
--
-- È uno SNAPSHOT: dopo i reload dei feed va aggiornata (vedi REFRESH in fondo).
-- Eseguire i blocchi nell'ordine indicato.

-- 0) Prerequisito: senza questo indice la BUILD della matview fa un seq scan
--    su milioni di righe di all_feeds_standard per ogni deal.
CREATE INDEX IF NOT EXISTS idx_all_feeds_standard_asin
  ON all_feeds_standard (asin);

-- 1) Materialized view.
--    - colonne del deal elencate esplicitamente (no d.*) per poter ri-tipizzare
--      dealStartTime/dealEndTime da varchar a timestamptz mantenendone il nome;
--      formato sorgente "2026-03-09 23:00:00 +0000" -> parsato da ::timestamptz.
--      NULLIF(...,'') gestisce le stringhe vuote (-> NULL).
--    - s.asin NON riselezionato: collide con d.asin (stesso valore, chiave join).
--    - JOIN LATERAL ... LIMIT 1: una riga qualsiasi di all_feeds_standard per
--      asin (INNER: i deal senza match in all_feeds_standard non compaiono).
DROP MATERIALIZED VIEW IF EXISTS amazon_deals_enriched;

CREATE MATERIALIZED VIEW amazon_deals_enriched AS
SELECT
  d."dealID",
  d."dealType",
  d."dealState",
  d."category",
  d."asin",
  d."dealTitle",
  NULLIF(d."dealStartTime",'')::timestamptz AS "dealStartTime",
  NULLIF(d."dealEndTime",'')::timestamptz   AS "dealEndTime",
  d."referencePrice",
  d."referencePriceType",
  d."dealPrice",
  d."discountString",
  d."dealURL",
  d."imageURL",
  d."browseNodeId1",
  d."subcategoryPath1",
  d."browseNodeId2",
  d."subcategoryPath2",
  d."marketingMessage",
  s."browseNode1",
  s."browseNode2",
  s.ean,
  s."itemIsFBA",
  s."itemPrice",
  s."largeImageURL",
  s."listPrice",
  s."salesRank",
  s.title,
  s.feed_name
FROM feed_it_amazon_df_deals_v2 d
JOIN LATERAL (
  SELECT *
  FROM all_feeds_standard a
  WHERE a.asin = d.asin
  LIMIT 1
) s ON true
WITH DATA;

-- 2) Indici sulla matview.

-- Ricerca testuale sul titolo prodotto (all_feeds_standard.title).
-- DEVE essere su (title::text): il service filtra `title::text ILIKE %q%`,
-- un indice su `title` nudo non verrebbe usato. Richiede l'estensione pg_trgm.
CREATE INDEX IF NOT EXISTS idx_ade_title_trgm
  ON amazon_deals_enriched USING gin ((title::text) gin_trgm_ops);

-- Filtro finestra-attiva (now tra dealStartTime e dealEndTime).
CREATE INDEX IF NOT EXISTS idx_ade_window
  ON amazon_deals_enriched ("dealStartTime", "dealEndTime");

-- Lookup esatti frequenti.
CREATE INDEX IF NOT EXISTS idx_ade_asin
  ON amazon_deals_enriched (asin);
CREATE INDEX IF NOT EXISTS idx_ade_dealid
  ON amazon_deals_enriched ("dealID");

-- Filtro esatto per categoria (browseNodeId1).
CREATE INDEX IF NOT EXISTS idx_ade_browsenode1
  ON amazon_deals_enriched ("browseNodeId1");

-- Necessario per REFRESH ... CONCURRENTLY (non blocca le letture).
-- Se fallisce per duplicati, (dealID, asin) non è univoco: togli questo indice
-- e usa il REFRESH non concurrent (blocca le letture durante l'aggiornamento).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ade_unique
  ON amazon_deals_enriched ("dealID", asin);

-- 3) Aggiornamento (da lanciare a fine pipeline di reload dei feed).
--    Con idx_ade_unique presente:
--      REFRESH MATERIALIZED VIEW CONCURRENTLY amazon_deals_enriched;
--    Senza unique index:
--      REFRESH MATERIALIZED VIEW amazon_deals_enriched;
