const path = require("node:path");
const cheerio = require("cheerio");
const {
  seedRows,
  delay,
  toAbsUrl,
  extFromUrlOrType,
  fetchBuffer,
  saveCandidateAsset,
  writeSourceCandidates,
  writeJson,
  root
} = require("./logo-candidates-common");

function parseSize(value) {
  const hit = String(value || "").match(/(\d+)x(\d+)/);
  return hit ? Math.max(Number(hit[1]), Number(hit[2])) : 0;
}

function priority(item) {
  if (item.kind === "manifest" && item.size >= 512) return 100;
  if (item.kind === "manifest") return 85;
  if (item.kind === "apple-touch-icon") return 80;
  if (item.kind === "mask-icon") return 60;
  if (item.kind === "icon") return 50;
  if (item.kind === "og:image") return 20;
  return 10;
}

async function collectForBrand(brand) {
  const baseUrl = `https://${brand.domain}/`;
  const entries = [];
  const errors = [];
  try {
    const page = await fetch(baseUrl, {
      headers: { "user-agent": "Mozilla/5.0 logo-candidates-harvester/1.0", accept: "text/html,*/*;q=0.8" },
      signal: AbortSignal.timeout(25000)
    });
    const html = await page.text();
    if (!page.ok) throw new Error(`homepage http ${page.status}`);
    const $ = cheerio.load(html);
    const links = [];

    $("link[rel]").each((_, el) => {
      const rel = String($(el).attr("rel") || "").toLowerCase();
      const href = $(el).attr("href");
      if (!href) return;
      if (rel.includes("manifest")) {
        links.push({ kind: "manifest-link", url: toAbsUrl(baseUrl, href), size: 0 });
      } else if (rel.includes("apple-touch-icon")) {
        links.push({ kind: "apple-touch-icon", url: toAbsUrl(baseUrl, href), size: parseSize($(el).attr("sizes")) });
      } else if (rel.includes("mask-icon")) {
        links.push({ kind: "mask-icon", url: toAbsUrl(baseUrl, href), size: 0 });
      } else if (rel.includes("icon")) {
        links.push({ kind: "icon", url: toAbsUrl(baseUrl, href), size: parseSize($(el).attr("sizes")) });
      }
    });
    $("meta[property='og:image'], meta[name='og:image']").each((_, el) => {
      const url = toAbsUrl(baseUrl, $(el).attr("content"));
      if (url) links.push({ kind: "og:image", url, size: 0 });
    });

    const manifestLinks = links.filter((item) => item.kind === "manifest-link");
    for (const manifest of manifestLinks) {
      try {
        const response = await fetch(manifest.url, { signal: AbortSignal.timeout(15000) });
        const json = await response.json();
        for (const icon of Array.isArray(json.icons) ? json.icons : []) {
          const iconUrl = toAbsUrl(manifest.url, icon.src);
          if (iconUrl) links.push({ kind: "manifest", url: iconUrl, size: parseSize(icon.sizes), purpose: icon.purpose || "" });
        }
      } catch (err) {
        errors.push(`manifest ${manifest.url}: ${err.message}`);
      }
    }

    const seen = new Set();
    const candidates = links
      .filter((item) => item.url && item.kind !== "manifest-link" && !seen.has(item.url) && seen.add(item.url))
      .sort((a, b) => priority(b) - priority(a))
      .slice(0, 4);

    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];
      try {
        const fetched = await fetchBuffer(item.url);
        if (!fetched.ok || !fetched.buffer.length) throw new Error(`http ${fetched.status}`);
        const ext = extFromUrlOrType(item.url, fetched.contentType);
        if (ext === "ico" || ext === "bin") throw new Error(`unsupported ${ext}`);
        entries.push(await saveCandidateAsset({
          sourceType: "website-icons",
          brand,
          sourceUrl: item.url,
          sourceName: "official website declared icon",
          license: "unknown",
          rawBuffer: fetched.buffer,
          originalFormat: ext,
          suffix: `${item.kind}_${i + 1}`,
          qualityScore: priority(item),
          matchConfidence: "medium",
          notes: item.kind
        }));
      } catch (err) {
        errors.push(`${item.kind} ${item.url}: ${err.message}`);
      }
    }
  } catch (err) {
    errors.push(err.message);
  }
  return { entries, errors };
}

async function main() {
  const all = [];
  const reportEntries = [];
  for (const brand of seedRows().filter((row) => row.domain)) {
    const result = await collectForBrand(brand);
    all.push(...result.entries);
    reportEntries.push({ brand_id: brand.brand_id, candidate_count: result.entries.length, errors: result.errors });
    console.log(`[website-icons] ${brand.brand_id} ${result.entries.length}`);
    await delay(1200);
  }
  writeSourceCandidates("website-icons", all);
  writeJson(path.join(root, "reports", "website-icons-collect-report.json"), {
    generated_at: new Date().toISOString(),
    candidate_count: all.length,
    entries: reportEntries
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
