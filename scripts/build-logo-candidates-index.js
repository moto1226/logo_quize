const path = require("node:path");
const {
  root,
  candidateColumns,
  readSourceCandidates,
  svglogoCandidates,
  writeCsv,
  writeJson
} = require("./logo-candidates-common");

const sources = ["svglogo", "website-icons", "wikimedia", "thesvg", "car-logos", "gilbarbara", "vectorlogozone"];

function main() {
  const rows = [];
  rows.push(...svglogoCandidates());
  for (const source of sources.filter((source) => source !== "svglogo")) {
    rows.push(...readSourceCandidates(source));
  }
  const seen = new Set();
  const unique = rows.filter((row) => {
    if (!row.candidate_id || seen.has(row.candidate_id)) return false;
    seen.add(row.candidate_id);
    return true;
  });
  writeCsv(path.join(root, "data", "logo_candidates_index.csv"), unique, candidateColumns);
  writeJson(path.join(root, "data", "logo_candidates_index.json"), unique);
  const bySource = {};
  for (const row of unique) bySource[row.source_type] = (bySource[row.source_type] || 0) + 1;
  writeJson(path.join(root, "reports", "logo-candidate-sources-report.json"), {
    generated_at: new Date().toISOString(),
    total_candidates: unique.length,
    sources: bySource
  });
  console.log(`logo candidates ${unique.length}`);
}

main();
