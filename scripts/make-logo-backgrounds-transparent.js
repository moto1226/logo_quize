const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const sourceVersion = getArg("--source", "v20260620r2");
const targetVersion = getArg("--target", "v20260621t1");
const sourceDir = path.join(root, "dist", "logos", sourceVersion);
const targetDir = path.join(root, "dist", "logos", targetVersion);
const reportPath = path.join(root, "reports", `transparent-backgrounds-${targetVersion}.json`);
const htmlPath = path.join(root, "reports", `transparent-backgrounds-${targetVersion}.html`);

function getArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

function isNearWhiteBackground(r, g, b, a) {
  if (a < 12) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  return avg >= 246 && max - min <= 16;
}

function floodEdgeBackground(data, info) {
  const total = info.width * info.height;
  const seen = new Uint8Array(total);
  const queue = [];

  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return;
    const index = y * info.width + x;
    if (seen[index]) return;
    const offset = index * info.channels;
    if (!isNearWhiteBackground(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) return;
    seen[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x, 0);
    enqueue(x, info.height - 1);
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    enqueue(0, y);
    enqueue(info.width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  return seen;
}

async function processLogo(file) {
  const sourcePath = path.join(sourceDir, file);
  const targetPath = path.join(targetDir, file);
  const input = fs.readFileSync(sourcePath);
  const { data, info } = await sharp(input, { animated: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const backgroundMask = floodEdgeBackground(data, info);
  let transparentPixels = 0;

  for (let index = 0; index < backgroundMask.length; index += 1) {
    if (!backgroundMask[index]) continue;
    const offset = index * info.channels;
    if (data[offset + 3] !== 0) transparentPixels += 1;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 0;
  }

  if (transparentPixels === 0) {
    fs.copyFileSync(sourcePath, targetPath);
  } else {
    await sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels
      }
    }).webp({ quality: 92, alphaQuality: 100 }).toFile(targetPath);
  }

  return {
    file,
    transparentPixels,
    transparentRatio: Number((transparentPixels / (info.width * info.height)).toFixed(4))
  };
}

function writeHtml(results) {
  const changed = results.filter((item) => item.transparentPixels > 0).slice(0, 240);
  const cards = changed.map((item) => {
    const name = path.basename(item.file, path.extname(item.file));
    return `<article class="card">
      <div class="pair">
        <div><div class="label">Before</div><img src="../dist/logos/${sourceVersion}/${item.file}"></div>
        <div><div class="label">After</div><img src="../dist/logos/${targetVersion}/${item.file}"></div>
      </div>
      <h2>${name}</h2>
      <p>${item.transparentPixels} px / ${(item.transparentRatio * 100).toFixed(1)}%</p>
    </article>`;
  }).join("\n");

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Transparent Logo Background Preview</title>
<style>
body{margin:24px;font-family:Arial,sans-serif;background:#f4f7fb;color:#172033}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.card{background:#fff;border:1px solid #d8dee8;border-radius:8px;padding:12px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pair>div{background:linear-gradient(45deg,#ddd 25%,transparent 25%),linear-gradient(-45deg,#ddd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd 75%),linear-gradient(-45deg,transparent 75%,#ddd 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0;border:1px solid #ccd3dd;border-radius:6px;text-align:center}
img{width:140px;height:140px;object-fit:contain}
.label{padding:6px;font-size:12px;font-weight:700;background:rgba(255,255,255,.82)}
h1{font-size:22px}h2{font-size:15px;margin:10px 0 4px}p{margin:0;color:#607089}
</style>
<h1>${targetVersion} transparent background preview</h1>
<p>Showing first ${changed.length} changed logos. Source files are not modified.</p>
<div class="grid">${cards}</div>`;
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
}

async function main() {
  if (!fs.existsSync(sourceDir)) throw new Error(`Source directory not found: ${sourceDir}`);
  if (fs.existsSync(targetDir)) throw new Error(`Target directory already exists, refusing to overwrite: ${targetDir}`);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const files = fs.readdirSync(sourceDir).filter((file) => /\.webp$/i.test(file)).sort();
  const results = [];
  for (const file of files) {
    results.push(await processLogo(file));
  }

  const changed = results.filter((item) => item.transparentPixels > 0);
  const report = {
    sourceVersion,
    targetVersion,
    sourceDir: path.relative(root, sourceDir),
    targetDir: path.relative(root, targetDir),
    scanned: results.length,
    changed: changed.length,
    unchanged: results.length - changed.length,
    samples: changed.slice(0, 30),
    results
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  writeHtml(results);
  console.log(JSON.stringify({
    sourceVersion,
    targetVersion,
    scanned: report.scanned,
    changed: report.changed,
    unchanged: report.unchanged,
    targetDir: report.targetDir,
    report: path.relative(root, reportPath),
    preview: path.relative(root, htmlPath)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
