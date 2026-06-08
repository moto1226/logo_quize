const fs = require("node:fs");
const path = require("node:path");
const {
  root,
  readCsv,
  readJson,
  writeCsv,
  writeJson,
  readSourceCandidates,
  writeSourceCandidates,
  fetchBuffer,
  extFromUrlOrType,
  saveCandidateAsset,
  delay
} = require("./logo-candidates-common");

const sourceType = "expanded-wikimedia";
const expandedCsv = path.join(root, "logo_brand_expanded_candidates.csv");
const allCorpusJson = path.join(root, "data", "all_logo_candidates_index.json");
const reportJson = path.join(root, "reports", "expanded-wikimedia-collect-report.json");
const matchJson = path.join(root, "data", "expanded_wikimedia_match_report.json");
const matchCsv = path.join(root, "data", "expanded_wikimedia_match_report.csv");

const matchColumns = [
  "brand_id",
  "name_en",
  "name_zh",
  "domain_hint",
  "match_status",
  "matched_count",
  "matched_sources",
  "collected_candidate_id",
  "notes"
];

function norm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
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

function findMatches(brand, corpusMap) {
  const hits = [];
  for (const key of brandKeys(brand)) {
    if (corpusMap.has(key)) hits.push(...corpusMap.get(key));
  }
  return [...new Map(hits.map((row) => [row.corpus_id, row])).values()];
}

async function fetchJson(url, retries = 1) {
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      headers: { "user-agent": "logo-quize-local/0.1 (local candidate audit)" },
      signal: AbortSignal.timeout(10000)
    });
    const text = await response.text();
    if (response.ok && /^\s*[{[]/.test(text)) return JSON.parse(text);
    lastError = `${response.status} ${text.slice(0, 80)}`;
    await delay(800 + attempt * 1200);
  }
  throw new Error(lastError || "json fetch failed");
}

function isLikelyEntityMatch(brand, item) {
  const label = norm(item.label);
  const name = norm(brand.name_en);
  const brandId = norm(brand.brand_id);
  if (!label || !name) return false;
  if (label === name) return true;
  if (name.length >= 4 && (label.includes(name) || name.includes(label))) return true;
  if (brandId.length >= 4 && label.includes(brandId)) return true;
  return false;
}

async function wikidataSearch(brand) {
  const queries = [brand.name_en].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const query of queries) {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&limit=5&origin=*`;
    const json = await fetchJson(url);
    for (const item of json.search || []) {
      if (!seen.has(item.id) && isLikelyEntityMatch(brand, item)) {
        seen.add(item.id);
        out.push(item);
      }
    }
    if (out.length >= 6) break;
  }
  return out;
}

async function entityImage(qid) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const json = await fetchJson(url);
  const claims = json.entities?.[qid]?.claims || {};
  for (const property of ["P154", "P94"]) {
    const fileName = claims[property]?.[0]?.mainsnak?.datavalue?.value;
    if (fileName) return { fileName, property };
  }
  return null;
}

async function commonsInfo(fileName) {
  const title = fileName.startsWith("File:") ? fileName : `File:${fileName}`;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|extmetadata`;
  const json = await fetchJson(url);
  const page = Object.values(json.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.url) return null;
  const meta = info.extmetadata || {};
  return {
    url: info.url,
    descriptionUrl: info.descriptionurl || "",
    license: meta.LicenseShortName?.value || meta.UsageTerms?.value || "unknown",
    licenseUrl: meta.LicenseUrl?.value || ""
  };
}

async function collectForBrand(row) {
  const items = await wikidataSearch(row);
  for (const item of items) {
    const entity = await entityImage(item.id);
    if (!entity) continue;
    if (entity.property === "P94" && norm(row.name_en).length <= 3) continue;
    const info = await commonsInfo(entity.fileName);
    if (!info) continue;
    const fetched = await fetchBuffer(info.url);
    if (!fetched.ok) continue;
    const ext = extFromUrlOrType(info.url, fetched.contentType);
    return saveCandidateAsset({
      sourceType,
      brand: brandFromRow(row),
      sourceUrl: info.descriptionUrl || info.url,
      sourceName: `Wikidata ${entity.property} ${item.id}`,
      license: info.license,
      licenseUrl: info.licenseUrl,
      rawBuffer: fetched.buffer,
      originalFormat: ext,
      suffix: `${item.id}_${entity.fileName}`,
      qualityScore: entity.property === "P154" ? 78 : 62,
      matchConfidence: entity.property === "P154" ? "medium" : "low",
      isWordmark: /wordmark/i.test(entity.fileName) ? "true" : "unknown",
      notes: `expanded candidate; Wikidata ${entity.property}`
    });
  }
  return null;
}

async function main() {
  if (!fs.existsSync(expandedCsv)) throw new Error("logo_brand_expanded_candidates.csv not found");
  const brands = readCsv(expandedCsv);
  const currentCorpus = fs.existsSync(allCorpusJson) ? readJson(allCorpusJson) : [];
  const existing = readSourceCandidates(sourceType);
  const existingByBrand = new Map(existing.map((row) => [row.brand_id, row]));
  const oldReport = fs.existsSync(reportJson) ? readJson(reportJson) : { entries: [] };
  const processed = new Set((oldReport.entries || []).map((row) => row.brand_id));
  const corpusMap = buildCorpusMap([...currentCorpus, ...existing.map((row) => ({
    corpus_id: `collected_${row.candidate_id}`,
    title: row.name_en || row.name_zh,
    source_type: row.source_type,
    raw_file: row.raw_file,
    legacy_svglogo_id: ""
  }))]);

  const collected = [...existing];
  const report = Array.isArray(oldReport.entries) ? [...oldReport.entries] : [];
  const matchRows = fs.existsSync(matchJson) ? readJson(matchJson) : [];

  for (const brand of brands) {
    if (processed.has(brand.brand_id)) continue;
    const matches = findMatches(brand, corpusMap);
    if (matches.length) {
      matchRows.push({
        brand_id: brand.brand_id,
        name_en: brand.name_en,
        name_zh: brand.name_zh,
        domain_hint: brand.domain_hint,
        match_status: "present",
        matched_count: matches.length,
        matched_sources: [...new Set(matches.map((row) => row.source_type))].join("|"),
        collected_candidate_id: "",
        notes: ""
      });
      continue;
    }

    if (existingByBrand.has(brand.brand_id)) {
      const row = existingByBrand.get(brand.brand_id);
      matchRows.push({
        brand_id: brand.brand_id,
        name_en: brand.name_en,
        name_zh: brand.name_zh,
        domain_hint: brand.domain_hint,
        match_status: "collected_existing",
        matched_count: 1,
        matched_sources: sourceType,
        collected_candidate_id: row.candidate_id,
        notes: "already collected before this run"
      });
      continue;
    }

    try {
      const candidate = await collectForBrand(brand);
      if (candidate) {
        collected.push(candidate);
        existingByBrand.set(brand.brand_id, candidate);
        matchRows.push({
          brand_id: brand.brand_id,
          name_en: brand.name_en,
          name_zh: brand.name_zh,
          domain_hint: brand.domain_hint,
          match_status: "collected",
          matched_count: 1,
          matched_sources: sourceType,
          collected_candidate_id: candidate.candidate_id,
          notes: candidate.notes
        });
        report.push({ brand_id: brand.brand_id, status: "collected", candidate_id: candidate.candidate_id });
      } else {
        matchRows.push({
          brand_id: brand.brand_id,
          name_en: brand.name_en,
          name_zh: brand.name_zh,
          domain_hint: brand.domain_hint,
          match_status: "missing",
          matched_count: 0,
          matched_sources: "",
          collected_candidate_id: "",
          notes: "no Wikidata P154/P94 image found"
        });
        report.push({ brand_id: brand.brand_id, status: "missing" });
      }
    } catch (err) {
      matchRows.push({
        brand_id: brand.brand_id,
        name_en: brand.name_en,
        name_zh: brand.name_zh,
        domain_hint: brand.domain_hint,
        match_status: "error",
        matched_count: 0,
        matched_sources: "",
        collected_candidate_id: "",
        notes: err.message
      });
      report.push({ brand_id: brand.brand_id, status: "error", error: err.message });
    }

    console.log(`[expanded-wikimedia] ${brand.brand_id}`);
    writeSourceCandidates(sourceType, collected);
    writeJson(matchJson, matchRows);
    writeCsv(matchCsv, matchRows, matchColumns);
    writeJson(reportJson, {
      generated_at: new Date().toISOString(),
      input_count: brands.length,
      present_count: matchRows.filter((row) => row.match_status === "present").length,
      collected_count: matchRows.filter((row) => row.match_status === "collected" || row.match_status === "collected_existing").length,
      missing_count: matchRows.filter((row) => row.match_status === "missing").length,
      error_count: matchRows.filter((row) => row.match_status === "error").length,
      entries: report
    });
    await delay(250);
  }

  writeSourceCandidates(sourceType, collected);
  writeJson(matchJson, matchRows);
  writeCsv(matchCsv, matchRows, matchColumns);
  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    input_count: brands.length,
    present_count: matchRows.filter((row) => row.match_status === "present").length,
    collected_count: matchRows.filter((row) => row.match_status === "collected" || row.match_status === "collected_existing").length,
    missing_count: matchRows.filter((row) => row.match_status === "missing").length,
    error_count: matchRows.filter((row) => row.match_status === "error").length,
    entries: report
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
