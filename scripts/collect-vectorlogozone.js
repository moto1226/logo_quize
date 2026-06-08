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

const repoUrl = "https://github.com/VectorLogoZone/vectorlogozone.git";
const repoDir = path.join(root, "vendor", "vectorlogozone");

async function main() {
  const action = cloneOrPull(repoUrl, repoDir);
  const svgFiles = listFiles(repoDir, (file) => file.toLowerCase().endsWith(".svg") && !file.includes(`${path.sep}.git${path.sep}`));
  const rows = [];
  const report = [];
  const license = fs.existsSync(path.join(repoDir, "LICENSE.md")) ? "see repository LICENSE.md" : "unknown";
  for (const brand of seedRows()) {
    let count = 0;
    const hits = svgFiles.filter((file) => textMatchesBrand(file, brand)).slice(0, 4);
    for (const file of hits) {
      try {
        const lower = file.toLowerCase();
        rows.push(await saveCandidateAsset({
          sourceType: "vectorlogozone",
          brand,
          sourceUrl: repoUrl,
          sourceName: "VectorLogoZone/vectorlogozone",
          license,
          rawBuffer: fs.readFileSync(file),
          originalFormat: "svg",
          suffix: path.basename(file, ".svg"),
          qualityScore: lower.includes("icon") ? 76 : 60,
          matchConfidence: "medium",
          isWordmark: lower.includes("wordmark") || lower.includes("horizontal") ? "true" : "unknown"
        }));
        count += 1;
      } catch {}
    }
    report.push({ brand_id: brand.brand_id, candidate_count: count });
  }
  writeSourceCandidates("vectorlogozone", rows);
  writeJson(path.join(root, "reports", "vectorlogozone-collect-report.json"), { generated_at: new Date().toISOString(), action, candidate_count: rows.length, entries: report });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
