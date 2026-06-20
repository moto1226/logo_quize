const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { parse } = require("csv-parse/sync");

const root = path.resolve(__dirname, "..");
const csvFile = path.join(root, "logo_industry_brand_collection_MAX_flat.csv");
const repairGridDir = path.join(root, "generated", "logo-test", "repair-grid");
const repairDataDir = path.join(root, "generated", "logo-test", "repair-data");
const repairPromptDir = path.join(root, "generated", "logo-test", "repair-prompt");
const tileDir = path.join(root, "generated", "logo-test", "tiles");
const distDir = path.join(root, "dist", "logos", "v20260620r2");
const reviewDir = path.join(root, "review");

const columns = 4;
const rows = 4;
const cellSize = 512;
const gridSize = 2048;

const blurIds = [
  "al_jazeera",
  "bloomberg",
  "cn_882c305e",
  "cn_992b39c4",
  "himalaya",
  "vcg",
  "wired",
  "zaker",
  "anchor_spotify_for_podcasters",
  "36",
  "adobe_stock",
  "spotify_podcasts",
  "9",
  "huaban",
  "cn_22b87143",
  "dribbble",
  "hacker_news"
];

const batches = [
  { grid_id: "logo-repair-blur-001", ids: blurIds.slice(0, 16) },
  { grid_id: "logo-repair-blur-002", ids: blurIds.slice(16) }
];

function ensureDirs() {
  for (const dir of [repairGridDir, repairDataDir, repairPromptDir, tileDir, distDir, reviewDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readRows() {
  return parse(fs.readFileSync(csvFile, "utf8"), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

function brandMap() {
  return new Map(readRows().map((row) => [row.brand_id, row]));
}

function displayName(row, id) {
  return row?.["英文名/常用名"] || row?.["品牌名称"] || id;
}

function promptFor(batch) {
  const rowsById = brandMap();
  const list = batch.ids
    .map((id, index) => `${index + 1}. ${displayName(rowsById.get(id), id)} (${id})`)
    .join("\n");
  return [
    "Create a 2048x2048 square image containing a strict 4x4 grid of clean, sharp, recognizable brand logo marks.",
    "This grid is only for repairing blurry logo assets. Do not include any brands except the listed items.",
    "Use a plain white background. Keep each logo centered in its own 512x512 cell with generous padding.",
    "Make the logos crisp, flat, vector-like, and easy to recognize at small mobile size.",
    "",
    "Arrange these brands from left to right, top to bottom:",
    list,
    batch.ids.length < 16 ? `Only fill the first ${batch.ids.length} cell; leave all remaining cells completely blank white.` : "Fill all 16 cells.",
    "",
    "Rules:",
    "- 4 columns and 4 rows.",
    "- Equal 512x512 cells.",
    "- One logo per occupied cell.",
    "- No captions, no extra labels, no numbers, no watermarks.",
    "- Text is allowed only if it is part of the logo itself.",
    "- Do not add unrelated brands.",
    "- Do not crop logos; keep them centered with 15% to 20% padding.",
    `Tracking grid id: ${batch.grid_id}.`
  ].join("\n");
}

function writePrompts() {
  ensureDirs();
  const written = [];
  for (const batch of batches) {
    const file = path.join(repairPromptDir, `${batch.grid_id}-prompt.txt`);
    fs.writeFileSync(file, `${promptFor(batch)}\n`, "utf8");
    written.push(file);
  }
  return written;
}

async function ingest(gridId, sourceFile) {
  ensureDirs();
  const batch = batches.find((item) => item.grid_id === gridId);
  if (!batch) throw new Error(`Unknown blur repair grid: ${gridId}`);
  if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error(`Source image not found: ${sourceFile}`);
  const gridFile = path.join(repairGridDir, `${gridId}.png`);
  const normalized = await sharp(sourceFile).resize(gridSize, gridSize, { fit: "fill" }).png().toBuffer();
  fs.writeFileSync(gridFile, normalized);

  const rowsById = brandMap();
  const manifestItems = [];
  for (let index = 0; index < batch.ids.length; index += 1) {
    const brandId = batch.ids[index];
    const row = Math.floor(index / columns);
    const col = index % columns;
    const left = col * cellSize;
    const top = row * cellSize;
    const tilePng = path.join(tileDir, `${brandId}.png`);
    const tileWebp = path.join(tileDir, `${brandId}.webp`);
    const distWebp = path.join(distDir, `${brandId}.webp`);
    const tileBuffer = await sharp(gridFile).extract({ left, top, width: cellSize, height: cellSize }).png().toBuffer();
    fs.writeFileSync(tilePng, tileBuffer);
    await sharp(tileBuffer).webp({ quality: 88 }).toFile(tileWebp);
    await sharp(tileBuffer).webp({ quality: 88 }).toFile(distWebp);
    manifestItems.push({
      index,
      brand_id: brandId,
      brand_name: displayName(rowsById.get(brandId), brandId),
      row,
      col,
      x: left,
      y: top,
      width: cellSize,
      height: cellSize,
      tile_png: `../tiles/${brandId}.png`,
      tile_webp: `../tiles/${brandId}.webp`
    });
  }

  const manifest = {
    grid_id: gridId,
    mode: "blur-only logo repair grid",
    grid_image: `../repair-grid/${gridId}.png`,
    grid_size: { width: gridSize, height: gridSize },
    cell_size: { width: cellSize, height: cellSize },
    columns,
    rows,
    items: manifestItems
  };
  fs.writeFileSync(path.join(repairDataDir, `${gridId}.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await contactSheet();
  return manifestItems.length;
}

async function contactSheet() {
  const items = blurIds.filter((id) => fs.existsSync(path.join(distDir, `${id}.webp`)));
  const cell = 160;
  const label = 38;
  const cols = 5;
  const composites = [];
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index];
    const x = (index % cols) * cell;
    const y = Math.floor(index / cols) * (cell + label);
    const img = await sharp(path.join(distDir, `${id}.webp`)).resize(cell, cell, { fit: "contain", background: "#ffffff" }).webp().toBuffer();
    const text = Buffer.from(`<svg width="${cell}" height="${label}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><text x="6" y="18" font-family="Arial" font-size="12" font-weight="700" fill="#111827">${id}</text></svg>`);
    composites.push({ input: img, left: x, top: y });
    composites.push({ input: text, left: x, top: y + cell });
  }
  const out = path.join(reviewDir, "logo-blur-only-repair-preview.webp");
  await sharp({
    create: {
      width: cols * cell,
      height: Math.ceil(items.length / cols) * (cell + label),
      channels: 3,
      background: "#f6f7f9"
    }
  }).composite(composites).webp({ quality: 90 }).toFile(out);
}

async function main() {
  const command = process.argv[2] || "prompts";
  if (command === "prompts") {
    const files = writePrompts();
    console.log(files.map((file) => path.relative(root, file).replace(/\\/g, "/")).join("\n"));
    return;
  }
  if (command === "ingest") {
    const gridId = process.argv[3];
    const sourceIndex = process.argv.indexOf("--source");
    const source = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "";
    const count = await ingest(gridId, source);
    console.log(`Ingested ${gridId}: ${count} blur-only tiles`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
