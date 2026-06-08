const fs = require("node:fs");
const path = require("node:path");
const {
  root,
  seedRows,
  cloneOrPull,
  textMatchesBrand,
  saveCandidateAsset,
  writeSourceCandidates,
  writeJson,
  listFiles
} = require("./logo-candidates-common");

const repoUrl = "https://github.com/filippofilip95/car-logos-dataset.git";
const repoDir = path.join(root, "vendor", "car-logos-dataset");
const carGroups = new Set(["ev_cars", "mass_auto_asia", "premium_auto", "sports_luxury_auto"]);

async function main() {
  const action = cloneOrPull(repoUrl, repoDir);
  const files = [
    ...listFiles(path.join(repoDir, "logos", "optimized"), (file) => /\.(png|jpe?g|webp|svg)$/i.test(file)),
    ...listFiles(path.join(repoDir, "local-logos"), (file) => /\.(png|jpe?g|webp|svg)$/i.test(file))
  ];
  const rows = [];
  const report = [];
  for (const brand of seedRows().filter((row) => carGroups.has(row.similar_group))) {
    let count = 0;
    const hits = files.filter((file) => textMatchesBrand(file, brand)).slice(0, 3);
    for (const file of hits) {
      try {
        const ext = path.extname(file).replace(".", "").toLowerCase();
        rows.push(await saveCandidateAsset({
          sourceType: "car-logos",
          brand,
          sourceUrl: repoUrl,
          sourceName: "filippofilip95/car-logos-dataset",
          license: "MIT; logos remain property of respective owners",
          rawBuffer: fs.readFileSync(file),
          originalFormat: ext,
          suffix: path.basename(file, path.extname(file)),
          qualityScore: 75,
          matchConfidence: "medium"
        }));
        count += 1;
      } catch {}
    }
    report.push({ brand_id: brand.brand_id, candidate_count: count });
  }
  writeSourceCandidates("car-logos", rows);
  writeJson(path.join(root, "reports", "car-logos-collect-report.json"), { generated_at: new Date().toISOString(), action, candidate_count: rows.length, entries: report });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
