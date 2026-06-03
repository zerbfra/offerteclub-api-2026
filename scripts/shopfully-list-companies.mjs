#!/usr/bin/env node
// Discovery: list italian companies from Offerista and resolve target ids.
// Output:
//   tmp/shopfully/companies-it.json   — raw dump of all IT companies
//   tmp/shopfully/companies-targets.json — [{ slug, title, id }] for configured targets
// Usage: node scripts/shopfully-list-companies.mjs

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

async function main() {
  await fs.mkdir(tmpDir, { recursive: true });

  const targetsConfigPath = path.join(rootDir, "config", "shopfully-companies.json");
  const targetsConfig = JSON.parse(await fs.readFile(targetsConfigPath, "utf8"));
  const country = targetsConfig.country || "it";
  const targets = targetsConfig.targets || [];

  const client = createOfferistaClient();

  console.log(`Fetching /companies (account is expected to be scoped to ${country})…`);
  // Offerista pagination: `limit=<offset>,<count>` (single param), max count = 1000.
  const all = [];
  let pageIdx = 0;
  let reportedTotal = null;
  for await (const res of client.paginate("/companies", {}, { pageSize: 1000 })) {
    const items = extractItems(res.body);
    reportedTotal = res.body?.result?.total ?? res.body?.total ?? reportedTotal;
    all.push(...items);
    pageIdx++;
    console.log(`  page ${pageIdx}: +${items.length} (total ${all.length}${reportedTotal != null ? `/${reportedTotal}` : ""})`);
  }

  const dumpPath = path.join(tmpDir, "companies-it.json");
  await fs.writeFile(dumpPath, JSON.stringify(all, null, 2));
  console.log(`\nSaved ${all.length} companies → ${path.relative(rootDir, dumpPath)}\n`);

  const withOffers = all.filter((c) => c.hasOffers).length;
  console.log(`Summary: ${all.length} companies, ${withOffers} with hasOffers=true`);

  // Resolve targets by case-insensitive contains match on title.
  const resolved = [];
  console.log("\nResolving configured targets:");
  for (const t of targets) {
    const needle = String(t.title).toLowerCase();
    const matches = all.filter((c) => String(c.title || "").toLowerCase().includes(needle));
    if (matches.length === 0) {
      console.log(`  ✗ ${t.slug} (${t.title}) — NOT FOUND`);
      resolved.push({ slug: t.slug, title: t.title, id: null, candidates: [] });
    } else if (matches.length === 1) {
      const m = matches[0];
      console.log(`  ✓ ${t.slug} → id=${m.id} title="${m.title}"`);
      resolved.push({ slug: t.slug, title: m.title, id: m.id });
    } else {
      console.log(`  ? ${t.slug} (${t.title}) — multiple candidates:`);
      for (const m of matches) console.log(`      - id=${m.id} title="${m.title}" hasOffers=${m.hasOffers}`);
      // Heuristic: pick exact (case-insensitive) title match if present, else the first with hasOffers.
      const exact = matches.find((m) => String(m.title).toLowerCase() === needle);
      const pick = exact || matches.find((m) => m.hasOffers) || matches[0];
      console.log(`      → picked id=${pick.id} title="${pick.title}"`);
      resolved.push({
        slug: t.slug,
        title: pick.title,
        id: pick.id,
        candidates: matches.map((m) => ({ id: m.id, title: m.title, hasOffers: m.hasOffers })),
      });
    }
  }

  const targetsPath = path.join(tmpDir, "companies-targets.json");
  await fs.writeFile(targetsPath, JSON.stringify(resolved, null, 2));
  console.log(`\nSaved targets → ${path.relative(rootDir, targetsPath)}`);

  const unresolved = resolved.filter((r) => !r.id);
  if (unresolved.length > 0) {
    console.log(`\n⚠️  ${unresolved.length} target(s) unresolved: ${unresolved.map((r) => r.slug).join(", ")}`);
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
