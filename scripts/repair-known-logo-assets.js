const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "generated", "logo-test", "data");
const gridDir = path.join(root, "generated", "logo-test", "grid");
const repairDataDir = path.join(root, "generated", "logo-test", "repair-data");
const repairGridDir = path.join(root, "generated", "logo-test", "repair-grid");
const tileDir = path.join(root, "generated", "logo-test", "tiles");
const distDir = path.join(root, "dist", "logos", "v20260620r2");
const reportDir = path.join(root, "reports");
const reviewDir = path.join(root, "review");

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

const borderCropIds = [
  "aesop",
  "amazon",
  "citibank",
  "cisco",
  "cn_b0ec25ac",
  "cn_bf699c32",
  "columbia_university",
  "lazada",
  "peking_university",
  "tsinghua_university",
  "ucla",
  "uc_berkeley",
  "university_of_tokyo",
  "wanda",
  "kyoto_university",
  "six_flags",
  "mitsubishi_estate",
  "mitsui_fudosan",
  "pull_and_bear",
  "arista"
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadManifestMap() {
  const map = new Map();
  const loadFrom = (dir, pattern, gridRoot, sourceType, overwrite) => {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter((file) => pattern.test(file));
    for (const file of files) {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      for (const item of manifest.items || []) {
        if (!overwrite && map.has(item.brand_id)) continue;
        map.set(item.brand_id, {
          grid_id: manifest.grid_id,
          brand_id: item.brand_id,
          brand_name: item.brand_name,
          row: item.row,
          col: item.col,
          index: item.index,
          x: item.x,
          y: item.y,
          source_grid_id: item.source_grid_id || manifest.grid_id,
          source_type: sourceType,
          grid_file: path.join(gridRoot, `${manifest.grid_id}.png`)
        });
      }
    }
  };

  loadFrom(dataDir, /^logo-grid.*\.json$/i, gridDir, "original", false);
  loadFrom(repairDataDir, /^logo-repair.*\.json$/i, repairGridDir, "repair", true);

  return map;
}

function isContent(r, g, b, a) {
  if (a < 16) return false;
  return r < 246 || g < 246 || b < 246;
}

function isNeutralEdge(r, g, b, a) {
  if (a < 16) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min <= 24 && (r + g + b) / 3 >= 96;
}

async function removeLongNeutralLines(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let changed = 0;
  const mark = new Uint8Array(info.width * info.height);

  for (let y = 0; y < info.height; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= info.width; x += 1) {
      const ok = x < info.width && (() => {
        const offset = (y * info.width + x) * info.channels;
        return isNeutralEdge(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      })();
      if (ok && runStart < 0) runStart = x;
      if ((!ok || x === info.width) && runStart >= 0) {
        const runLength = x - runStart;
        if (runLength >= 120) {
          for (let xx = runStart; xx < x; xx += 1) mark[y * info.width + xx] = 1;
        }
        runStart = -1;
      }
    }
  }

  for (let x = 0; x < info.width; x += 1) {
    let runStart = -1;
    for (let y = 0; y <= info.height; y += 1) {
      const ok = y < info.height && (() => {
        const offset = (y * info.width + x) * info.channels;
        return isNeutralEdge(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      })();
      if (ok && runStart < 0) runStart = y;
      if ((!ok || y === info.height) && runStart >= 0) {
        const runLength = y - runStart;
        if (runLength >= 120) {
          for (let yy = runStart; yy < y; yy += 1) mark[yy * info.width + x] = 1;
        }
        runStart = -1;
      }
    }
  }

  for (let i = 0; i < mark.length; i += 1) {
    if (!mark[i]) continue;
    const offset = i * info.channels;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 255;
    changed += 1;
  }

  return {
    buffer: await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer(),
    changed
  };
}

async function extractGridCell(entry) {
  const gridFile = entry.grid_file || path.join(gridDir, `${entry.grid_id}.png`);
  if (!fs.existsSync(gridFile)) throw new Error(`Missing grid image: ${gridFile}`);
  return sharp(gridFile)
    .extract({ left: entry.x, top: entry.y, width: 512, height: 512 })
    .png()
    .toBuffer();
}

async function extractShiftedGridCell(entry) {
  const gridFile = entry.grid_file || path.join(gridDir, `${entry.grid_id}.png`);
  if (!fs.existsSync(gridFile)) throw new Error(`Missing grid image: ${gridFile}`);
  const image = sharp(gridFile).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const expectedLeft = entry.x;
  const expectedTop = entry.y;
  const expectedRight = entry.x + 511;
  const expectedBottom = entry.y + 511;
  const searchPad = 104;
  const searchLeft = Math.max(0, expectedLeft - searchPad);
  const searchTop = Math.max(0, expectedTop - searchPad);
  const searchRight = Math.min(info.width - 1, expectedRight + searchPad);
  const searchBottom = Math.min(info.height - 1, expectedBottom + searchPad);
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = searchTop; y <= searchBottom; y += 1) {
    for (let x = searchLeft; x <= searchRight; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (!isContent(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) continue;
      const insideExpected = x >= expectedLeft && x <= expectedRight && y >= expectedTop && y <= expectedBottom;
      const nearExpected = x >= expectedLeft - 36 && x <= expectedRight + 36 && y >= expectedTop - 36 && y <= expectedBottom + 36;
      if (!insideExpected && !nearExpected) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return extractGridCell(entry);

  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;
  let left = Math.round(contentCenterX - 255.5);
  let top = Math.round(contentCenterY - 255.5);
  left = Math.max(0, Math.min(info.width - 512, left));
  top = Math.max(0, Math.min(info.height - 512, top));
  if (Math.abs(left - expectedLeft) > 120) left = expectedLeft;
  if (Math.abs(top - expectedTop) > 120) top = expectedTop;

  return sharp(gridFile)
    .extract({ left, top, width: 512, height: 512 })
    .png()
    .toBuffer();
}

async function contentBox(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let contentPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (!isContent(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      contentPixels += 1;
    }
  }
  if (!contentPixels) return null;
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    right: info.width - 1 - maxX,
    bottom: info.height - 1 - maxY,
    contentPixels
  };
}

async function removeOuterNeutralEdges(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let changed = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const outer = x < 6 || y < 6 || x >= info.width - 6 || y >= info.height - 6;
      if (!outer) continue;
      const offset = (y * info.width + x) * info.channels;
      if (!isNeutralEdge(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) continue;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
      changed += 1;
    }
  }
  return {
    buffer: await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer(),
    changed
  };
}

async function recenterTile(buffer) {
  const cleaned = await removeOuterNeutralEdges(buffer);
  const noLines = await removeLongNeutralLines(cleaned.buffer);
  const box = await contentBox(noLines.buffer);
  if (!box) return { buffer: noLines.buffer, changedPixels: cleaned.changed + noLines.changed, box: null };

  const pad = 54;
  const cropLeft = Math.max(0, box.left - 8);
  const cropTop = Math.max(0, box.top - 8);
  const cropRight = Math.min(511, box.left + box.width + 7);
  const cropBottom = Math.min(511, box.top + box.height + 7);
  const cropWidth = cropRight - cropLeft + 1;
  const cropHeight = cropBottom - cropTop + 1;
  const targetMax = 512 - pad * 2;
  const scale = Math.min(1, targetMax / Math.max(cropWidth, cropHeight));
  const outWidth = Math.max(1, Math.round(cropWidth * scale));
  const outHeight = Math.max(1, Math.round(cropHeight * scale));
  const input = await sharp(noLines.buffer)
    .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
    .resize(outWidth, outHeight, { fit: "contain" })
    .png()
    .toBuffer();
  const output = await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: "#ffffff"
    }
  }).composite([{ input, left: Math.round((512 - outWidth) / 2), top: Math.round((512 - outHeight) / 2) }]).png().toBuffer();

  const finalClean = await removeLongNeutralLines(output);
  return { buffer: finalClean.buffer, changedPixels: cleaned.changed + noLines.changed + finalClean.changed, box };
}

async function sharpenBlurTile(brandId) {
  const source = path.join(tileDir, `${brandId}.png`);
  const fallback = path.join(distDir, `${brandId}.webp`);
  const input = fs.existsSync(source) ? fs.readFileSync(source) : fs.readFileSync(fallback);
  const cleaned = await removeOuterNeutralEdges(input);
  const output = await sharp(cleaned.buffer)
    .resize(512, 512, { fit: "contain", background: "#ffffff" })
    .sharpen({ sigma: 1.2, m1: 1.3, m2: 2.2 })
    .modulate({ saturation: 1.04 })
    .png()
    .toBuffer();
  await writeTile(brandId, output);
  return { brand_id: brandId, status: "locally_sharpened" };
}

async function writeTile(brandId, pngBuffer) {
  const pngFile = path.join(tileDir, `${brandId}.png`);
  const webpFile = path.join(tileDir, `${brandId}.webp`);
  const distFile = path.join(distDir, `${brandId}.webp`);
  fs.writeFileSync(pngFile, pngBuffer);
  await sharp(pngBuffer).webp({ quality: 86 }).toFile(webpFile);
  await sharp(pngBuffer).webp({ quality: 86 }).toFile(distFile);
}

async function buildContactSheet(items, outFile) {
  const cell = 180;
  const label = 44;
  const cols = 5;
  const rows = Math.ceil(items.length / cols);
  const composites = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const x = (index % cols) * cell;
    const y = Math.floor(index / cols) * (cell + label);
    const img = await sharp(path.join(distDir, `${item.brand_id}.webp`)).resize(cell, cell, { fit: "contain", background: "#ffffff" }).webp().toBuffer();
    const text = Buffer.from(`<svg width="${cell}" height="${label}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#fff"/>
      <text x="7" y="17" font-family="Arial" font-size="13" font-weight="700" fill="#111827">${item.kind} ${item.brand_id}</text>
      <text x="7" y="35" font-family="Arial" font-size="11" fill="#667085">${item.grid_id || ""} ${item.note || ""}</text>
    </svg>`);
    composites.push({ input: img, left: x, top: y });
    composites.push({ input: text, left: x, top: y + cell });
  }
  await sharp({ create: { width: cols * cell, height: rows * (cell + label), channels: 3, background: "#f6f7f9" } })
    .composite(composites)
    .webp({ quality: 90 })
    .toFile(outFile);
}

async function main() {
  ensureDir(reportDir);
  ensureDir(reviewDir);
  const map = loadManifestMap();
  const blur = blurIds.map((brand_id) => ({ brand_id, ...(map.get(brand_id) || {}) }));
  const borderCrop = [];
  const sharpenedBlur = [];
  const cropOnly = process.argv.includes("--crop-only");

  for (const brand_id of borderCropIds) {
    const entry = map.get(brand_id);
    if (!entry) {
      borderCrop.push({ brand_id, status: "missing_manifest" });
      continue;
    }
    const cell = await extractShiftedGridCell(entry);
    const recentered = await recenterTile(cell);
    await writeTile(brand_id, recentered.buffer);
    borderCrop.push({
      brand_id,
      grid_id: entry.grid_id,
      source_grid_id: entry.source_grid_id,
      source_type: entry.source_type,
      row: entry.row,
      col: entry.col,
      status: "recentered_from_grid",
      changedPixels: recentered.changedPixels,
      originalBox: recentered.box
    });
  }

  if (!cropOnly) {
    for (const brand_id of blurIds) {
      sharpenedBlur.push(await sharpenBlurTile(brand_id));
    }
  }

  const gridsToRegenerate = [...new Set(blur.map((item) => item.grid_id).filter(Boolean))].sort();
  const report = {
    generatedAt: new Date().toISOString(),
    blurIds,
    borderCropIds,
    gridsToRegenerate,
    blur,
    sharpenedBlur,
    borderCrop
  };
  fs.writeFileSync(path.join(reportDir, "logo-known-asset-repair-plan.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await buildContactSheet(borderCrop.filter((item) => item.status === "recentered_from_grid").map((item) => ({ ...item, kind: "R" })), path.join(reviewDir, "logo-recentered-preview.webp"));
  if (!cropOnly) {
    await buildContactSheet(sharpenedBlur.map((item) => ({ ...item, grid_id: map.get(item.brand_id)?.grid_id || "", kind: "S" })), path.join(reviewDir, "logo-sharpened-blur-preview.webp"));
  }
  console.log(JSON.stringify({
    blurCount: blurIds.length,
    borderCropCount: borderCropIds.length,
    gridsToRegenerate,
    recentered: borderCrop.filter((item) => item.status === "recentered_from_grid").length,
    sharpened: sharpenedBlur.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
