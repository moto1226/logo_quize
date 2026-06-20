const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const logoDir = path.join(root, "dist", "logos", "v20260620r2");
const reportDir = path.join(root, "reports");
const reviewDir = path.join(root, "review");
const jsonReport = path.join(reportDir, "logo-blur-audit.json");
const htmlReport = path.join(reviewDir, "logo-blur-audit.html");

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isContent(r, g, b, a) {
  if (a < 16) return false;
  return r < 246 || g < 246 || b < 246;
}

async function analyze(file) {
  const input = fs.readFileSync(file);
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const gray = new Float32Array(width * height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let contentPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * info.channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const a = data[offset + 3];
      gray[y * width + x] = luminance(r, g, b);
      if (!isContent(r, g, b, a)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      contentPixels += 1;
    }
  }

  if (!contentPixels) {
    return {
      brand_id: path.basename(file, path.extname(file)),
      file: path.relative(root, file),
      level: "severe",
      contentRatio: 0,
      laplacianVariance: 0,
      edgeDensity: 0,
      score: 0
    };
  }

  minX = Math.max(1, minX - 2);
  minY = Math.max(1, minY - 2);
  maxX = Math.min(width - 2, maxX + 2);
  maxY = Math.min(height - 2, maxY + 2);

  const laplacians = [];
  let edgeCount = 0;
  let sampleCount = 0;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const center = gray[y * width + x];
      const lap =
        gray[(y - 1) * width + x] +
        gray[(y + 1) * width + x] +
        gray[y * width + x - 1] +
        gray[y * width + x + 1] -
        4 * center;
      const gx = gray[y * width + x + 1] - gray[y * width + x - 1];
      const gy = gray[(y + 1) * width + x] - gray[(y - 1) * width + x];
      const gradient = Math.sqrt(gx * gx + gy * gy);
      laplacians.push(lap);
      if (gradient >= 34) edgeCount += 1;
      sampleCount += 1;
    }
  }

  const mean = laplacians.reduce((sum, value) => sum + value, 0) / laplacians.length;
  const laplacianVariance = laplacians.reduce((sum, value) => sum + (value - mean) ** 2, 0) / laplacians.length;
  const edgeDensity = edgeCount / Math.max(1, sampleCount);
  const contentRatio = contentPixels / (width * height);
  const score = laplacianVariance * 0.72 + edgeDensity * 1800;
  const fileSize = fs.statSync(file).size;
  const lowFidelity = contentRatio >= 0.2 && score < 90 && edgeDensity < 0.02;
  const level = score < 22 || (laplacianVariance < 14 && edgeDensity < 0.009)
    ? "severe"
    : score < 45 || (laplacianVariance < 26 && edgeDensity < 0.016) || lowFidelity
      ? "suspect"
      : "ok";

  return {
    brand_id: path.basename(file, path.extname(file)),
    file: path.relative(root, file),
    level,
    fileSize,
    contentRatio: Number(contentRatio.toFixed(4)),
    laplacianVariance: Number(laplacianVariance.toFixed(2)),
    edgeDensity: Number(edgeDensity.toFixed(4)),
    score: Number(score.toFixed(2)),
    lowFidelity
  };
}

function buildHtml(results, summary) {
  const rows = results
    .filter((item) => item.level !== "ok")
    .sort((a, b) => a.score - b.score)
    .map((item) => `
      <article class="card ${item.level}">
        <img src="../${item.file.replace(/\\/g, "/")}" loading="lazy" alt="">
        <div>
          <h2>${htmlEscape(item.brand_id)}</h2>
          <p>${htmlEscape(item.level)} | score ${item.score} | lap ${item.laplacianVariance} | edge ${item.edgeDensity} | size ${item.fileSize}</p>
          <p>${htmlEscape(item.file)}</p>
        </div>
      </article>`)
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Logo 模糊图片审计</title>
  <style>
    body{margin:0;background:#f6f7f9;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e5e7eb;padding:16px 20px;z-index:2}
    h1{margin:0 0 8px;font-size:22px}.summary{display:flex;gap:8px;flex-wrap:wrap;color:#667085;font-size:13px}.summary span{border:1px solid #e5e7eb;border-radius:999px;padding:5px 9px}
    main{padding:18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px}.card.severe{border-color:#ff7875;background:#fff1f0}.card.suspect{border-color:#ffd591;background:#fff7e6}
    img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#fff;border-radius:6px}h2{font-size:15px;margin:8px 0 4px;word-break:break-word}p{margin:3px 0;color:#667085;font-size:12px;word-break:break-word}
  </style>
</head>
<body>
  <header>
    <h1>Logo 模糊图片审计</h1>
    <div class="summary">
      <span>总数 ${summary.total}</span>
      <span>严重模糊 ${summary.severe}</span>
      <span>疑似模糊 ${summary.suspect}</span>
      <span>正常 ${summary.ok}</span>
      <span>生成时间 ${htmlEscape(summary.generatedAt)}</span>
    </div>
  </header>
  <main>${rows}</main>
</body>
</html>`;
}

async function main() {
  const files = fs.readdirSync(logoDir)
    .filter((file) => /\.webp$/i.test(file))
    .sort()
    .map((file) => path.join(logoDir, file));

  const results = [];
  for (const file of files) {
    results.push(await analyze(file));
  }

  const summary = {
    total: results.length,
    severe: results.filter((item) => item.level === "severe").length,
    suspect: results.filter((item) => item.level === "suspect").length,
    ok: results.filter((item) => item.level === "ok").length,
    generatedAt: new Date().toISOString()
  };

  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(jsonReport, `${JSON.stringify({ summary, results }, null, 2)}\n`, "utf8");
  fs.writeFileSync(htmlReport, buildHtml(results, summary), "utf8");

  const huaban = results.find((item) => item.brand_id === "huaban");
  console.log(JSON.stringify({
    ...summary,
    huaban,
    lowest: results.slice().sort((a, b) => a.score - b.score).slice(0, 20)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
