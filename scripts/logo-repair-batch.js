const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const repairPlanFile = path.join(root, "reports", "logo-grid-repair-plan.json");
const outRoot = path.join(root, "generated", "logo-test");
const repairDirs = {
  grid: path.join(outRoot, "repair-grid"),
  data: path.join(outRoot, "repair-data"),
  prompt: path.join(outRoot, "repair-prompt"),
  preview: path.join(outRoot, "repair-preview")
};
const tilesDir = path.join(outRoot, "tiles");
const columns = 4;
const rows = 4;
const cellSize = 512;
const gridSize = 2048;
const batchSize = columns * rows;

function ensureDirs() {
  for (const dir of Object.values(repairDirs)) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(tilesDir, { recursive: true });
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadRepairItems() {
  if (!fs.existsSync(repairPlanFile)) {
    throw new Error("Missing reports/logo-grid-repair-plan.json. Run the source grid audit first.");
  }
  const plan = readJson(repairPlanFile);
  const items = [];
  for (const grid of plan.repair_grids || []) {
    for (const item of grid.items || []) {
      items.push({
        brand_id: item.brand_id,
        brand_name: item.brand_name,
        source_grid_id: grid.grid_id,
        industry: grid.industry || ""
      });
    }
  }
  return items;
}

function chunks(items) {
  const result = [];
  for (let i = 0; i < items.length; i += batchSize) result.push(items.slice(i, i + batchSize));
  return result;
}

function gridIdFor(index) {
  return `logo-repair-${String(index + 1).padStart(3, "0")}`;
}

function promptFor(gridId, items) {
  const list = items
    .map((item, index) => `${index + 1}. ${item.brand_name} - use the recognizable official ${item.brand_name} logo icon / app icon mark. It must be identifiable as the real brand logo, not a generic symbol.`)
    .join("\n");
  return [
    "Create a 2048x2048 square image containing a strict 4x4 grid of REAL, recognizable, official-style brand logo icons.",
    "",
    "This is a repair batch for wrong logo tiles. Only the listed brands should appear.",
    "The output must contain recognizable real brand logo icons, not abstract placeholder symbols.",
    "Do NOT invent new logos.",
    "Do NOT use generic geometric placeholders.",
    items.length < batchSize ? `Only the first ${items.length} cells should be occupied; leave the remaining cells blank white.` : "All 16 cells should be occupied.",
    "",
    "Arrange the following brands from left to right, top to bottom:",
    "",
    list,
    "",
    "Strict layout requirements:",
    "- 4 rows and 4 columns.",
    "- Equal cell size, 512x512 pixels.",
    "- One brand logo per occupied cell.",
    "- Each logo centered inside its cell.",
    "- Each logo should occupy about 60% to 75% of the cell.",
    "- Keep 15% to 20% padding around each logo.",
    "- Use a clean white or very light gray background.",
    "- Keep all logos sharp, flat, vector-like, and recognizable.",
    "",
    "Text rules:",
    "- Do not add captions.",
    "- Do not add brand names below or beside the logos.",
    "- Do not add labels, numbers, explanations, or watermarks.",
    "- Letters or glyphs are allowed only when they are part of the official logo itself.",
    "",
    "Quality rules:",
    "- Every logo must be identifiable as the specified brand.",
    "- Do not stylize logos into unrelated icons.",
    "- Do not simplify them into basic shapes.",
    "- Do not create fictional logo variations.",
    "- Do not mix up brand positions.",
    "- The final image must be suitable for automatic cropping into separate 512x512 logo images.",
    "",
    `Repair grid id for tracking: ${gridId}.`
  ].join("\n");
}

function buildPlan() {
  const items = loadRepairItems();
  return chunks(items).map((batch, index) => {
    const gridId = gridIdFor(index);
    return {
      grid_id: gridId,
      status: batch.every((item) => fs.existsSync(path.join(repairDirs.data, `${gridId}.json`)) && fs.existsSync(path.join(tilesDir, `${item.brand_id}.webp`))) ? "generated" : "missing",
      grid_image: rel(path.join(repairDirs.grid, `${gridId}.png`)),
      prompt_file: rel(path.join(repairDirs.prompt, `${gridId}-prompt.txt`)),
      item_count: batch.length,
      items: batch
    };
  });
}

function writePreview(status) {
  const rowsHtml = status.grids.map((grid) => `<tr><td>${escapeHtml(grid.grid_id)}</td><td>${escapeHtml(grid.status)}</td><td>${grid.item_count}</td><td>${escapeHtml(grid.items.map((item) => item.brand_name).join(", "))}</td></tr>`).join("\n");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Logo Repair Status</title><style>body{font-family:Arial,sans-serif;margin:24px;background:#f5f7fa;color:#0b1f3a}table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #d8dce3;padding:8px;text-align:left;vertical-align:top}th{background:#eef2f7}.generated{color:#147a36}.missing{color:#a34400}</style></head><body><h1>Logo Repair Status</h1><p>Generated: ${status.generated_brands} / ${status.total_brands}; Remaining: ${status.remaining_brands}</p><table><thead><tr><th>Repair Grid</th><th>Status</th><th>Brands</th><th>Names</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
  fs.writeFileSync(path.join(repairDirs.preview, "status.html"), html, "utf8");
}

function writeStatus() {
  ensureDirs();
  const grids = buildPlan();
  for (const grid of grids) {
    fs.writeFileSync(path.join(repairDirs.prompt, `${grid.grid_id}-prompt.txt`), `${promptFor(grid.grid_id, grid.items)}\n`, "utf8");
  }
  const generated = grids.reduce((sum, grid) => sum + (grid.status === "generated" ? grid.item_count : 0), 0);
  const total = grids.reduce((sum, grid) => sum + grid.item_count, 0);
  const status = {
    generated_at: new Date().toISOString(),
    source_repair_plan: "reports/logo-grid-repair-plan.json",
    total_brands: total,
    generated_brands: generated,
    remaining_brands: total - generated,
    total_grids: grids.length,
    generated_grids: grids.filter((grid) => grid.status === "generated").length,
    remaining_grids: grids.filter((grid) => grid.status !== "generated").length,
    grids
  };
  writeJson(path.join(repairDirs.data, "logo-repair-status.json"), status);
  writePreview(status);
  return status;
}

async function ingest(gridId, sourceFile) {
  ensureDirs();
  if (!sourceFile) throw new Error("Missing --source image path.");
  if (!fs.existsSync(sourceFile)) throw new Error(`Source image not found: ${sourceFile}`);
  const grid = buildPlan().find((item) => item.grid_id === gridId);
  if (!grid) throw new Error(`Unknown repair grid id: ${gridId}`);

  const gridImage = path.join(repairDirs.grid, `${gridId}.png`);
  const normalized = await sharp(sourceFile).resize(gridSize, gridSize, { fit: "fill" }).png().toBuffer();
  fs.writeFileSync(gridImage, normalized);

  const manifestItems = [];
  for (let index = 0; index < grid.items.length; index += 1) {
    const item = grid.items[index];
    const row = Math.floor(index / columns);
    const col = index % columns;
    const x = col * cellSize;
    const y = row * cellSize;
    const tilePng = path.join(tilesDir, `${item.brand_id}.png`);
    const tileWebp = path.join(tilesDir, `${item.brand_id}.webp`);
    const tileBuffer = await sharp(gridImage).extract({ left: x, top: y, width: cellSize, height: cellSize }).png().toBuffer();
    fs.writeFileSync(tilePng, tileBuffer);
    await sharp(tileBuffer).webp({ quality: 86 }).toFile(tileWebp);
    manifestItems.push({
      index,
      brand_id: item.brand_id,
      brand_name: item.brand_name,
      source_grid_id: item.source_grid_id,
      row,
      col,
      x,
      y,
      width: cellSize,
      height: cellSize,
      tile_png: `../tiles/${item.brand_id}.png`,
      tile_webp: `../tiles/${item.brand_id}.webp`
    });
  }

  writeJson(path.join(repairDirs.data, `${gridId}.json`), {
    grid_id: gridId,
    mode: "repair brand logo grid",
    grid_image: `../repair-grid/${gridId}.png`,
    grid_size: { width: gridSize, height: gridSize },
    cell_size: { width: cellSize, height: cellSize },
    columns,
    rows,
    items: manifestItems
  });
  const status = writeStatus();
  return { gridId, itemCount: manifestItems.length, status };
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function main() {
  const command = process.argv[2] || "status";
  ensureDirs();
  if (command === "status" || command === "plan") {
    const status = writeStatus();
    console.log(`Repair status: ${status.generated_brands}/${status.total_brands} generated, ${status.remaining_brands} remaining.`);
    console.log(`Status file: ${rel(path.join(repairDirs.data, "logo-repair-status.json"))}`);
    console.log(`Preview: ${rel(path.join(repairDirs.preview, "status.html"))}`);
    return;
  }
  if (command === "prompt") {
    const gridId = process.argv[3];
    const grid = buildPlan().find((item) => item.grid_id === gridId);
    if (!grid) throw new Error(`Unknown repair grid id: ${gridId}`);
    const promptFile = path.join(repairDirs.prompt, `${gridId}-prompt.txt`);
    fs.writeFileSync(promptFile, `${promptFor(gridId, grid.items)}\n`, "utf8");
    console.log(rel(promptFile));
    return;
  }
  if (command === "ingest") {
    const gridId = process.argv[3];
    const result = await ingest(gridId, argValue("--source"));
    console.log(`Ingested ${result.gridId}: ${result.itemCount} repair tiles.`);
    console.log(`Repair status: ${result.status.generated_brands}/${result.status.total_brands} generated, ${result.status.remaining_brands} remaining.`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
