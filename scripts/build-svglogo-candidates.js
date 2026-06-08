const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { root, indexJson, readJson, ensureDir, writeJson, loadConfig, fileSize, isProcessableSvglogo } = require("./svglogo-common");

async function convertSvg(row, config) {
  const size = config.logoSize;
  const contentSize = Math.round(size * 0.72);
  const outputFile = path.join(root, "assets", "_candidates", "svglogo", row.category_raw, `${row.svglogo_id}.webp`);
  ensureDir(path.dirname(outputFile));
  const inputSize = fileSize(row.file_abs_path);
  const warnings = [];
  if (inputSize > 512 * 1024) warnings.push("large_svg_file");

  const resized = await sharp(row.file_abs_path, { density: 192, limitInputPixels: false })
    .resize({ width: contentSize, height: contentSize, fit: "inside", withoutEnlargement: false })
    .webp({ quality: config.webpQuality })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const left = Math.max(0, Math.floor((size - meta.width) / 2));
  const top = Math.max(0, Math.floor((size - meta.height) / 2));
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: resized, left, top }])
    .webp({ quality: config.webpQuality })
    .toFile(outputFile);

  return {
    svglogo_id: row.svglogo_id,
    status: "converted",
    input_file: row.file_rel_path,
    output_file: `assets/_candidates/svglogo/${row.category_raw}/${row.svglogo_id}.webp`,
    input_size_bytes: inputSize,
    output_size_bytes: fileSize(outputFile),
    output_width: size,
    output_height: size,
    warnings
  };
}

async function main() {
  const config = loadConfig();
  const rows = readJson(indexJson);
  const processableRows = rows.filter((item) => item.exists === "true" && isProcessableSvglogo(item));
  const entries = [];
  for (const row of processableRows) {
    try {
      entries.push(await convertSvg(row, config));
    } catch (err) {
      entries.push({
        svglogo_id: row.svglogo_id,
        status: "failed",
        input_file: row.file_rel_path,
        output_file: `assets/_candidates/svglogo/${row.category_raw}/${row.svglogo_id}.webp`,
        error: err.message,
        warnings: []
      });
    }
  }
  writeJson(path.join(root, "reports", "svglogo-build-candidates-report.json"), {
    generated_at: new Date().toISOString(),
    excluded_categories: ["other", "weather"],
    skipped_excluded_count: rows.filter((item) => item.exists === "true" && !isProcessableSvglogo(item)).length,
    total_input: processableRows.length,
    converted_count: entries.filter((item) => item.status === "converted").length,
    failed_count: entries.filter((item) => item.status !== "converted").length,
    warning_count: entries.filter((item) => item.warnings && item.warnings.length).length,
    entries
  });
  console.log(`SVGLOGO WebP converted ${entries.filter((item) => item.status === "converted").length}/${entries.length}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
