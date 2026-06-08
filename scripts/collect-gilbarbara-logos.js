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

const repoUrl = "https://github.com/gilbarbara/logos.git";
const repoDir = path.join(root, "vendor", "gilbarbara-logos");

async function main() {
  const action = cloneOrPull(repoUrl, repoDir);
  const seeds = seedRows();
  const rows = [];
  const report = [];
  const license = fs.existsSync(path.join(repoDir, "LICENSE.txt")) ? "see repository LICENSE.txt" : "unknown";
  const svgFiles = listFiles(path.join(repoDir, "logos"), (file) => file.toLowerCase().endsWith(".svg"));
  for (const brand of seeds) {
    let count = 0;
    const hits = svgFiles.filter((file) => textMatchesBrand(file, brand)).slice(0, 4);
    for (const file of hits) {
      try {
        rows.push(await saveCandidateAsset({
          sourceType: "gilbarbara",
          brand,
          sourceUrl: `https://github.com/gilbarbara/logos`,
          sourceName: "gilbarbara/logos",
          license,
          rawBuffer: fs.readFileSync(file),
          originalFormat: "svg",
          suffix: path.basename(file, ".svg"),
          qualityScore: 70,
          matchConfidence: "medium",
          isWordmark: path.basename(file).toLowerCase().includes("wordmark") ? "true" : "unknown"
        }));
        count += 1;
      } catch {}
    }
    report.push({ brand_id: brand.brand_id, candidate_count: count });
  }
  writeSourceCandidates("gilbarbara", rows);
  writeJson(path.join(root, "reports", "gilbarbara-collect-report.json"), { generated_at: new Date().toISOString(), action, candidate_count: rows.length, entries: report });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
