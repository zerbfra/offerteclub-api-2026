#!/usr/bin/env node
// Download brochure page images from Offerista's IMS, using the detail JSON
// already saved by shopfully-dump-brochures.mjs.
//
// Usage:
//   node scripts/shopfully-download-images.mjs               # all dumped brochures
//   node scripts/shopfully-download-images.mjs --slug=mddiscount
//   node scripts/shopfully-download-images.mjs --brochure=1054734
//   node scripts/shopfully-download-images.mjs --max-per=2   # cap per target
//   node scripts/shopfully-download-images.mjs --logos       # also fetch brochure logos
//
// Output: tmp/shopfully/<slug>/images/<brochure_id>/page-<NN>.<ext>

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const tmpDir = path.join(rootDir, "tmp", "shopfully");

const CONCURRENCY = 4;

function parseArgs() {
  const args = { slug: null, brochure: null, maxPer: Infinity, logos: false };
  for (const a of process.argv.slice(2)) {
    let m;
    if ((m = /^--slug=(.+)$/.exec(a))) args.slug = m[1];
    else if ((m = /^--brochure=(\d+)$/.exec(a))) args.brochure = parseInt(m[1], 10);
    else if ((m = /^--max-per=(\d+)$/.exec(a))) args.maxPer = parseInt(m[1], 10);
    else if (a === "--logos") args.logos = true;
  }
  return args;
}

async function pMap(items, mapper, concurrency) {
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      await mapper(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

// Build the IMS url from the image metadata returned by the API.
// Per doc: https://{url}/{id}_{width}x{height}.{type}
function imsUrl(image) {
  if (!image?.url || image.id == null || !image.width || !image.height || !image.type) return null;
  const host = image.url.startsWith("http") ? image.url : `https://${image.url}`;
  return `${host}/${image.id}_${image.width}x${image.height}.${image.type}`;
}

async function downloadFile(url, destPath) {
  try {
    await fs.access(destPath);
    return { url, destPath, skipped: true };
  } catch {
    /* not exists, proceed */
  }
  const res = await fetch(url, {
    headers: { "User-Agent": "OfferteClub/discovery" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);
  return { url, destPath, bytes: buf.length, skipped: false };
}

async function listDetailFiles(args) {
  const slugs = args.slug ? [args.slug] : await fs.readdir(tmpDir).then((entries) => entries.filter((e) => !e.startsWith("_") && !e.startsWith(".") && !e.endsWith(".json")));
  const out = [];
  for (const slug of slugs) {
    const dir = path.join(tmpDir, slug);
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      console.warn(`  skipping ${slug}: directory not found`);
      continue;
    }
    const details = files.filter((f) => /^brochure-\d+-detail\.json$/.test(f));
    const sliced = isFinite(args.maxPer) ? details.slice(0, args.maxPer) : details;
    for (const f of sliced) {
      const id = parseInt(/(\d+)/.exec(f)[1], 10);
      if (args.brochure && id !== args.brochure) continue;
      out.push({ slug, brochureId: id, detailPath: path.join(dir, f) });
    }
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const targets = await listDetailFiles(args);
  if (targets.length === 0) {
    console.error("No brochure-detail JSON found. Run `npm run shopfully:dump` first.");
    process.exit(1);
  }

  console.log(`Downloading images for ${targets.length} brochure(s)…`);

  let totalImages = 0;
  let totalSkipped = 0;
  let totalBytes = 0;
  const errors = [];

  for (const t of targets) {
    const detail = JSON.parse(await fs.readFile(t.detailPath, "utf8"));
    const brochure = detail?.brochure || detail;
    const pages = brochure?.pageResult?.pages || [];

    const jobs = [];
    if (args.logos && brochure?.logo) {
      const url = imsUrl(brochure.logo);
      if (url) {
        const dest = path.join(tmpDir, t.slug, "images", String(t.brochureId), `logo.${brochure.logo.type}`);
        jobs.push({ url, dest, label: `logo` });
      }
    }
    for (const page of pages) {
      const url = imsUrl(page.image);
      if (!url) continue;
      const pageNum = String(page.number ?? 0).padStart(2, "0");
      const dest = path.join(tmpDir, t.slug, "images", String(t.brochureId), `page-${pageNum}.${page.image.type}`);
      jobs.push({ url, dest, label: `page ${pageNum}` });
    }

    if (jobs.length === 0) {
      console.log(`  ${t.slug}/${t.brochureId}: no pages`);
      continue;
    }

    console.log(`  ${t.slug}/${t.brochureId}: ${jobs.length} image(s) "${brochure?.title ?? ""}"`);
    await pMap(
      jobs,
      async (job) => {
        try {
          const r = await downloadFile(job.url, job.dest);
          if (r.skipped) {
            totalSkipped++;
          } else {
            totalImages++;
            totalBytes += r.bytes;
          }
        } catch (err) {
          errors.push({ ...job, error: err.message });
          console.warn(`    ✗ ${job.label}: ${err.message}`);
        }
      },
      CONCURRENCY,
    );
  }

  console.log(
    `\nDone. downloaded=${totalImages} (${(totalBytes / 1024 / 1024).toFixed(2)} MB), skipped=${totalSkipped}, errors=${errors.length}`,
  );
  if (errors.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
