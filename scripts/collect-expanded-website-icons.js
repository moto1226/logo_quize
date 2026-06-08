const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");
const {
  root,
  readCsv,
  readJson,
  writeJson,
  delay,
  toAbsUrl,
  extFromUrlOrType,
  fetchBuffer,
  saveCandidateAsset,
  readSourceCandidates,
  writeSourceCandidates
} = require("./logo-candidates-common");

const sourceType = "expanded-website-icons";
const expandedCsv = path.join(root, "logo_brand_expanded_candidates.csv");
const allCorpusJson = path.join(root, "data", "all_logo_candidates_index.json");
const reportFile = path.join(root, "reports", "expanded-website-icons-collect-report.json");

function norm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

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

function brandFromRow(row) {
  return {
    brand_id: row.brand_id,
    name_en: row.name_en,
    name_zh: row.name_zh,
    domain: row.domain_hint,
    similar_group: row.similar_group,
    industry: row.industry
  };
}

function brandKeys(row) {
  const out = new Set([row.brand_id, row.name_en, row.name_zh, row.domain_hint].map(norm));
  const domainRoot = String(row.domain_hint || "").split(".")[0];
  if (domainRoot) out.add(norm(domainRoot));
  return [...out].filter((key) => key && key.length > 1);
}

function corpusKeys(row) {
  const raw = String(row.raw_file || "").replace(/\\/g, "/").toLowerCase();
  const out = new Set([norm(row.title), norm(row.corpus_id)]);
  for (const part of raw.split("/")) {
    const base = part.replace(/\.(svg|png|jpe?g|webp)$/i, "");
    out.add(norm(base));
    out.add(norm(base.replace(/[-_ ]?(icon|default|color|logo)$/i, "")));
  }
  for (const pattern of [/public\/icons\/([^/]+)\//, /logos\/([^/]+)\//, /wikimedia\/([^/]+)\//]) {
    const match = raw.match(pattern);
    if (match) out.add(norm(match[1]));
  }
  if (row.legacy_svglogo_id) {
    out.add(norm(row.legacy_svglogo_id));
    out.add(norm(String(row.legacy_svglogo_id).replace(/^[^_]+_/, "")));
  }
  return [...out].filter((key) => key && key.length > 1);
}

function buildCorpusMap(rows) {
  const map = new Map();
  for (const row of rows) {
    for (const key of corpusKeys(row)) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
  }
  return map;
}

function hasCorpusMatch(brand, corpusMap) {
  return brandKeys(brand).some((key) => corpusMap.has(key));
}

async function collectForBrand(row) {
  const brand = brandFromRow(row);
  const baseUrl = `https://${brand.domain}/`;
  const entries = [];
  const errors = [];
  try {
    const page = await fetch(baseUrl, {
      headers: { "user-agent": "Mozilla/5.0 logo-quize-expanded-icons/0.1", accept: "text/html,*/*;q=0.8" },
      signal: AbortSignal.timeout(9000)
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

    for (const manifest of links.filter((item) => item.kind === "manifest-link").slice(0, 2)) {
      try {
        const response = await fetch(manifest.url, {
          headers: { "user-agent": "Mozilla/5.0 logo-quize-expanded-icons/0.1" },
          signal: AbortSignal.timeout(6000)
        });
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
      .slice(0, 2);

    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];
      try {
        const fetched = await fetchBuffer(item.url, { timeoutMs: 9000 });
        if (!fetched.ok || !fetched.buffer.length) throw new Error(`http ${fetched.status}`);
        const ext = extFromUrlOrType(item.url, fetched.contentType);
        if (ext === "ico" || ext === "bin") throw new Error(`unsupported ${ext}`);
        entries.push(await saveCandidateAsset({
          sourceType,
          brand,
          sourceUrl: item.url,
          sourceName: "official website declared icon",
          license: "unknown",
          rawBuffer: fetched.buffer,
          originalFormat: ext,
          suffix: `${item.kind}_${i + 1}`,
          qualityScore: priority(item),
          matchConfidence: "low",
          notes: `expanded candidate; ${item.kind}`
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
  if (!fs.existsSync(expandedCsv)) throw new Error("logo_brand_expanded_candidates.csv not found");
  const brands = readCsv(expandedCsv).filter((row) => row.domain_hint);
  const currentCorpus = fs.existsSync(allCorpusJson) ? readJson(allCorpusJson) : [];
  const existing = readSourceCandidates(sourceType);
  const existingByBrand = new Map(existing.map((row) => [row.brand_id, row]));
  const corpusMap = buildCorpusMap([...currentCorpus, ...existing.map((row) => ({
    corpus_id: `collected_${row.candidate_id}`,
    title: row.name_en || row.name_zh,
    source_type: row.source_type,
    raw_file: row.raw_file,
    legacy_svglogo_id: ""
  }))]);

  const all = [...existing];
  const oldReport = fs.existsSync(reportFile) ? readJson(reportFile) : { entries: [] };
  const reportEntries = Array.isArray(oldReport.entries) ? [...oldReport.entries] : [];
  const processed = new Set(reportEntries.map((row) => row.brand_id));
  for (const brand of brands) {
    if (processed.has(brand.brand_id)) continue;
    if (hasCorpusMatch(brand, corpusMap) || existingByBrand.has(brand.brand_id)) continue;
    const result = await collectForBrand(brand);
    all.push(...result.entries);
    if (result.entries[0]) existingByBrand.set(brand.brand_id, result.entries[0]);
    reportEntries.push({ brand_id: brand.brand_id, candidate_count: result.entries.length, errors: result.errors });
    console.log(`[expanded-website-icons] ${brand.brand_id} ${result.entries.length}`);
    writeSourceCandidates(sourceType, all);
    writeJson(reportFile, {
      generated_at: new Date().toISOString(),
      candidate_count: all.length,
      entries: reportEntries
    });
    await delay(250);
  }
  writeSourceCandidates(sourceType, all);
  writeJson(reportFile, {
    generated_at: new Date().toISOString(),
    candidate_count: all.length,
    entries: reportEntries
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
