const path = require("node:path");
const fse = require("fs-extra");
const { root, indexJson, readJson, ensureDir, writeJson, isProcessableSvglogo } = require("./svglogo-common");

function main() {
  const rows = readJson(indexJson);
  const processableRows = rows.filter((item) => item.exists === "true" && isProcessableSvglogo(item));
  const entries = [];
  for (const row of processableRows) {
    const dest = path.join(root, "assets", "_raw", "svglogo", row.category_raw, row.file_name);
    ensureDir(path.dirname(dest));
    fse.copyFileSync(row.file_abs_path, dest);
    entries.push({
      svglogo_id: row.svglogo_id,
      source_file: row.file_rel_path,
      output_file: `assets/_raw/svglogo/${row.category_raw}/${row.file_name}`
    });
  }
  writeJson(path.join(root, "reports", "svglogo-copy-report.json"), {
    generated_at: new Date().toISOString(),
    excluded_categories: ["other", "weather"],
    skipped_excluded_count: rows.filter((item) => item.exists === "true" && !isProcessableSvglogo(item)).length,
    copied_count: entries.length,
    entries
  });
  console.log(`Copied ${entries.length} SVGLOGO raw SVG files`);
}

main();
