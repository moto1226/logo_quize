const path = require("node:path");
const {
  root,
  readJson,
  readCsv,
  writeJson,
  fileSize,
  dirSize,
  listFiles,
  loadConfig,
  matchesCsv,
  isProcessableSvglogo
} = require("./svglogo-common");

function main() {
  const config = loadConfig();
  const rawDir = path.join(root, "assets", "_raw", "svglogo");
  const candidateDir = path.join(root, "assets", "_candidates", "svglogo");
  const buildReportFile = path.join(root, "reports", "svglogo-build-candidates-report.json");
  const buildReport = require("node:fs").existsSync(buildReportFile) ? readJson(buildReportFile) : { entries: [] };
  const matches = require("node:fs").existsSync(matchesCsv) ? readCsv(matchesCsv) : [];
  const webpFiles = listFiles(candidateDir, (file) => file.toLowerCase().endsWith(".webp"));
  const rawFiles = listFiles(rawDir, (file) => file.toLowerCase().endsWith(".svg"));
  const processableWebpFiles = webpFiles.filter((file) => isProcessableSvglogo(path.relative(candidateDir, file).split(path.sep)[0]));
  const processableRawFiles = rawFiles.filter((file) => isProcessableSvglogo(path.relative(rawDir, file).split(path.sep)[0]));
  const byCategory = {};

  for (const file of processableWebpFiles) {
    const rel = path.relative(candidateDir, file).replace(/\\/g, "/");
    const category = rel.split("/")[0] || "";
    if (!byCategory[category]) byCategory[category] = { webp_size_bytes: 0, webp_count: 0, raw_size_bytes: 0, raw_count: 0 };
    byCategory[category].webp_size_bytes += fileSize(file);
    byCategory[category].webp_count += 1;
  }
  for (const file of processableRawFiles) {
    const rel = path.relative(rawDir, file).replace(/\\/g, "/");
    const category = rel.split("/")[0] || "";
    if (!byCategory[category]) byCategory[category] = { webp_size_bytes: 0, webp_count: 0, raw_size_bytes: 0, raw_count: 0 };
    byCategory[category].raw_size_bytes += fileSize(file);
    byCategory[category].raw_count += 1;
  }

  const largestWebp = processableWebpFiles
    .map((file) => ({ file: path.relative(root, file).replace(/\\/g, "/"), size_bytes: fileSize(file) }))
    .sort((a, b) => b.size_bytes - a.size_bytes)
    .slice(0, 30);

  const recommended = matches.filter((row) => row.recommended === "true");
  const recommendedSize = recommended.reduce((sum, row) => sum + fileSize(path.join(root, row.svglogo_webp_file)), 0);
  const allWebpSize = processableWebpFiles.reduce((sum, file) => sum + fileSize(file), 0);
  const rawSize = processableRawFiles.reduce((sum, file) => sum + fileSize(file), 0);
  const budgetBytes = config.assetBudgetMb * 1024 * 1024;

  writeJson(path.join(root, "reports", "asset-size-report.json"), {
    generated_at: new Date().toISOString(),
    asset_budget_mb: config.assetBudgetMb,
    excluded_categories: ["other", "weather"],
    svglogo_candidates_size_bytes: allWebpSize,
    svglogo_raw_size_bytes: rawSize,
    svglogo_total_candidate_library_size_bytes: allWebpSize + rawSize,
    category_sizes: byCategory,
    largest_30_webp: largestWebp,
    conversion_failures: buildReport.entries.filter((row) => row.status !== "converted"),
    recommended_seed_matches_count: recommended.length,
    recommended_seed_matches_estimated_size_bytes: recommendedSize,
    full_svglogo_webp_pack_estimated_size_bytes: allWebpSize,
    full_svglogo_with_raw_estimated_size_bytes: allWebpSize + rawSize,
    recommended_over_budget: recommendedSize > budgetBytes,
    full_webp_over_budget: allWebpSize > budgetBytes,
    full_with_raw_over_budget: allWebpSize + rawSize > budgetBytes
  });
  console.log(`SVGLOGO candidates size ${allWebpSize} bytes`);
}

main();
