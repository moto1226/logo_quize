const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const {
  root,
  libraryDir,
  categoryMap,
  indexJson,
  indexCsv,
  indexColumns,
  writeJson,
  writeCsv,
  getCommitHash
} = require("./svglogo-common");

function makeId(categoryRaw, fileName, used) {
  const base = `${categoryRaw}_${fileName.replace(/\.svg$/i, "")}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  let id = base || `${categoryRaw}_svg`;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

function pushRecord(records, used, seenRelPaths, item, categoryRaw, fileName, variant, isWordmark, sourceType, commit, notes = "") {
  if (!fileName) return;
  const fileRelPath = `${categoryRaw}/${fileName}`.replace(/\\/g, "/");
  const fileAbsPath = path.join(libraryDir, categoryRaw, fileName);
  if (sourceType === "meta") seenRelPaths.add(fileRelPath);
  records.push({
    svglogo_id: makeId(categoryRaw, fileName, used),
    title: item?.title || "",
    category: categoryMap[categoryRaw] || categoryRaw,
    category_raw: categoryRaw,
    file_name: fileName,
    file_rel_path: fileRelPath,
    file_abs_path: fileAbsPath,
    url: item?.url || "",
    variant,
    is_wordmark: String(Boolean(isWordmark)),
    source_type: sourceType,
    source_repo: "HeyHuazi/SVGLOGO",
    source_commit: commit,
    exists: String(fs.existsSync(fileAbsPath)),
    notes
  });
}

function expandField(records, used, seenRelPaths, item, categoryRaw, field, isWordmark, commit) {
  const value = item?.[field];
  if (!value) return;
  if (typeof value === "string") {
    pushRecord(records, used, seenRelPaths, item, categoryRaw, value, isWordmark ? "wordmark" : "default", isWordmark, "meta", commit);
    return;
  }
  if (typeof value === "object") {
    for (const [variant, fileName] of Object.entries(value)) {
      pushRecord(records, used, seenRelPaths, item, categoryRaw, fileName, isWordmark ? `wordmark_${variant}` : variant, isWordmark, "meta", commit);
    }
  }
}

function main() {
  if (!fs.existsSync(libraryDir)) throw new Error("vendor/SVGLOGO/static/library 不存在，请先运行 npm run fetch:svglogo");
  const commit = getCommitHash();
  const records = [];
  const used = new Set();
  const seenRelPaths = new Set();
  const warnings = [];

  const categories = fs.readdirSync(libraryDir, { withFileTypes: true }).filter((item) => item.isDirectory());
  for (const category of categories) {
    const categoryRaw = category.name;
    const categoryDir = path.join(libraryDir, categoryRaw);
    const metaFile = path.join(categoryDir, "_meta.yaml");
    if (fs.existsSync(metaFile)) {
      try {
        const meta = YAML.parse(fs.readFileSync(metaFile, "utf8")) || {};
        const items = Array.isArray(meta.items) ? meta.items : [];
        for (const item of items) {
          expandField(records, used, seenRelPaths, item, categoryRaw, "file", false, commit);
          expandField(records, used, seenRelPaths, item, categoryRaw, "wordmark", true, commit);
        }
      } catch (err) {
        warnings.push(`${categoryRaw}/_meta.yaml parse failed: ${err.message}`);
      }
    }

    for (const svg of fs.readdirSync(categoryDir).filter((name) => name.toLowerCase().endsWith(".svg"))) {
      const rel = `${categoryRaw}/${svg}`;
      if (!seenRelPaths.has(rel)) {
        pushRecord(records, used, seenRelPaths, { title: path.basename(svg, ".svg") }, categoryRaw, svg, "orphan", false, "orphan", commit, "not_in_meta_yaml");
      }
    }
  }

  writeJson(indexJson, records);
  writeCsv(indexCsv, records, indexColumns);
  writeJson(path.join(root, "reports", "svglogo-collect-report.json"), {
    generated_at: new Date().toISOString(),
    source_repo: "HeyHuazi/SVGLOGO",
    source_commit: commit,
    total_resources: records.length,
    categories: categories.map((item) => item.name),
    category_count: categories.length,
    wordmark_count: records.filter((row) => row.is_wordmark === "true").length,
    non_wordmark_count: records.filter((row) => row.is_wordmark !== "true").length,
    orphan_count: records.filter((row) => row.source_type === "orphan").length,
    missing_file_count: records.filter((row) => row.exists !== "true").length,
    warnings
  });
  console.log(`SVGLOGO index ${records.length} resources`);
}

main();
