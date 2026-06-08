const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const brandsFile = path.join(root, "miniprogram", "packages", "quiz", "data", "brands.js");
const cacheFile = path.join(root, "data", "brand_name_enrichment_cache.json");
const reportFile = path.join(root, "reports", "brand-name-enrichment-report.json");

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  })
);

const limit = Number(args.limit || 120);
const delayMs = Number(args.delay || 900);
const force = args.force === "true";
const enrichAll = args.all === "true";
const onlyBrands = new Set(String(args.brand || "").split(",").map((item) => item.trim()).filter(Boolean));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function normalizeWords(value) {
  return String(value || "")
    .replace(/\.(svg|png|jpe?g|webp)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decompactBrandName(value) {
  const text = normalizeWords(value);
  return text.replace(/(bank|cloud|group|labs|pay|app|air|ai|tv|store|systems|software|technologies)$/i, " $1").replace(/\s+/g, " ").trim();
}

function looksMachineGenerated(brand) {
  const name = String(brand.display_name || brand.name_en || "").trim();
  if (!name) return true;
  if (/[\u4e00-\u9fff]/.test(name)) return false;
  const compactName = normalize(name);
  const compactId = normalize(brand.brand_id);
  if (compactName === compactId && compactId.length >= 7) return true;
  if (/^[A-Z][a-z0-9]+$/.test(name) && name.length >= 9 && !name.includes(" ")) return true;
  return false;
}

function queryCandidates(brand) {
  const values = [
    brand.display_name,
    brand.name_en,
    `${brand.display_name || brand.name_en || brand.brand_id} brand`,
    `${brand.display_name || brand.name_en || brand.brand_id} company`,
    decompactBrandName(brand.display_name || brand.name_en || brand.brand_id),
    normalizeWords(brand.brand_id),
    decompactBrandName(brand.brand_id),
    String(brand.brand_id || "").replace(/([a-z])([A-Z])/g, "$1 $2")
  ];
  return [...new Set(values.map((value) => normalizeWords(value)).filter(Boolean))].slice(0, 4);
}

async function fetchJson(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        "user-agent": "logo-quiz-build-enrichment/0.1 (local data generation)"
      }
    });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === attempts) throw new Error(`HTTP ${response.status}`);
    await sleep(delayMs * attempt * 3);
  }
  throw new Error("request failed");
}

async function searchWikidata(query) {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "5");
  url.searchParams.set("search", query);
  return fetchJson(url);
}

async function getEntityLabels(id) {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("props", "labels|descriptions|aliases");
  url.searchParams.set("languages", "en|zh|zh-hans|zh-cn");
  url.searchParams.set("ids", id);
  return fetchJson(url);
}

function scoreResult(brand, query, result) {
  const queryNorm = normalize(query);
  const idNorm = normalize(brand.brand_id);
  const labelNorm = normalize(result.label);
  const desc = String(result.description || "").toLowerCase();
  let score = 0;
  if (labelNorm === queryNorm || labelNorm === idNorm) score += 90;
  else if (labelNorm.includes(queryNorm) || queryNorm.includes(labelNorm)) score += 72;
  else if (idNorm.length >= 5 && (labelNorm.includes(idNorm) || idNorm.includes(labelNorm))) score += 64;
  const businessLike = /\b(company|brand|corporation|software|bank|airline|retailer|manufacturer|website|service|platform|chain|automaker|product|restaurant|store|app|subsidiary|organization)\b/.test(desc);
  if (businessLike) score += 12;
  if (/\b(human|surname|given name|film|song|album|single|episode|book|fictional|pepper|chili|plant|species|protein|gene)\b/.test(desc)) score -= 35;
  if (!businessLike && score < 95) score -= 18;
  if (String(result.id || "").startsWith("Q")) score += 3;
  return score;
}

function bestSearchResult(brand, query, results) {
  let best = null;
  for (const result of results || []) {
    const score = scoreResult(brand, query, result);
    if (!best || score > best.score) best = { result, score };
  }
  return best;
}

function label(entity, language) {
  return entity?.labels?.[language]?.value || "";
}

function description(entity, language) {
  return entity?.descriptions?.[language]?.value || "";
}

function inferIndustry(descriptionText) {
  const text = String(descriptionText || "").toLowerCase();
  if (/\b(bank|financial|payment|fintech|insurance)\b/.test(text)) return "金融支付";
  if (/\b(airline|automaker|automobile|car|transport)\b/.test(text)) return "汽车交通";
  if (/\b(software|internet|technology|website|platform|cloud)\b/.test(text)) return "科技互联网";
  if (/\b(retail|restaurant|food|drink|consumer)\b/.test(text)) return "消费品牌";
  return "";
}

async function enrichBrand(brand) {
  for (const query of queryCandidates(brand)) {
    const search = await searchWikidata(query);
    const best = bestSearchResult(brand, query, search.search || []);
    await sleep(delayMs);
    if (!best || best.score < 80) continue;
    const entityPayload = await getEntityLabels(best.result.id);
    const entity = entityPayload.entities?.[best.result.id];
    await sleep(delayMs);
    const labelEn = label(entity, "en") || best.result.label || "";
    const labelZh = label(entity, "zh-hans") || label(entity, "zh-cn") || label(entity, "zh") || "";
    const descEn = description(entity, "en") || best.result.description || "";
    return {
      brand_id: brand.brand_id,
      status: "matched",
      source: "wikidata",
      wikidata_id: best.result.id,
      query,
      confidence: Math.min(100, best.score),
      label_en: labelEn,
      label_zh: labelZh,
      description_en: descEn,
      industry: inferIndustry(descEn),
      updated_at: new Date().toISOString()
    };
  }
  return {
    brand_id: brand.brand_id,
    status: "no_match",
    source: "wikidata",
    query: queryCandidates(brand)[0] || brand.brand_id,
    confidence: 0,
    updated_at: new Date().toISOString()
  };
}

async function main() {
  if (!fs.existsSync(brandsFile)) throw new Error("Run npm run build:quiz-data before enrichment.");
  delete require.cache[require.resolve(brandsFile)];
  const brands = require(brandsFile);
  const cache = readJson(cacheFile, { records: {} });
  const records = cache.records || cache;
  const candidates = brands
    .filter((brand) => onlyBrands.size === 0 || onlyBrands.has(brand.brand_id))
    .filter((brand) => enrichAll || looksMachineGenerated(brand))
    .filter((brand) => force || !records[brand.brand_id] || records[brand.brand_id].status === "error")
    .slice(0, limit);
  let matched = 0;
  let failed = 0;
  for (const brand of candidates) {
    try {
      const record = await enrichBrand(brand);
      records[brand.brand_id] = record;
      if (record.status === "matched") matched += 1;
      writeJson(cacheFile, { generated_at: new Date().toISOString(), records });
      console.log(`${record.status.padEnd(8)} ${brand.brand_id} -> ${record.label_zh || record.label_en || record.query}`);
    } catch (err) {
      failed += 1;
      records[brand.brand_id] = {
        brand_id: brand.brand_id,
        status: "error",
        source: "wikidata",
        error: err.message,
        updated_at: new Date().toISOString()
      };
      writeJson(cacheFile, { generated_at: new Date().toISOString(), records });
      console.error(`error    ${brand.brand_id}: ${err.message}`);
    }
  }
  const output = {
    generated_at: new Date().toISOString(),
    records
  };
  writeJson(cacheFile, output);
  writeJson(reportFile, {
    generated_at: output.generated_at,
    candidate_count: candidates.length,
    matched_count: matched,
    failed_count: failed,
    total_cache_records: Object.keys(records).length
  });
  console.log(`enrichment done: ${matched}/${candidates.length} matched, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
