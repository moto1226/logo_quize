const path = require("node:path");
const {
  root,
  seedFile,
  indexJson,
  matchesCsv,
  readCsv,
  readJson,
  writeCsv,
  writeJson,
  normalizeName,
  normalizeDomain,
  isProcessableSvglogo
} = require("./svglogo-common");

const columns = [
  "brand_id",
  "name_en",
  "name_zh",
  "domain",
  "similar_group",
  "has_pure_symbol",
  "svglogo_id",
  "svglogo_title",
  "svglogo_category_raw",
  "svglogo_file_rel_path",
  "svglogo_webp_file",
  "svglogo_url",
  "is_wordmark",
  "variant",
  "match_method",
  "confidence",
  "recommended",
  "notes"
];

function scoreMatch(seed, item) {
  const seedDomain = normalizeDomain(seed.domain);
  const itemDomain = normalizeDomain(item.url);
  if (seedDomain && itemDomain && seedDomain === itemDomain) return ["domain_url", "high"];
  if (seed.name_zh && item.title && seed.name_zh.trim() === item.title.trim()) return ["name_zh_title_exact", "high"];

  const titleNorm = normalizeName(item.title);
  const fileNorm = normalizeName(path.basename(item.file_name, ".svg"));
  const nameEnNorm = normalizeName(seed.name_en);
  const brandIdNorm = normalizeName(seed.brand_id);
  if (nameEnNorm && (nameEnNorm === titleNorm || nameEnNorm === fileNorm)) return ["name_en_normalized", "medium"];
  if (brandIdNorm && brandIdNorm === fileNorm) return ["brand_id_file_name", "medium"];
  return null;
}

function rank(item) {
  const wordmarkPenalty = item.is_wordmark === "true" ? 100 : 0;
  const variantRank = item.variant === "default" ? 0 : item.variant === "light" ? 1 : item.variant === "dark" ? 2 : 10;
  return wordmarkPenalty + variantRank;
}

function main() {
  const seedRows = readCsv(seedFile).filter((row) => (row.include_mvp || "").toLowerCase() === "true");
  const allIndexRows = readJson(indexJson);
  const indexRows = allIndexRows.filter((row) => row.exists === "true" && isProcessableSvglogo(row));
  const output = [];
  const matchedBrands = new Set();
  const missingBrands = [];

  for (const seed of seedRows) {
    const hits = [];
    for (const item of indexRows) {
      const match = scoreMatch(seed, item);
      if (match) hits.push({ item, match_method: match[0], confidence: match[1] });
    }

    hits.sort((a, b) => {
      const confidenceRank = { high: 0, medium: 1, low: 2 };
      return confidenceRank[a.confidence] - confidenceRank[b.confidence] || rank(a.item) - rank(b.item);
    });

    const hasNonWordmark = hits.some((hit) => hit.item.is_wordmark !== "true");
    const recommendedId = hasNonWordmark ? hits.find((hit) => hit.item.is_wordmark !== "true")?.item.svglogo_id : "";
    if (!hits.length) {
      missingBrands.push(seed.brand_id);
      continue;
    }

    matchedBrands.add(seed.brand_id);
    for (const hit of hits) {
      const onlyWordmark = !hasNonWordmark;
      output.push({
        brand_id: seed.brand_id,
        name_en: seed.name_en,
        name_zh: seed.name_zh,
        domain: seed.domain,
        similar_group: seed.similar_group,
        has_pure_symbol: seed.has_pure_symbol,
        svglogo_id: hit.item.svglogo_id,
        svglogo_title: hit.item.title,
        svglogo_category_raw: hit.item.category_raw,
        svglogo_file_rel_path: hit.item.file_rel_path,
        svglogo_webp_file: `assets/_candidates/svglogo/${hit.item.category_raw}/${hit.item.svglogo_id}.webp`,
        svglogo_url: hit.item.url,
        is_wordmark: hit.item.is_wordmark,
        variant: hit.item.variant,
        match_method: hit.match_method,
        confidence: hit.confidence,
        recommended: String(!onlyWordmark && hit.item.svglogo_id === recommendedId),
        notes: onlyWordmark ? "only_wordmark_candidate" : ""
      });
    }
  }

  writeCsv(matchesCsv, output, columns);
  writeJson(path.join(root, "reports", "svglogo-match-report.json"), {
    generated_at: new Date().toISOString(),
    seed_brand_count: seedRows.length,
    matched_brand_count: matchedBrands.size,
    missing_brand_count: missingBrands.length,
    matched_brands: [...matchedBrands].sort(),
    missing_in_svglogo: missingBrands,
    excluded_categories: ["other", "weather"],
    skipped_excluded_resources: allIndexRows.filter((row) => row.exists === "true" && !isProcessableSvglogo(row)).length,
    match_rows: output.length,
    recommended_count: output.filter((row) => row.recommended === "true").length
  });
  console.log(`SVGLOGO matched ${matchedBrands.size}/${seedRows.length} seed brands`);
}

main();
