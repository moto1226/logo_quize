const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("csv-parse/sync");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const csvFile = path.join(root, "logo_industry_brand_collection_MAX_flat.csv");
const outRoot = path.join(root, "generated", "logo-test");
const dirs = {
  grid: path.join(outRoot, "grid"),
  tiles: path.join(outRoot, "tiles"),
  data: path.join(outRoot, "data"),
  prompt: path.join(outRoot, "prompt"),
  preview: path.join(outRoot, "preview")
};
const defaultIndustry = "互联网 / 软件 / 数字服务";
const columns = 4;
const rows = 4;
const cellSize = 512;
const gridSize = 2048;
const batchSize = columns * rows;

const visualHints = new Map([
  ["微信", "two overlapping chat bubbles"],
  ["qq", "QQ penguin mascot logo"],
  ["微博", "Weibo red eye and broadcast-wave icon mark"],
  ["facebook", "Facebook f icon mark"],
  ["instagram", "Instagram camera app icon mark"],
  ["x / twitter", "X / Twitter official X mark"],
  ["threads", "Threads spiral @-like app icon mark"],
  ["snapchat", "Snapchat white ghost icon mark"],
  ["pinterest", "Pinterest P pin icon mark"],
  ["linkedin", "LinkedIn in icon mark"],
  ["line", "LINE speech bubble logo mark"],
  ["kakaotalk", "KakaoTalk speech bubble logo mark"],
  ["discord", "Discord gamepad face icon mark"],
  ["reddit", "Reddit alien head mascot icon mark"],
  ["tumblr", "Tumblr t icon mark"],
  ["vk", "VK monogram icon mark"],
  ["抖音", "Douyin music note icon"],
  ["tiktok", "TikTok music note icon"],
  ["youtube", "YouTube play button icon"],
  ["google", "Google G logo mark"],
  ["openai", "OpenAI knot logo mark"],
  ["chatgpt", "ChatGPT knot logo mark"],
  ["microsoft", "Microsoft four-color window logo"],
  ["apple", "bitten apple logo"],
  ["amazon", "Amazon smile arrow mark"]
]);

function ensureDirs() {
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function readCsv() {
  const raw = fs.readFileSync(csvFile, "utf8").replace(/^\uFEFF/, "");
  return parse(raw, { bom: true, columns: true, skip_empty_lines: true, trim: true });
}

function safeId(value, fallback) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

function loadBrands(industry = defaultIndustry) {
  return readCsv()
    .filter((row) => row["一级行业"] === industry)
    .map((row, index) => {
      const brandName = row["英文名/常用名"] || row["品牌名称"] || row.brand_id;
      return {
        source_index: index,
        brand_id: safeId(row.brand_id, `brand-${String(index + 1).padStart(3, "0")}`),
        brand_name: brandName,
        industry: row["一级行业"] || "",
        category: row["小分类名称"] || "",
        scene: row["三级场景"] || "",
        similar_group: row.similar_group || ""
      };
    });
}

function industryMetadata(industry) {
  const industries = [];
  for (const row of readCsv()) {
    const value = row["一级行业"];
    if (!industries.includes(value)) industries.push(value);
  }
  const index = industries.indexOf(industry);
  if (index < 0) throw new Error(`Unknown industry: ${industry}`);
  return {
    index: index + 1,
    key: `industry-${String(index + 1).padStart(2, "0")}`
  };
}

function statusPath(industry) {
  const meta = industryMetadata(industry);
  return meta.index === 1
    ? path.join(dirs.data, "logo-generation-status.json")
    : path.join(dirs.data, `logo-generation-status-${meta.key}.json`);
}

function previewPath(industry) {
  const meta = industryMetadata(industry);
  return meta.index === 1
    ? path.join(dirs.preview, "status.html")
    : path.join(dirs.preview, `status-${meta.key}.html`);
}

function gridIdFor(batchIndex, industry) {
  const meta = industryMetadata(industry);
  return meta.index === 1
    ? `logo-grid-${String(batchIndex + 1).padStart(3, "0")}`
    : `logo-grid-i${String(meta.index).padStart(2, "0")}-${String(batchIndex + 1).padStart(3, "0")}`;
}

function chunks(items) {
  const result = [];
  for (let i = 0; i < items.length; i += batchSize) result.push(items.slice(i, i + batchSize));
  return result;
}

function visualDescription(brand) {
  const keys = [brand.brand_id, brand.brand_name].map((value) => String(value || "").trim().toLowerCase());
  const known = keys.map((key) => visualHints.get(key)).find(Boolean);
  if (known) return known;
  return `${brand.brand_name} official logo icon / app icon mark`;
}

function promptFor(gridId, brands) {
  const list = brands
    .map((brand, index) => `${index + 1}. ${brand.brand_name} - use the recognizable official ${brand.brand_name} logo icon / app icon mark: ${visualDescription(brand)}. It must be identifiable as the real brand logo, not a generic symbol.`)
    .join("\n");
  return [
    "Create a 2048x2048 square image containing a strict 4x4 grid of REAL, recognizable, official-style brand logo icons.",
    "",
    "This is a real brand logo reproduction / recognition test dataset.",
    "The output must contain recognizable real brand logo icons, not abstract placeholder symbols.",
    "This is NOT an abstract logo design task.",
    "Do NOT invent new logos.",
    "Do NOT replace brands with generic geometric shapes.",
    "Do NOT use circles, triangles, rounded squares, drops, or random symbols as placeholders.",
    "Each occupied cell must contain the real recognizable logo icon or app icon mark of the specified brand.",
    brands.length < batchSize ? `Only the first ${brands.length} cells should be occupied; leave the remaining cells blank white.` : "All 16 cells should be occupied.",
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
    `Grid id for tracking: ${gridId}.`
  ].join("\n");
}

function plan(industry = defaultIndustry) {
  const brands = loadBrands(industry);
  return chunks(brands).map((items, batchIndex) => {
    const gridId = gridIdFor(batchIndex, industry);
    const gridImage = path.join(dirs.grid, `${gridId}.png`);
    const promptFile = path.join(dirs.prompt, `${gridId}-prompt.txt`);
    const tileCount = items.filter((brand) => fs.existsSync(path.join(dirs.tiles, `${brand.brand_id}.png`)) && fs.existsSync(path.join(dirs.tiles, `${brand.brand_id}.webp`))).length;
    const gridExists = fs.existsSync(gridImage);
    return {
      grid_id: gridId,
      status: tileCount === items.length && gridExists ? "generated" : "missing",
      grid_image: rel(gridImage),
      prompt_file: rel(promptFile),
      item_count: items.length,
      tile_count: tileCount,
      start_index: batchIndex * batchSize,
      end_index: batchIndex * batchSize + items.length - 1,
      items
    };
  });
}

function writeStatus(industry = defaultIndustry) {
  ensureDirs();
  const meta = industryMetadata(industry);
  const grids = plan(industry);
  for (const grid of grids) {
    fs.writeFileSync(path.join(dirs.prompt, `${grid.grid_id}-prompt.txt`), `${promptFor(grid.grid_id, grid.items)}\n`, "utf8");
  }
  const generated = grids.reduce((sum, grid) => sum + (grid.status === "generated" ? grid.item_count : 0), 0);
  const data = {
    industry,
    industry_index: meta.index,
    industry_key: meta.key,
    csv_source: rel(csvFile),
    total_brands: grids.reduce((sum, grid) => sum + grid.item_count, 0),
    generated_brands: generated,
    remaining_brands: grids.reduce((sum, grid) => sum + grid.item_count, 0) - generated,
    generated_grids: grids.filter((grid) => grid.status === "generated").length,
    remaining_grids: grids.filter((grid) => grid.status !== "generated").length,
    grids: grids.map((grid) => ({
      grid_id: grid.grid_id,
      status: grid.status,
      grid_image: grid.grid_image,
      prompt_file: grid.prompt_file,
      item_count: grid.item_count,
      tile_count: grid.tile_count,
      start_index: grid.start_index,
      end_index: grid.end_index,
      items: grid.items.map((brand) => ({
        brand_id: brand.brand_id,
        brand_name: brand.brand_name,
        generated: fs.existsSync(path.join(dirs.tiles, `${brand.brand_id}.png`)) && fs.existsSync(path.join(dirs.tiles, `${brand.brand_id}.webp`))
      }))
    }))
  };
  fs.writeFileSync(statusPath(industry), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}

async function ingest(gridId, sourceFile, industry = defaultIndustry) {
  ensureDirs();
  if (!sourceFile) throw new Error("Missing --source image path.");
  if (!fs.existsSync(sourceFile)) throw new Error(`Source image not found: ${sourceFile}`);
  const grid = plan(industry).find((item) => item.grid_id === gridId);
  if (!grid) throw new Error(`Unknown grid id: ${gridId}`);
  const gridImage = path.join(dirs.grid, `${gridId}.png`);
  const normalized = await sharp(sourceFile).resize(gridSize, gridSize, { fit: "fill" }).png().toBuffer();
  fs.writeFileSync(gridImage, normalized);

  const manifestItems = [];
  for (let index = 0; index < grid.items.length; index += 1) {
    const brand = grid.items[index];
    const row = Math.floor(index / columns);
    const col = index % columns;
    const x = col * cellSize;
    const y = row * cellSize;
    const tilePng = path.join(dirs.tiles, `${brand.brand_id}.png`);
    const tileWebp = path.join(dirs.tiles, `${brand.brand_id}.webp`);
    const tileBuffer = await sharp(gridImage).extract({ left: x, top: y, width: cellSize, height: cellSize }).png().toBuffer();
    fs.writeFileSync(tilePng, tileBuffer);
    await sharp(tileBuffer).webp({ quality: 86 }).toFile(tileWebp);
    manifestItems.push({
      index,
      brand_id: brand.brand_id,
      brand_name: brand.brand_name,
      row,
      col,
      x,
      y,
      width: cellSize,
      height: cellSize,
      tile_png: `../tiles/${brand.brand_id}.png`,
      tile_webp: `../tiles/${brand.brand_id}.webp`
    });
  }
  const manifest = {
    grid_id: gridId,
    mode: "real brand logo grid",
    grid_image: `../grid/${gridId}.png`,
    grid_size: { width: gridSize, height: gridSize },
    cell_size: { width: cellSize, height: cellSize },
    columns,
    rows,
    items: manifestItems
  };
  fs.writeFileSync(path.join(dirs.data, `${gridId}.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const status = writeStatus(industry);
  writePreview(status);
  return { gridId, itemCount: manifestItems.length, status };
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function writePreview(status) {
  const rowsHtml = status.grids.map((grid) => `<tr><td>${escapeHtml(grid.grid_id)}</td><td>${escapeHtml(grid.status)}</td><td>${grid.tile_count}/${grid.item_count}</td><td>${escapeHtml(grid.items.map((item) => item.brand_name).join(", "))}</td></tr>`).join("\n");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Logo Generation Status</title><style>body{font-family:Arial,sans-serif;margin:24px;background:#f5f6f8;color:#222}table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #d8dce3;padding:8px;text-align:left;vertical-align:top}th{background:#eef1f5}.generated{color:#147a36}.missing{color:#a34400}</style></head><body><h1>Logo Generation Status</h1><p>Industry: ${escapeHtml(status.industry)}</p><p>Generated: ${status.generated_brands} / ${status.total_brands}; Remaining: ${status.remaining_brands}</p><table><thead><tr><th>Grid</th><th>Status</th><th>Tiles</th><th>Brands</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
  fs.writeFileSync(previewPath(status.industry), html, "utf8");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function main() {
  const command = process.argv[2] || "status";
  const industry = argValue("--industry") || defaultIndustry;
  ensureDirs();
  if (command === "status") {
    const status = writeStatus(industry);
    writePreview(status);
    console.log(`Status: ${status.generated_brands}/${status.total_brands} generated, ${status.remaining_brands} remaining.`);
    console.log(`Status file: ${rel(statusPath(industry))}`);
    console.log(`Preview: ${rel(previewPath(industry))}`);
    return;
  }
  if (command === "prompt") {
    const gridId = process.argv[3];
    const grid = plan(industry).find((item) => item.grid_id === gridId);
    if (!grid) throw new Error(`Unknown grid id: ${gridId}`);
    const promptFile = path.join(dirs.prompt, `${gridId}-prompt.txt`);
    fs.writeFileSync(promptFile, `${promptFor(gridId, grid.items)}\n`, "utf8");
    console.log(rel(promptFile));
    return;
  }
  if (command === "ingest") {
    const gridId = process.argv[3];
    const result = await ingest(gridId, argValue("--source"), industry);
    console.log(`Ingested ${result.gridId}: ${result.itemCount} tiles.`);
    console.log(`Status: ${result.status.generated_brands}/${result.status.total_brands} generated, ${result.status.remaining_brands} remaining.`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
