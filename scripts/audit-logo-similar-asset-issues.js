const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { parse } = require("csv-parse/sync");

const root = path.resolve(__dirname, "..");
const logoDir = path.join(root, "dist", "logos", "v20260620r2");
const csvFile = path.join(root, "logo_industry_brand_collection_MAX_flat.csv");
const manualFile = path.join(root, "reports", "logo-manual-asset-issues.json");
const blurFile = path.join(root, "reports", "logo-blur-audit.json");
const reportDir = path.join(root, "reports");
const reviewDir = path.join(root, "review");
const jsonFile = path.join(reportDir, "logo-similar-asset-issue-candidates.json");
const htmlFile = path.join(reviewDir, "logo-similar-asset-issue-candidates.html");
const blurFalsePositiveIds = new Set(["kakaomap", "firebase", "flo", "strava", "lazada", "cn_cb7bed93"]);

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readRows() {
  return parse(fs.readFileSync(csvFile, "utf8"), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

function isContent(r, g, b, a) {
  if (a < 16) return false;
  return r < 246 || g < 246 || b < 246;
}

async function layoutMetrics(brandId) {
  const file = path.join(logoDir, `${brandId}.webp`);
  const { data, info } = await sharp(fs.readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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

  if (!contentPixels) {
    return {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      offsetX: 0,
      offsetY: 0,
      bboxWidth: 0,
      bboxHeight: 0,
      contentRatio: 0
    };
  }

  const left = minX;
  const top = minY;
  const right = info.width - 1 - maxX;
  const bottom = info.height - 1 - maxY;
  return {
    left,
    top,
    right,
    bottom,
    offsetX: Math.round((minX + maxX) / 2 - (info.width - 1) / 2),
    offsetY: Math.round((minY + maxY) / 2 - (info.height - 1) / 2),
    bboxWidth: maxX - minX + 1,
    bboxHeight: maxY - minY + 1,
    contentRatio: Number((contentPixels / (info.width * info.height)).toFixed(4))
  };
}

function layoutReasons(metrics) {
  const reasons = [];
  const minMargin = Math.min(metrics.left, metrics.top, metrics.right, metrics.bottom);
  const horizontalImbalance = Math.abs(metrics.left - metrics.right);
  const verticalImbalance = Math.abs(metrics.top - metrics.bottom);

  if (minMargin <= 4 && (metrics.bboxWidth >= 300 || metrics.bboxHeight >= 300)) reasons.push("内容贴边，可能裁切或有边框残留");
  if (metrics.bboxWidth >= 492 || metrics.bboxHeight >= 492) reasons.push("内容框几乎占满画布");
  if (horizontalImbalance >= 110 && Math.min(metrics.left, metrics.right) <= 24) reasons.push("左右边距明显失衡");
  if (verticalImbalance >= 130 && Math.min(metrics.top, metrics.bottom) <= 24) reasons.push("上下边距明显失衡");
  if (Math.abs(metrics.offsetX) >= 70 || Math.abs(metrics.offsetY) >= 90) reasons.push("视觉中心偏移较大");

  return reasons;
}

function blurReasons(item) {
  const reasons = [];
  if (item.fileSize <= 6500 && item.contentRatio >= 0.18 && item.edgeDensity <= 0.021) reasons.push("文件较小且边缘密度偏低");
  if (item.contentRatio >= 0.35 && item.score <= 170) reasons.push("大面积内容但细节分数偏低");
  if (item.contentRatio >= 0.18 && item.laplacianVariance <= 115 && item.edgeDensity <= 0.018) reasons.push("局部锐度和边缘数量都偏低");
  return reasons;
}

function buildHtml(candidates, summary) {
  const sections = [
    ["blur", "模糊候选"],
    ["crop_or_border", "边框 / 裁切 / 不居中候选"]
  ].map(([type, title]) => {
    const cards = candidates
      .filter((item) => item.issue_type === type)
      .map((item) => `
        <article class="card ${type}">
          <img src="../${item.file.replace(/\\/g, "/")}" loading="lazy" alt="">
          <div class="body">
            <div class="tag">${htmlEscape(title)}</div>
            <h2>${htmlEscape(item.name)}</h2>
            <p>${htmlEscape(item.brand_id)}</p>
            <p>${htmlEscape(item.category)}</p>
            <p>${htmlEscape(item.reasons.join("；"))}</p>
            <p>score ${item.score ?? "-"} | edge ${item.edgeDensity ?? "-"} | margins ${item.layout.left}/${item.layout.top}/${item.layout.right}/${item.layout.bottom} | offset ${item.layout.offsetX}/${item.layout.offsetY}</p>
          </div>
        </article>`)
      .join("");
    return `<section><h2>${htmlEscape(title)} (${summary[type]})</h2><div class="grid">${cards}</div></section>`;
  }).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Logo 类似问题候选</title>
  <style>
    body{margin:0;background:#f6f7f9;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid #e5e7eb;padding:16px 20px}
    h1{margin:0 0 8px;font-size:22px}.summary{display:flex;gap:8px;flex-wrap:wrap;color:#667085;font-size:13px}.summary span{border:1px solid #e5e7eb;border-radius:999px;padding:5px 9px}
    section{padding:18px}section>h2{font-size:20px;margin:0 0 12px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}.card.blur{border-color:#ff7875}.card.crop_or_border{border-color:#ffd591}
    img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#fff;border-bottom:1px solid #eef2f7}.body{padding:10px}.tag{display:inline-block;border-radius:999px;background:#f2f4f7;color:#344054;padding:4px 8px;font-size:12px;font-weight:700}h2{font-size:16px;margin:8px 0 4px;word-break:break-word}p{margin:3px 0;color:#667085;font-size:12px;word-break:break-word}
  </style>
</head>
<body>
  <header>
    <h1>Logo 类似问题候选</h1>
    <div class="summary">
      <span>新增候选 ${summary.total}</span>
      <span>模糊候选 ${summary.blur}</span>
      <span>边框/裁切/不居中候选 ${summary.crop_or_border}</span>
      <span>已排除人工确认 ${summary.excludedManual}</span>
      <span>生成时间 ${htmlEscape(summary.generatedAt)}</span>
    </div>
  </header>
  ${sections}
</body>
</html>`;
}

async function main() {
  const rows = readRows();
  const rowMap = new Map(rows.map((row) => [row.brand_id, row]));
  const manual = JSON.parse(fs.readFileSync(manualFile, "utf8"));
  const manualIds = new Set(manual.issues.map((item) => item.brand_id));
  const blurAudit = JSON.parse(fs.readFileSync(blurFile, "utf8"));
  const candidates = [];

  for (const metric of blurAudit.results) {
    if (manualIds.has(metric.brand_id)) continue;
    const file = path.join(logoDir, `${metric.brand_id}.webp`);
    if (!fs.existsSync(file)) continue;
    const row = rowMap.get(metric.brand_id) || {};
    const layout = await layoutMetrics(metric.brand_id);
    const bReasons = blurReasons(metric);
    const lReasons = layoutReasons(layout);
    const base = {
      brand_id: metric.brand_id,
      name: row["品牌名称"] || row["英文名/常用名"] || metric.brand_id,
      category: [row["一级行业"], row["小分类名称"]].filter(Boolean).join(" / "),
      file: metric.file,
      score: metric.score,
      fileSize: metric.fileSize,
      contentRatio: metric.contentRatio,
      edgeDensity: metric.edgeDensity,
      laplacianVariance: metric.laplacianVariance,
      layout
    };

    if (bReasons.length && !blurFalsePositiveIds.has(metric.brand_id)) candidates.push({ ...base, issue_type: "blur", reasons: bReasons });
    if (lReasons.length) candidates.push({ ...base, issue_type: "crop_or_border", reasons: lReasons });
  }

  const ranked = candidates
    .sort((a, b) => {
      if (a.issue_type !== b.issue_type) return a.issue_type === "blur" ? -1 : 1;
      if (a.issue_type === "blur") return a.score - b.score;
      const aMin = Math.min(a.layout.left, a.layout.top, a.layout.right, a.layout.bottom);
      const bMin = Math.min(b.layout.left, b.layout.top, b.layout.right, b.layout.bottom);
      return aMin - bMin || Math.abs(b.layout.offsetY) - Math.abs(a.layout.offsetY);
    })
    .slice(0, 120);

  const summary = {
    total: ranked.length,
    blur: ranked.filter((item) => item.issue_type === "blur").length,
    crop_or_border: ranked.filter((item) => item.issue_type === "crop_or_border").length,
    excludedManual: manualIds.size,
    generatedAt: new Date().toISOString()
  };

  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(jsonFile, `${JSON.stringify({ summary, candidates: ranked }, null, 2)}\n`, "utf8");
  fs.writeFileSync(htmlFile, buildHtml(ranked, summary), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  console.log(ranked.slice(0, 40).map((item) => `${item.issue_type} | ${item.brand_id} | ${item.reasons.join("; ")}`).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
