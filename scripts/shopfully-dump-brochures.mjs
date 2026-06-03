#!/usr/bin/env node
// Discovery: for each configured target, list active brochures and dump
// both detail and pageflip responses to inspect data quality
// (related_offers, prices, EANs, page links).
// Input:  tmp/shopfully/companies-targets.json (produced by shopfully-list-companies.mjs)
// Output: tmp/shopfully/{slug}/brochure-{id}-{detail|pageflip}.json
//         tmp/shopfully/report.json
// Usage: node scripts/shopfully-dump-brochures.mjs [--max-brochures=N]

import "dotenv/config";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createOfferistaClient, extractItems } = require("../src/lib/offeristaClient.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const tmpDir = path.join(rootDir, "tmp", "shopfully");

const CONCURRENCY = 4;

function parseArgs() {
  const args = { maxBrochures: Infinity };
  for (const a of process.argv.slice(2)) {
    const m = /^--max-brochures=(\d+)$/.exec(a);
    if (m) args.maxBrochures = parseInt(m[1], 10);
  }
  return args;
}

async function pMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await mapper(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function summarizeBrochure(detail, pageflip) {
  const brochure = detail?.body?.brochure || detail?.body;
  const pageResult = brochure?.pageResult || {};
  const pages = Array.isArray(pageResult.pages) ? pageResult.pages : [];
  const totalLinks = pages.reduce((acc, p) => acc + (Array.isArray(p.links) ? p.links.length : 0), 0);

  const related = pageflip?.body?.relatedOffers?.offers || pageflip?.body?.relatedOffers || [];
  const relatedOffers = Array.isArray(related) ? related : [];
  const productsWithPrice = relatedOffers.filter((o) => o.resource === "product" && o.price != null).length;
  const productsWithEan = relatedOffers.filter((o) => o.resource === "product" && o.ean).length;

  return {
    brochureId: brochure?.id,
    title: brochure?.title,
    validFrom: brochure?.validFrom,
    validTo: brochure?.validTo,
    pageCount: pageResult.total ?? pages.length,
    totalLinks,
    relatedOffersCount: relatedOffers.length,
    productsWithPrice,
    productsWithEan,
  };
}

async function processTarget(client, target, maxBrochures) {
  const slugDir = path.join(tmpDir, target.slug);
  await fs.mkdir(slugDir, { recursive: true });

  console.log(`\n=== ${target.slug} (companyId=${target.id}) ===`);
  // Offerista brochures are listed via /offers with type=brochure (not /offers/brochures,
  // which only exposes /{id}, /redirect, and /{id}/related/offers).
  const brochures = [];
  let listPage = 0;
  let listTotal = null;
  for await (const res of client.paginate(
    "/offers",
    { type: "brochure", company_id: target.id },
    { pageSize: 1000 },
  )) {
    const items = extractItems(res.body).filter((it) => it.resource === "brochure" || it.id != null);
    listTotal = res.body?.result?.total ?? res.body?.total ?? listTotal;
    brochures.push(...items);
    listPage++;
    if (listPage === 1) {
      await fs.writeFile(path.join(slugDir, "_brochures-list.json"), JSON.stringify(res.body, null, 2));
    }
  }
  console.log(`  list: ${brochures.length} brochure(s)${listTotal != null ? ` (reported total=${listTotal})` : ""}`);

  const slice = brochures.slice(0, Math.min(maxBrochures, brochures.length));
  if (slice.length < brochures.length) {
    console.log(`  (sampling first ${slice.length})`);
  }

  const samples = await pMap(
    slice,
    async (b) => {
      const [detail, pageflip] = await Promise.all([
        client.request(`/offers/brochures/${b.id}`),
        client.request("/usecases/brochure_pageflip", { brochureId: b.id }),
      ]);
      await Promise.all([
        fs.writeFile(path.join(slugDir, `brochure-${b.id}-detail.json`), JSON.stringify(detail.body, null, 2)),
        fs.writeFile(path.join(slugDir, `brochure-${b.id}-pageflip.json`), JSON.stringify(pageflip.body, null, 2)),
      ]);
      const summary = summarizeBrochure(detail, pageflip);
      console.log(
        `    brochure ${b.id}: pages=${summary.pageCount} links=${summary.totalLinks} ` +
          `related=${summary.relatedOffersCount} (price=${summary.productsWithPrice} ean=${summary.productsWithEan})`,
      );
      return summary;
    },
    CONCURRENCY,
  );

  return {
    slug: target.slug,
    companyId: target.id,
    brochureCount: brochures.length,
    sampled: slice.length,
    samples,
  };
}

async function main() {
  const args = parseArgs();
  await fs.mkdir(tmpDir, { recursive: true });

  const targetsPath = path.join(tmpDir, "companies-targets.json");
  let targets;
  try {
    targets = JSON.parse(await fs.readFile(targetsPath, "utf8"));
  } catch {
    console.error(`Missing ${path.relative(rootDir, targetsPath)} — run \`npm run shopfully:companies\` first.`);
    process.exit(1);
  }

  const resolved = targets.filter((t) => t.id != null);
  if (resolved.length === 0) {
    console.error("No targets with a resolved id. Edit config/shopfully-companies.json and re-run discovery.");
    process.exit(1);
  }

  const client = createOfferistaClient();
  const report = [];
  for (const t of resolved) {
    const r = await processTarget(client, t, args.maxBrochures);
    report.push(r);
  }

  const reportPath = path.join(tmpDir, "report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved → ${path.relative(rootDir, reportPath)}`);

  // Aggregate ratios per slug.
  console.log("\nSummary (productsWithPrice / relatedOffersCount across sampled brochures):");
  for (const r of report) {
    const totalRelated = r.samples?.reduce((acc, s) => acc + (s.relatedOffersCount || 0), 0) || 0;
    const totalPriced = r.samples?.reduce((acc, s) => acc + (s.productsWithPrice || 0), 0) || 0;
    const ratio = totalRelated > 0 ? ((totalPriced / totalRelated) * 100).toFixed(1) + "%" : "n/a";
    console.log(`  ${r.slug.padEnd(12)} brochures=${r.brochureCount ?? 0} sampled=${r.sampled ?? 0} priced=${totalPriced}/${totalRelated} (${ratio})`);
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
