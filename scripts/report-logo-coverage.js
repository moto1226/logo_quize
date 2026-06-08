const path = require("node:path");
const {
  root,
  seedRows,
  readJson,
  writeJson
} = require("./logo-candidates-common");

function main() {
  const indexFile = path.join(root, "data", "logo_candidates_index.json");
  const rows = require("node:fs").existsSync(indexFile) ? readJson(indexFile) : [];
  const byBrand = new Map();
  for (const row of rows) {
    if (!byBrand.has(row.brand_id)) byBrand.set(row.brand_id, []);
    byBrand.get(row.brand_id).push(row);
  }
  const groups = {};
  for (const brand of seedRows()) {
    if (!groups[brand.similar_group]) {
      groups[brand.similar_group] = { total_brands: 0, brands_with_at_least_1_candidate: 0, brands_with_approved_candidate: 0, brands_missing_candidates: [], playable_if_approved: false, notes: "" };
    }
    const group = groups[brand.similar_group];
    const candidates = byBrand.get(brand.brand_id) || [];
    group.total_brands += 1;
    if (candidates.length) group.brands_with_at_least_1_candidate += 1;
    else group.brands_missing_candidates.push(brand.brand_id);
    if (candidates.some((row) => row.review_status === "approved")) group.brands_with_approved_candidate += 1;
  }
  for (const group of Object.values(groups)) {
    group.playable_if_approved = group.brands_with_at_least_1_candidate >= 4;
    group.coverage_ratio = group.total_brands ? Number((group.brands_with_at_least_1_candidate / group.total_brands).toFixed(3)) : 0;
  }
  const missing = seedRows().filter((brand) => !byBrand.has(brand.brand_id)).map((brand) => brand.brand_id);
  const priority = seedRows()
    .filter((brand) => (byBrand.get(brand.brand_id) || []).length > 0)
    .sort((a, b) => (byBrand.get(b.brand_id) || []).length - (byBrand.get(a.brand_id) || []).length)
    .slice(0, 25)
    .map((brand) => ({ brand_id: brand.brand_id, candidate_count: (byBrand.get(brand.brand_id) || []).length, similar_group: brand.similar_group }));
  writeJson(path.join(root, "reports", "group-coverage-report.json"), {
    generated_at: new Date().toISOString(),
    total_brands: seedRows().length,
    brands_with_at_least_1_candidate: seedRows().length - missing.length,
    missing_brands: missing,
    priority_review_brands: priority,
    groups
  });
  console.log(`coverage ${seedRows().length - missing.length}/${seedRows().length}`);
}

main();
