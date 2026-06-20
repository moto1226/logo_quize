const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const brandsFile = path.join(root, "miniprogram", "packages", "quiz", "data", "brands.js");
const distLogoDir = path.join(root, "dist", "logos", "v20260620r2");
const reportDir = path.join(root, "reports");
const reviewDir = path.join(root, "review");
const reportFile = path.join(reportDir, "logo-visual-risk-audit.json");
const reviewFile = path.join(reviewDir, "logo-visual-risk-audit.html");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bitStringToBigInt(bits) {
  return BigInt(`0b${bits}`);
}

function hamming(a, b) {
  let value = a ^ b;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

async function averageHash(file) {
  const buffer = await sharp(file)
    .resize(8, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  const avg = buffer.reduce((sum, value) => sum + value, 0) / buffer.length;
  return bitStringToBigInt([...buffer].map((value) => (value >= avg ? "1" : "0")).join(""));
}

async function differenceHash(file) {
  const buffer = await sharp(file)
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits += buffer[y * 9 + x] > buffer[y * 9 + x + 1] ? "1" : "0";
    }
  }
  return bitStringToBigInt(bits);
}

async function imageMetrics(file) {
  const metadata = await sharp(file).metadata();
  const { data, info } = await sharp(file)
    .resize(128, 128, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let nonWhite = 0;
  let minLum = 255;
  let maxLum = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const a = data[offset + 3];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (a > 20) {
        minLum = Math.min(minLum, lum);
        maxLum = Math.max(maxLum, lum);
      }
      if (a > 20 && (r < 245 || g < 245 || b < 245)) {
        nonWhite += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const total = info.width * info.height;
  const bboxWidth = maxX >= minX ? maxX - minX + 1 : 0;
  const bboxHeight = maxY >= minY ? maxY - minY + 1 : 0;
  const contentRatio = nonWhite / total;
  const bboxAreaRatio = bboxWidth && bboxHeight ? (bboxWidth * bboxHeight) / total : 0;
  const contrast = maxLum - minLum;

  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    file_size: fs.statSync(file).size,
    content_ratio: Number(contentRatio.toFixed(5)),
    bbox_width_ratio: Number((bboxWidth / info.width).toFixed(5)),
    bbox_height_ratio: Number((bboxHeight / info.height).toFixed(5)),
    bbox_area_ratio: Number(bboxAreaRatio.toFixed(5)),
    contrast: Number(contrast.toFixed(2))
  };
}

function riskFlags(metrics) {
  const flags = [];
  if (metrics.content_ratio < 0.004) flags.push("near_blank_or_too_light");
  if (metrics.bbox_width_ratio < 0.16 || metrics.bbox_height_ratio < 0.16) flags.push("tiny_visible_area");
  if (metrics.contrast < 18) flags.push("low_contrast");
  if (metrics.file_size < 2500) flags.push("very_small_file");
  if (metrics.width < 256 || metrics.height < 256) flags.push("low_resolution");
  return flags;
}

function riskScore(flags, metrics) {
  let score = flags.length * 10;
  if (metrics.content_ratio < 0.002) score += 20;
  if (metrics.bbox_area_ratio < 0.03) score += 10;
  return score;
}

function makeUnionFind(size) {
  const parent = Array.from({ length: size }, (_, index) => index);
  function find(index) {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }
  function union(a, b) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  }
  return { find, union };
}

function buildNearDuplicateGroups(entries) {
  const uf = makeUnionFind(entries.length);
  const pairs = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const dDistance = hamming(entries[i].dhash_value, entries[j].dhash_value);
      if (dDistance > 3) continue;
      const aDistance = hamming(entries[i].ahash_value, entries[j].ahash_value);
      if (aDistance > 5) continue;
      uf.union(i, j);
      pairs.push({
        a: entries[i].brand_id,
        b: entries[j].brand_id,
        dhash_distance: dDistance,
        ahash_distance: aDistance
      });
    }
  }

  const groups = new Map();
  entries.forEach((entry, index) => {
    const rootIndex = uf.find(index);
    if (!groups.has(rootIndex)) groups.set(rootIndex, []);
    groups.get(rootIndex).push(entry);
  });

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      count: group.length,
      brands: group.map((entry) => ({
        brand_id: entry.brand_id,
        display_name: entry.display_name,
        image: `../dist/logos/v20260620r2/${entry.brand_id}.webp`
      }))
    }))
    .sort((a, b) => b.count - a.count);
}

function writeHtml(entries, nearDuplicateGroups, summary) {
  const risky = entries.filter((entry) => entry.risk_flags.length).sort((a, b) => b.risk_score - a.risk_score);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Logo Visual Risk Audit</title>
  <style>
    body{margin:0;background:#f5f7fa;color:#0b1f3a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header{position:sticky;top:0;z-index:2;background:rgba(245,247,250,.96);padding:20px 24px;border-bottom:1px solid #dbe3ef}
    h1{margin:0 0 8px;font-size:24px}
    .summary{display:flex;flex-wrap:wrap;gap:10px;color:#667085}
    .summary span{background:#fff;border:1px solid #dbe3ef;border-radius:999px;padding:6px 10px}
    section{padding:24px}
    h2{font-size:20px;margin:0 0 14px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:16px;padding:12px;box-shadow:0 6px 20px rgba(15,23,42,.06)}
    .card img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#fff;border-radius:10px;border:1px solid #eef2f7}
    .name{font-weight:700;margin-top:8px;line-height:1.25}
    .id,.flags,.metrics{font-size:12px;color:#667085;margin-top:5px;word-break:break-all}
    .flags{color:#b42318}
    .group{background:#fff;border:1px solid #dbe3ef;border-radius:16px;margin-bottom:18px;padding:14px}
    .group-title{font-weight:800;margin-bottom:10px}
    .muted{color:#667085}
  </style>
</head>
<body>
  <header>
    <h1>Logo 视觉风险审计</h1>
    <div class="summary">
      <span>入题库品牌 ${summary.brand_count}</span>
      <span>风险图 ${summary.risky_count}</span>
      <span>近似重复组 ${summary.near_duplicate_group_count}</span>
      <span>生成时间 ${htmlEscape(summary.generated_at)}</span>
    </div>
  </header>
  <section>
    <h2>风险图</h2>
    ${risky.length ? `<div class="grid">${risky.map((entry) => `<article class="card">
      <img src="../dist/logos/v20260620r2/${htmlEscape(entry.brand_id)}.webp" loading="lazy" alt="${htmlEscape(entry.display_name)}">
      <div class="name">${htmlEscape(entry.display_name)}</div>
      <div class="id">${htmlEscape(entry.brand_id)}</div>
      <div class="flags">${entry.risk_flags.map(htmlEscape).join(" / ")}</div>
      <div class="metrics">content ${entry.metrics.content_ratio} · bbox ${entry.metrics.bbox_width_ratio}x${entry.metrics.bbox_height_ratio} · contrast ${entry.metrics.contrast}</div>
    </article>`).join("")}</div>` : `<p class="muted">没有发现空白、小图、低对比等基础风险。</p>`}
  </section>
  <section>
    <h2>近似重复候选</h2>
    ${nearDuplicateGroups.length ? nearDuplicateGroups.map((group, index) => `<div class="group">
      <div class="group-title">Group ${index + 1} · ${group.count} brands</div>
      <div class="grid">${group.brands.map((brand) => `<article class="card">
        <img src="${htmlEscape(brand.image)}" loading="lazy" alt="${htmlEscape(brand.display_name)}">
        <div class="name">${htmlEscape(brand.display_name)}</div>
        <div class="id">${htmlEscape(brand.brand_id)}</div>
      </article>`).join("")}</div>
    </div>`).join("") : `<p class="muted">没有发现严格阈值下的近似重复候选。</p>`}
  </section>
</body>
</html>
`;
  ensureDir(path.dirname(reviewFile));
  fs.writeFileSync(reviewFile, html, "utf8");
}

async function main() {
  const brands = require(brandsFile);
  const entries = [];
  const missing = [];

  for (const brand of brands) {
    const file = path.join(distLogoDir, `${brand.brand_id}.webp`);
    if (!fs.existsSync(file)) {
      missing.push(brand);
      continue;
    }
    const [metrics, ahash, dhash] = await Promise.all([
      imageMetrics(file),
      averageHash(file),
      differenceHash(file)
    ]);
    const flags = riskFlags(metrics);
    entries.push({
      brand_id: brand.brand_id,
      display_name: brand.display_name,
      industry: brand.industry,
      category: brand.category,
      metrics,
      risk_flags: flags,
      risk_score: riskScore(flags, metrics),
      ahash: ahash.toString(16).padStart(16, "0"),
      dhash: dhash.toString(16).padStart(16, "0"),
      ahash_value: ahash,
      dhash_value: dhash
    });
  }

  const nearDuplicateGroups = buildNearDuplicateGroups(entries);
  const reportEntries = entries.map(({ ahash_value, dhash_value, ...entry }) => entry);
  const summary = {
    generated_at: new Date().toISOString(),
    brand_count: brands.length,
    checked_logo_count: entries.length,
    missing_logo_count: missing.length,
    risky_count: entries.filter((entry) => entry.risk_flags.length).length,
    near_duplicate_group_count: nearDuplicateGroups.length
  };

  ensureDir(reportDir);
  fs.writeFileSync(reportFile, `${JSON.stringify({
    summary,
    missing_logos: missing,
    risky_logos: reportEntries.filter((entry) => entry.risk_flags.length).sort((a, b) => b.risk_score - a.risk_score),
    near_duplicate_groups: nearDuplicateGroups,
    logos: reportEntries
  }, null, 2)}\n`, "utf8");
  writeHtml(reportEntries, nearDuplicateGroups, summary);
  console.log(JSON.stringify({
    ...summary,
    report: path.relative(root, reportFile).replace(/\\/g, "/"),
    review: path.relative(root, reviewFile).replace(/\\/g, "/")
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
