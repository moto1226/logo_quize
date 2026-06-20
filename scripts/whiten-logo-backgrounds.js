const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist", "logos", "v20260620r2");
const tilesDir = path.join(root, "generated", "logo-test", "tiles");
const targets = process.argv.includes("--all") ? [tilesDir, distDir] : [distDir];
const idsArgIndex = process.argv.indexOf("--ids");
const targetIds = idsArgIndex >= 0
  ? new Set(String(process.argv[idsArgIndex + 1] || "").split(",").map((id) => id.trim()).filter(Boolean))
  : null;

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => /\.(png|webp)$/i.test(file))
    .filter((file) => !targetIds || targetIds.has(path.basename(file, path.extname(file))))
    .map((file) => path.join(dir, file));
}

function isNearWhiteBackground(r, g, b, a) {
  if (a !== undefined && a < 12) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  return avg >= 236 && max - min <= 22;
}

function isPureWhite(r, g, b, a) {
  return r >= 254 && g >= 254 && b >= 254 && (a === undefined || a >= 254);
}

function shouldProcess(data, info) {
  if (targetIds) return true;
  let sampled = 0;
  let nearWhiteNotPure = 0;
  const step = 4;
  const band = 10;
  const sample = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    sampled += 1;
    if (isNearWhiteBackground(r, g, b, a) && !isPureWhite(r, g, b, a)) nearWhiteNotPure += 1;
  };
  for (let y = 0; y < band; y += 1) {
    for (let x = 0; x < info.width; x += step) {
      sample(x, y);
      sample(x, info.height - 1 - y);
    }
  }
  for (let x = 0; x < band; x += 1) {
    for (let y = band; y < info.height - band; y += step) {
      sample(x, y);
      sample(info.width - 1 - x, y);
    }
  }
  return sampled > 0 && nearWhiteNotPure / sampled >= 0.02;
}

async function cleanImage(file) {
  const resolvedFile = path.resolve(file);
  const isAllowed = targets.some((dir) => resolvedFile.startsWith(`${path.resolve(dir)}${path.sep}`));
  if (!isAllowed) throw new Error(`Refusing to modify file outside logo directories: ${file}`);

  const input = fs.readFileSync(file);
  const { data, info } = await sharp(input, { animated: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (!shouldProcess(data, info)) return { file, changed: 0 };

  let changed = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const a = data[offset + 3];
      if (!isNearWhiteBackground(r, g, b, a) || isPureWhite(r, g, b, a)) continue;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
      changed += 1;
    }
  }

  if (!changed) return { file, changed };
  const output = sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  });
  const buffer = /\.webp$/i.test(file)
    ? await output.webp({ quality: 92 }).toBuffer()
    : await output.png().toBuffer();
  fs.writeFileSync(file, buffer);
  return { file, changed };
}

async function main() {
  const files = targets.flatMap(listImages);
  let changedFiles = 0;
  let changedPixels = 0;
  const samples = [];

  for (const file of files) {
    const result = await cleanImage(file);
    if (!result.changed) continue;
    changedFiles += 1;
    changedPixels += result.changed;
    if (samples.length < 24) samples.push(path.relative(root, file));
  }

  console.log(JSON.stringify({
    scanned: files.length,
    changedFiles,
    changedPixels,
    samples
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
