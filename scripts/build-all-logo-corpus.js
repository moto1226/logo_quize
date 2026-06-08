const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const {
  root,
  indexJson: svglogoIndexJson,
  readJson,
  readCsv,
  writeJson,
  writeCsv,
  ensureDir,
  fileSize,
  listFiles,
  htmlEscape,
  isProcessableSvglogo,
  seedFile,
  matchesCsv
} = require("./svglogo-common");
const { readSourceCandidates } = require("./logo-candidates-common");
const expandedCandidatesCsv = path.join(root, "logo_brand_expanded_candidates.csv");

const columns = [
  "corpus_id",
  "title",
  "source_type",
  "source_name",
  "source_url",
  "license",
  "license_url",
  "raw_file",
  "webp_file",
  "preview_file",
  "original_format",
  "width",
  "height",
  "file_size_bytes",
  "is_wordmark",
  "has_visible_text",
  "auto_exclude",
  "exclude_reason",
  "review_status",
  "notes"
];

function isWordmarkPath(value) {
  const name = path.basename(String(value || "")).toLowerCase();
  return /(?:wordmark|wordmard)(?:\.(svg|png|jpe?g|webp))?$/.test(name);
}

const basePopularBrandAliases = [
  "3m", "adobe", "airbnb", "alphabet", "amazon", "amd", "americanexpress", "amex", "apple", "atandt", "aws",
  "bankofamerica", "bestbuy", "boeing", "burgerking", "calvinklein", "capitalone", "chase", "chevrolet", "chipotle",
  "cisco", "citibank", "cocacola", "coinbase", "costco", "dell", "delta", "discord", "disney", "dominos",
  "doordash", "dropbox", "dunkin", "ebay", "espn", "exxon", "facebook", "fedex", "figma", "ford", "gap", "gatorade",
  "ge", "generalelectric", "generalmotors", "github", "gmail", "google", "homedepot", "hp", "hpe", "ibm", "instagram",
  "intel", "johnsonandjohnson", "kfc", "kraft", "linkedin", "lowes", "macys", "mastercard", "mcdonalds", "meta",
  "microsoft", "monster", "monsterenergy", "motorola", "netflix", "nike", "nvidia", "openai", "oracle", "paypal",
  "pepsi", "pinterest", "pizzahut", "reddit", "salesforce", "slack", "snapchat", "spacex", "starbucks", "stripe",
  "subway", "tacobell", "target", "tesla", "tiffany", "tiktok", "twitter", "uber", "underarmour", "ups", "verizon",
  "visa", "walmart", "walgreens", "whatsapp", "xbox", "youtube", "zoom",
  "adidas", "alibaba", "alipay", "armani", "audi", "baidu", "bankofchina", "bilibili", "bmw", "bosch", "byd",
  "cartier", "chanel", "chinaeasternairlines", "chinasouthernairlines", "dior", "douyin", "ferrari", "gucci",
  "haier", "heineken", "hermes", "honda", "hsbc", "huawei", "hyundai", "icbc", "ikea", "jd", "kia", "lamborghini",
  "lego", "lenovo", "lexus", "line", "louisvuitton", "maserati", "mazda", "meituan", "mercedesbenz", "mitsubishi",
  "muji", "nestle", "nio", "nintendo", "nissan", "oppo", "panasonic", "pinduoduo", "playstation", "porsche", "puma",
  "qq", "rakuten", "redbull", "reebok", "samsung", "sap", "shell", "siemens", "sony", "spotify", "steam", "suzuki",
  "taobao", "telegram", "tencent", "tmall", "toyota", "uniqlo", "vivo", "volkswagen", "wechat", "wechatpay",
  "xiaohongshu", "xiaomi", "zara"
];

function normalizedBrandText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function aliasesFromBrandRow(row) {
  const out = [];
  for (const value of [row.brand_id, row.name_en, row.domain]) {
    const alias = normalizedBrandText(value);
    if (alias) out.push(alias);
  }
  return out;
}

function loadPopularQuizBrandData() {
  const aliases = new Set(basePopularBrandAliases.map(normalizedBrandText).filter(Boolean));
  const recommendedSvglogoIds = new Set();
  if (fs.existsSync(seedFile)) {
    for (const row of readCsv(seedFile)) {
      aliasesFromBrandRow(row).forEach((alias) => aliases.add(alias));
    }
  }
  if (fs.existsSync(expandedCandidatesCsv)) {
    for (const row of readCsv(expandedCandidatesCsv)) {
      aliasesFromBrandRow({
        brand_id: row.brand_id,
        name_en: row.name_en,
        domain: row.domain_hint
      }).forEach((alias) => aliases.add(alias));
    }
  }
  if (fs.existsSync(matchesCsv)) {
    for (const row of readCsv(matchesCsv)) {
      if (row.recommended === "true" && row.is_wordmark !== "true") {
        if (row.svglogo_id) recommendedSvglogoIds.add(row.svglogo_id);
        aliasesFromBrandRow(row).forEach((alias) => aliases.add(alias));
      }
    }
  }
  return { aliases, recommendedSvglogoIds };
}

const popularQuizBrandData = loadPopularQuizBrandData();

function isPopularQuizBrand(record) {
  if (record.legacy_svglogo_id && popularQuizBrandData.recommendedSvglogoIds.has(record.legacy_svglogo_id)) return true;
  const raw = String(record.raw_file || "").replace(/\\/g, "/").toLowerCase();
  const parts = raw.split("/").map((part) => normalizedBrandText(part.replace(/\.(svg|png|jpe?g|webp)$/i, ""))).filter(Boolean);
  const title = normalizedBrandText(record.title);
  const id = normalizedBrandText(record.corpus_id);
  for (const alias of popularQuizBrandData.aliases) {
    if (title === alias) return true;
    if (parts.some((part) => part === alias || part === `${alias}icon` || part === `${alias}default` || part === `${alias}color`)) return true;
    if (alias.length >= 4 && id.includes(alias)) return true;
  }
  return false;
}

function isLegacyRecommendedSvglogo(record) {
  return Boolean(record.legacy_svglogo_id && popularQuizBrandData.recommendedSvglogoIds.has(record.legacy_svglogo_id));
}

function isProtectedSvglogo(record) {
  return record.source_type === "svglogo" && record.is_wordmark !== "true";
}

function autoExcludeReason(record) {
  const raw = String(record.raw_file || "").replace(/\\/g, "/").toLowerCase();
  const title = String(record.title || "").toLowerCase();
  if (record.is_wordmark === "true") return "wordmark_or_visible_answer";
  if (isProtectedSvglogo(record)) return "";
  if (isAwsServiceIcon(record)) return "aws_service_icon";
  if (!isPopularQuizBrand(record)) return "not_popular_quiz_brand";
  if (record.source_type === "website-icons") return "website_declared_icon_source";
  if (/(^|\/)(favicon|apple-touch-icon|mstile|android-chrome|browserconfig|safari-pinned-tab)([-_.]|\.)/.test(raw)) return "site_internal_icon";
  if (/\/extensions\//.test(raw)) return "tool_extension_icon";
  if (/\/public\/(icon|favicon|apple-touch-icon)\.(svg|png|jpe?g|webp)$/.test(raw)) return "site_internal_icon";
  if (record.source_type === "thesvg") {
    if (!/\/public\/icons\/[^/]+\/(default|color)\.svg$/.test(raw)) return "thesvg_non_brand_primary_variant";
  }
  if (record.source_type === "vectorlogozone") {
    if (!/-icon\.svg$/.test(raw)) return "vectorlogozone_non_icon_variant";
  }
  if (/\/(logo|logos|icons?)\/(16|24|32|48|64|128|256)\.(svg|png|jpe?g|webp)$/.test(raw) || /^(16|24|32|48|64|128|256)$/.test(title)) return "generic_size_icon";
  return "";
}

function isAwsServiceIcon(record) {
  const raw = String(record.raw_file || "").replace(/\\/g, "/").toLowerCase();
  if (record.source_type === "gilbarbara" && /\/aws-[^/]+\.svg$/.test(raw)) return true;
  if (record.source_type === "vectorlogozone" && /\/amazon_aws[^/]+\/amazon_aws[^/]+-icon\.svg$/.test(raw)) return true;
  if (record.source_type === "thesvg" && /\/public\/icons\/aws[-_][^/]+\//.test(raw)) return true;
  return false;
}

const sources = [
  {
    type: "svglogo",
    name: "HeyHuazi/SVGLOGO",
    rootDir: path.join(root, "vendor", "SVGLOGO", "static", "library"),
    repo: "https://github.com/HeyHuazi/SVGLOGO",
    license: "unknown",
    rows() {
      if (!fs.existsSync(svglogoIndexJson)) return [];
      return readJson(svglogoIndexJson)
        .filter((row) => row.exists === "true" && isProcessableSvglogo(row))
        .map((row) => ({
          title: row.title || path.basename(row.file_name, ".svg"),
          file: row.file_abs_path,
          rel: row.file_rel_path,
          legacySvglogoId: row.svglogo_id,
          isWordmark: row.is_wordmark === "true" || isWordmarkPath(row.file_name) ? "true" : row.is_wordmark,
          notes: `${row.category_raw}; ${row.variant}; ${row.source_type}`
        }));
    }
  },
  {
    type: "gilbarbara",
    name: "gilbarbara/logos",
    rootDir: path.join(root, "vendor", "gilbarbara-logos", "logos"),
    repo: "https://github.com/gilbarbara/logos",
    license: "see repository LICENSE",
    rows: scanRows
  },
  {
    type: "vectorlogozone",
    name: "VectorLogoZone/vectorlogozone",
    rootDir: path.join(root, "vendor", "vectorlogozone", "www", "logos"),
    fallbackDir: path.join(root, "vendor", "vectorlogozone"),
    repo: "https://github.com/VectorLogoZone/vectorlogozone",
    license: "see repository LICENSE",
    rows: scanRows
  },
  {
    type: "thesvg",
    name: "theSVG",
    rootDir: path.join(root, "vendor", "thesvg"),
    repo: "https://github.com/glincker/thesvg",
    license: "see repository LICENSE if present",
    rows: scanRows
  },
  {
    type: "car-logos",
    name: "car-logos-dataset",
    rootDir: path.join(root, "vendor", "car-logos-dataset"),
    repo: "https://github.com/filippofilip95/car-logos-dataset",
    license: "MIT; logos remain property of respective owners",
    rows: scanRows
  }
];

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "logo";
}

function scanRows(source) {
  const base = fs.existsSync(source.rootDir) ? source.rootDir : source.fallbackDir;
  if (!base || !fs.existsSync(base)) return [];
  return listFiles(base, (file) => /\.(svg|png|jpe?g|webp)$/i.test(file) && !file.includes(`${path.sep}.git${path.sep}`))
    .map((file) => {
      const rel = path.relative(base, file).replace(/\\/g, "/");
      const lower = rel.toLowerCase();
      const ratio = svgAspectRatio(file);
      return {
        title: path.basename(file, path.extname(file)),
        file,
        rel,
        isWordmark: isWordmarkPath(file) || lower.includes("horizontal") || lower.includes("ar21") || ratio >= 2.2 ? "true" : "unknown",
        notes: ratio >= 2.2 ? `${rel}; wide_svg_aspect=${ratio.toFixed(2)}` : rel
      };
    });
}

function formatFrom(file) {
  return path.extname(file).replace(".", "").toLowerCase() || "bin";
}

function svgAspectRatio(file) {
  if (!/\.svg$/i.test(file)) return 0;
  try {
    const text = fs.readFileSync(file, "utf8").slice(0, 4000);
    const viewBox = text.match(/viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
    if (viewBox) {
      const width = Number(viewBox[1]);
      const height = Number(viewBox[2]);
      return width > 0 && height > 0 ? width / height : 0;
    }
    const width = text.match(/\bwidth=["']([\d.]+)(?:px)?["']/i);
    const height = text.match(/\bheight=["']([\d.]+)(?:px)?["']/i);
    if (width && height) {
      const w = Number(width[1]);
      const h = Number(height[1]);
      return w > 0 && h > 0 ? w / h : 0;
    }
  } catch {}
  return 0;
}

async function contentBoundsRatio(imageFile) {
  try {
    const image = sharp(imageFile).ensureAlpha().raw();
    const { data, info } = await image.toBuffer({ resolveWithObject: true });
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const alpha = data[(y * info.width + x) * 4 + 3];
        if (alpha > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return 0;
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    return height > 0 ? width / height : 0;
  } catch {
    return 0;
  }
}

async function visualHash(imageFile) {
  try {
    const { data } = await sharp(imageFile, { density: 128, limitInputPixels: false })
      .ensureAlpha()
      .trim({ threshold: 10 })
      .resize(16, 16, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .flatten({ background: "#ffffff" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const avg = data.reduce((sum, value) => sum + value, 0) / data.length;
    return [...data].map((value) => (value >= avg ? "1" : "0")).join("");
  } catch {
    return "";
  }
}

function hammingDistance(left, right) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) distance += 1;
  }
  return distance;
}

function dedupePriority(record) {
  const sourcePriority = {
    svglogo: 900,
    wikimedia: 650,
    gilbarbara: 550,
    vectorlogozone: 500,
    "car-logos": 450,
    thesvg: 350,
    "website-icons": 0
  };
  const title = String(record.title || "").toLowerCase();
  return (
    (isLegacyRecommendedSvglogo(record) ? 1000 : 0) +
    (sourcePriority[record.source_type] || 100) +
    (title && !["default", "color", "icon"].includes(title) ? 20 : 0) +
    (record.webp_file ? 5 : 0)
  );
}

function canonicalLogoKey(record) {
  const raw = String(record.raw_file || "").replace(/\\/g, "/").toLowerCase();
  let key = "";
  if (record.legacy_svglogo_id) {
    key = String(record.legacy_svglogo_id).replace(/^[^_]+_/, "");
  } else if (record.source_type === "thesvg") {
    key = raw.match(/public\/icons\/([^/]+)\//)?.[1] || "";
  } else if (record.source_type === "vectorlogozone") {
    key = raw.match(/logos\/([^/]+)\//)?.[1] || "";
  } else if (record.source_type === "wikimedia") {
    key = raw.match(/assets\/_raw\/wikimedia\/([^/]+)\//)?.[1] || "";
  } else {
    key = path.basename(raw, path.extname(raw));
  }
  const normalized = normalizedBrandText(key.replace(/(?:[-_ ]?icon|[-_ ]?default|[-_ ]?color)$/i, ""));
  if (normalized === "amazonaws" || normalized === "amazonwebservices") return "aws";
  return normalized;
}

function markDuplicate(record, keptRecord) {
  record.auto_exclude = "true";
  record.exclude_reason = "duplicate_logo";
  record.notes = `${record.notes || ""}; duplicate_of=${keptRecord.corpus_id}`;
}

async function applyCanonicalDedupe(records) {
  const candidates = records
    .filter((row) => row.preview_file && row.auto_exclude !== "true" && row.is_wordmark !== "true")
    .sort((left, right) => dedupePriority(right) - dedupePriority(left));
  const keepers = new Map();
  let duplicateCount = 0;
  for (const record of candidates) {
    const key = canonicalLogoKey(record);
    if (!key) continue;
    const keptRecord = keepers.get(key);
    if (keptRecord && !isProtectedSvglogo(record)) {
      markDuplicate(record, keptRecord);
      duplicateCount += 1;
      continue;
    }
    if (!keptRecord) keepers.set(key, record);
  }
  return duplicateCount;
}

async function applyVisualDedupe(records) {
  const candidates = records
    .filter((row) => row.webp_file && row.auto_exclude !== "true" && row.is_wordmark !== "true")
    .sort((left, right) => dedupePriority(right) - dedupePriority(left));
  const keepers = [];
  let duplicateCount = 0;
  for (const record of candidates) {
    const imageFile = path.join(root, record.preview_file);
    const hash = await visualHash(imageFile);
    if (!hash) continue;
    const duplicate = keepers.find((keeper) => hammingDistance(hash, keeper.hash) <= 4);
    if (duplicate && !isProtectedSvglogo(record)) {
      markDuplicate(record, duplicate.record);
      duplicateCount += 1;
      continue;
    }
    keepers.push({ hash, record });
  }
  return duplicateCount;
}

function webpPath(sourceType, id) {
  return path.join(root, "assets", "_candidates", "all-logo-corpus", sourceType, `${id}.webp`);
}

async function convertFile(input, output) {
  ensureDir(path.dirname(output));
  const size = 512;
  const contentSize = Math.round(size * 0.76);
  const resized = await sharp(input, { animated: false, density: 192, limitInputPixels: false })
    .rotate()
    .resize({ width: contentSize, height: contentSize, fit: "inside", withoutEnlargement: false })
    .webp({ quality: 82, effort: 6 })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const left = Math.max(0, Math.floor((size - meta.width) / 2));
  const top = Math.max(0, Math.floor((size - meta.height) / 2));
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: resized, left, top }])
    .webp({ quality: 82, effort: 6 })
    .toFile(output);
  return sharp(output).metadata();
}

function makeRecord(source, row, index, status, meta, error) {
  const id = `${source.type}_${slug(row.rel || row.title)}_${index}`;
  const output = webpPath(source.type, id);
  const rawRel = path.relative(root, row.file).replace(/\\/g, "/");
  const webpRel = status === "converted" ? path.relative(root, output).replace(/\\/g, "/") : "";
  const record = {
    corpus_id: id,
    title: row.title,
    source_type: source.type,
    source_name: source.name,
    source_url: source.repo,
    license: source.license,
    license_url: "",
    raw_file: rawRel,
    webp_file: webpRel,
    preview_file: webpRel || rawRel,
    original_format: formatFrom(row.file),
    width: meta?.width || "",
    height: meta?.height || "",
    file_size_bytes: status === "converted" ? fileSize(output) : 0,
    is_wordmark: row.isWordmark || "unknown",
    has_visible_text: "unknown",
    auto_exclude: "false",
    exclude_reason: "",
    review_status: "pending",
    notes: error ? `${row.notes}; ${error}` : row.notes
  };
  if (source.type === "svglogo" && row.legacySvglogoId) {
    record.legacy_svglogo_id = row.legacySvglogoId;
  }
  const reason = autoExcludeReason(record);
  if (reason) {
    record.auto_exclude = "true";
    record.exclude_reason = reason;
  }
  return record;
}

function makeCollectedRecord(row) {
  const record = {
    corpus_id: `collected_${row.candidate_id}`,
    title: row.name_en || row.name_zh || row.candidate_id,
    source_type: row.source_type,
    source_name: row.source_name,
    source_url: row.source_url,
    license: row.license,
    license_url: row.license_url,
    raw_file: row.raw_file,
    webp_file: row.webp_file,
    preview_file: row.webp_file || row.raw_file,
    original_format: row.original_format,
    width: row.width,
    height: row.height,
    file_size_bytes: row.file_size_bytes,
    is_wordmark: row.is_wordmark,
    has_visible_text: row.has_visible_text,
    auto_exclude: "false",
    exclude_reason: "",
    review_status: row.review_status,
    notes: `${row.brand_id || ""}; ${row.notes || ""}`
  };
  const reason = autoExcludeReason(record);
  if (reason) {
    record.auto_exclude = "true";
    record.exclude_reason = reason;
  }
  return record;
}

async function mapLimit(items, limit, fn) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const current = next++;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function generatePreview(rows, report) {
  const compact = rows.filter((row) => row.preview_file).map((row) => ({
    id: row.corpus_id,
    title: row.title,
    source: row.source_type,
    preview: row.preview_file,
    webp: row.webp_file,
    raw: row.raw_file,
    license: row.license,
    legacySvglogoId: row.legacy_svglogo_id || "",
    autoExclude: row.auto_exclude === "true",
    excludeReason: row.exclude_reason || "",
    wordmark: row.is_wordmark,
    text: row.has_visible_text,
    status: row.review_status,
    notes: row.notes
  }));
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>All Logo Corpus</title>
  <style>
    body{margin:0;background:#eef0f3;color:#20242a;font-family:"Segoe UI",system-ui,sans-serif}
    header{position:sticky;top:0;z-index:2;background:rgba(238,240,243,.96);border-bottom:1px solid #d9dee5;padding:16px 22px}
    h1{font-size:22px;margin:0 0 12px}.bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:9px}.stat,.control{background:#fff;border:1px solid #d9dee5;border-radius:8px;padding:9px 10px}.stat b{display:block;font-size:19px}
    label,.stat span,dt{font-size:12px;color:#68717d}select,input,button{width:100%;min-height:34px;border:1px solid #d9dee5;border-radius:6px;background:#fff;font:inherit;font-size:13px;padding:0 8px}
    main{padding:18px 22px 42px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.card{background:#fff;border:1px solid #d9dee5;border-radius:8px;padding:10px}.card.mark-wordmark{border-color:#f59e0b;background:#fffbeb}.image{aspect-ratio:1;border:1px solid #d9dee5;border-radius:6px;display:grid;place-items:center;overflow:hidden;margin-bottom:8px}img{max-width:86%;max-height:86%;object-fit:contain}.chips{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px}.chip{font-size:11px;border-radius:999px;background:#eef2ff;color:#3730a3;padding:3px 7px}.warn{background:#fef3c7;color:#92400e}.actions{margin-top:8px}h3{font-size:14px;margin:0 0 7px;overflow-wrap:anywhere}dl{display:grid;gap:5px;margin:0}dd{margin:0;font-size:12px;overflow-wrap:anywhere}.pager{display:flex;gap:8px;align-items:center;margin:0 0 14px}.pager button{width:auto}.empty{color:#68717d}
  </style>
</head>
<body>
  <header>
    <h1>All Logo Corpus</h1>
    <div class="bar">
      <div class="stat"><b>${rows.filter((row) => row.preview_file).length}</b><span>可审核资源</span></div>
      <div class="stat"><b>${report.total_input}</b><span>扫描资源</span></div>
      <div class="stat"><b>${report.failed_count}</b><span>转换失败</span></div>
      <div class="control"><label>来源</label><select id="source"><option value="">全部来源</option>${Object.keys(report.by_source).sort().map((s) => `<option value="${htmlEscape(s)}">${htmlEscape(s)} (${report.by_source[s].converted})</option>`).join("")}</select></div>
      <div class="control"><label>标注状态</label><select id="mark"><option value="usable">可作为题目</option><option value="excluded">自动排除</option><option value="wordmark">WORDMARK</option><option value="">全部</option></select></div>
      <div class="control"><label>搜索</label><input id="search" type="search" placeholder="title / file / source"></div>
      <div class="control"><label>导入</label><button id="importBtn">导入旧 marks JSON</button><input id="importFile" type="file" accept="application/json" hidden></div>
      <div class="control"><label>导出</label><button id="export">导出 WORDMARK JSON</button></div>
      <div class="control"><label>出题清单</label><button id="exportUsable">导出可作为题目 JSON</button></div>
    </div>
  </header>
  <main>
    <div class="pager"><button id="prev">上一页</button><span id="pageInfo"></span><button id="next">下一页</button></div>
    <div id="grid" class="grid"></div>
  </main>
  <script id="data" type="application/json">${JSON.stringify(compact).replace(/</g, "\\u003c")}</script>
  <script>
    const DATA = JSON.parse(document.getElementById('data').textContent);
    const KEY = 'allLogoCorpusWordmarks:v1';
    const OLD_KEY = 'allLogoCorpusMarks:v1';
    const OLD_SVGLOGO_KEY = 'svglogoPreviewManualWordmark:v1';
    let marks = JSON.parse(localStorage.getItem(KEY) || '{}');
    let page = 1;
    const pageSize = 120;
    const grid = document.getElementById('grid');
    const source = document.getElementById('source');
    const mark = document.getElementById('mark');
    const search = document.getElementById('search');
    const pageInfo = document.getElementById('pageInfo');
    function save(){ localStorage.setItem(KEY, JSON.stringify(marks)); }
    function migrateOldMarks(){
      let changed = false;
      try {
        const old = JSON.parse(localStorage.getItem(OLD_KEY) || '{}');
        for (const [id, value] of Object.entries(old)) {
          if (value && value.wordmark === true && !marks[id]) {
            marks[id] = { wordmark: true, migrated_from: OLD_KEY, updated_at: value.updated_at || new Date().toISOString() };
            changed = true;
          }
        }
      } catch {}
      try {
        const oldSvg = JSON.parse(localStorage.getItem(OLD_SVGLOGO_KEY) || '{}');
        const legacyMap = new Map(DATA.filter(x => x.legacySvglogoId).map(x => [x.legacySvglogoId, x.id]));
        for (const [svglogoId, value] of Object.entries(oldSvg)) {
          const id = legacyMap.get(svglogoId);
          if (id && value && value.wordmark === true && !marks[id]) {
            marks[id] = { wordmark: true, migrated_from: OLD_SVGLOGO_KEY, updated_at: value.updated_at || new Date().toISOString() };
            changed = true;
          }
        }
      } catch {}
      if (changed) save();
    }
    function importMarksPayload(payload){
      let changed = false;
      const legacyMap = new Map(DATA.filter(x => x.legacySvglogoId).map(x => [x.legacySvglogoId, x.id]));
      const apply = (id, value, source) => {
        if (!id || !(value === true || value?.wordmark === true || value?.manual_wordmark === true)) return;
        if (!marks[id]) {
          marks[id] = { wordmark: true, migrated_from: source, updated_at: value.updated_at || new Date().toISOString() };
          changed = true;
        }
      };
      if (Array.isArray(payload.wordmark_ids)) payload.wordmark_ids.forEach(id => apply(id, true, 'import_wordmark_ids'));
      if (payload.marks && typeof payload.marks === 'object') {
        for (const [id, value] of Object.entries(payload.marks)) apply(id, value, 'import_marks');
      }
      const rows = Array.isArray(payload.manual_wordmark) ? payload.manual_wordmark : Array.isArray(payload) ? payload : [];
      for (const row of rows) {
        const id = row.svglogo_id ? legacyMap.get(row.svglogo_id) : row.corpus_id || row.id;
        apply(id, row, 'import_manual_wordmark');
      }
      if (changed) {
        save();
        render();
      }
      return changed;
    }
    migrateOldMarks();
    function filtered(){
      const q = search.value.trim().toLowerCase();
      return DATA.filter(x => {
        const m = marks[x.id] || {};
        const autoWordmark = x.wordmark === 'true';
        const isWordmark = autoWordmark || m.wordmark;
        const isExcluded = x.autoExclude || isWordmark;
        return (!source.value || x.source === source.value) &&
          (!q || (x.title + ' ' + x.raw + ' ' + x.id + ' ' + x.source).toLowerCase().includes(q)) &&
          (!mark.value ||
            (mark.value === 'wordmark' && isWordmark) ||
            (mark.value === 'excluded' && isExcluded) ||
            (mark.value === 'usable' && !isExcluded));
      });
    }
    function render(){
      const rows = filtered();
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      if (page > pages) page = pages;
      const slice = rows.slice((page - 1) * pageSize, page * pageSize);
      pageInfo.textContent = page + ' / ' + pages + ' · ' + rows.length + ' items';
      grid.innerHTML = slice.map(x => {
        const m = marks[x.id] || {};
        const autoWordmark = x.wordmark === 'true';
        const isWordmark = autoWordmark || m.wordmark;
        const isExcluded = x.autoExclude || isWordmark;
        return '<article class="card ' + (isExcluded ? 'mark-wordmark ' : '') + '" data-id="' + x.id + '">' +
          '<div class="image"><img src="../' + x.preview + '" loading="lazy"></div>' +
          '<div class="chips"><span class="chip">' + x.source + '</span>' + (isWordmark ? '<span class="chip warn">' + (autoWordmark ? 'AUTO WORDMARK' : 'WORDMARK') + '</span>' : '') + (x.autoExclude && !isWordmark ? '<span class="chip warn">AUTO EXCLUDE</span>' : '') + '</div>' +
          '<h3>' + escapeHtml(x.title || x.id) + '</h3><dl><div><dt>raw</dt><dd>' + escapeHtml(x.raw) + '</dd></div><div><dt>license</dt><dd>' + escapeHtml(x.license || '') + '</dd></div><div><dt>id</dt><dd>' + escapeHtml(x.id) + '</dd></div></dl>' +
          '<div class="actions">' + (x.autoExclude ? '<button disabled>' + escapeHtml(x.excludeReason || '已自动排除') + '</button>' : autoWordmark ? '<button disabled>已自动 WORDMARK</button>' : '<button data-a="wordmark">' + (m.wordmark ? '取消 WORDMARK' : 'WORDMARK') + '</button>') + '</div></article>';
      }).join('') || '<p class="empty">No logos</p>';
    }
    function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
    grid.addEventListener('click', e => {
      const btn = e.target.closest('button[data-a]');
      if (!btn) return;
      const card = e.target.closest('.card');
      const id = card.dataset.id;
      const item = DATA.find(x => x.id === id);
      if (item && item.wordmark === 'true') return;
      if (marks[id]?.wordmark) delete marks[id];
      else marks[id] = { wordmark: true, updated_at: new Date().toISOString() };
      save(); render();
    });
    for (const el of [source, mark, search]) el.addEventListener('input', () => { page = 1; render(); });
    document.getElementById('prev').onclick = () => { page = Math.max(1, page - 1); render(); };
    document.getElementById('next').onclick = () => { page += 1; render(); };
    document.getElementById('export').onclick = () => {
      const manual_wordmark_ids = Object.entries(marks).filter(([, v]) => v && v.wordmark === true).map(([id]) => id);
      const auto_wordmark_ids = DATA.filter(x => x.wordmark === 'true').map(x => x.id);
      const wordmark_ids = [...new Set([...auto_wordmark_ids, ...manual_wordmark_ids])];
      const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), wordmark_ids, auto_wordmark_ids, manual_wordmark_ids, marks }, null, 2)], { type:'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'all-logo-corpus-marks.json'; a.click(); URL.revokeObjectURL(a.href);
    };
    document.getElementById('exportUsable').onclick = () => {
      const usable = DATA.filter(x => {
        const m = marks[x.id] || {};
        const isWordmark = x.wordmark === 'true' || m.wordmark;
        return !x.autoExclude && !isWordmark;
      });
      const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), source: 'review/all-logo-corpus-preview.html', usable_ids: usable.map(x => x.id), usable }, null, 2)], { type:'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'all-logo-corpus-usable.json'; a.click(); URL.revokeObjectURL(a.href);
    };
    document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
    document.getElementById('importFile').onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        const changed = importMarksPayload(payload);
        alert(changed ? '已导入 WORDMARK 标记' : '没有发现可导入的新标记');
      } catch (err) {
        alert('导入失败: ' + err.message);
      }
      e.target.value = '';
    };
    render();
  </script>
</body>
</html>`;
  ensureDir(path.join(root, "review"));
  fs.writeFileSync(path.join(root, "review", "all-logo-corpus-preview.html"), html, "utf8");
}

async function main() {
  const inputs = [];
  for (const source of sources) {
    const rows = typeof source.rows === "function" ? source.rows(source) : [];
    rows.forEach((row, index) => inputs.push({ source, row, index }));
  }
  const shouldConvert = String(process.env.ALL_LOGO_CORPUS_CONVERT || "false").toLowerCase() === "true";
  const bySource = {};
  const records = await mapLimit(inputs, 6, async ({ source, row, index }) => {
    const id = `${source.type}_${slug(row.rel || row.title)}_${index}`;
    const output = webpPath(source.type, id);
    bySource[source.type] = bySource[source.type] || { input: 0, converted: 0, failed: 0 };
    bySource[source.type].input += 1;
    if (fs.existsSync(output) && fileSize(output) > 0) {
      bySource[source.type].converted += 1;
      const meta = await sharp(output).metadata().catch(() => ({}));
      const record = makeRecord(source, row, index, "converted", meta, "");
      if (record.auto_exclude !== "true" && !isProtectedSvglogo(record)) {
        const boundsRatio = await contentBoundsRatio(output);
        if (boundsRatio >= 2.15) {
          record.auto_exclude = "true";
          record.exclude_reason = "wide_horizontal_logo_with_text";
          record.notes = `${record.notes}; content_bounds_ratio=${boundsRatio.toFixed(2)}`;
        }
      }
      return record;
    }
    if (!shouldConvert) {
      bySource[source.type].raw_preview = (bySource[source.type].raw_preview || 0) + 1;
      return makeRecord(source, row, index, "raw_preview", null, "");
    }
    try {
      const meta = await convertFile(row.file, output);
      bySource[source.type].converted += 1;
      const record = makeRecord(source, row, index, "converted", meta, "");
      if (record.auto_exclude !== "true" && !isProtectedSvglogo(record)) {
        const boundsRatio = await contentBoundsRatio(output);
        if (boundsRatio >= 2.15) {
          record.auto_exclude = "true";
          record.exclude_reason = "wide_horizontal_logo_with_text";
          record.notes = `${record.notes}; content_bounds_ratio=${boundsRatio.toFixed(2)}`;
        }
      }
      return record;
    } catch (err) {
      bySource[source.type].failed += 1;
      return makeRecord(source, row, index, "failed", null, err.message);
    }
  });
  for (const sourceType of ["website-icons", "wikimedia", "expanded-wikimedia", "expanded-website-icons"]) {
    const collected = readSourceCandidates(sourceType).map(makeCollectedRecord);
    records.push(...collected);
    bySource[sourceType] = bySource[sourceType] || { input: 0, converted: 0, failed: 0, raw_preview: 0 };
    bySource[sourceType].input += collected.length;
    bySource[sourceType].converted += collected.filter((row) => row.webp_file).length;
    bySource[sourceType].raw_preview += collected.filter((row) => !row.webp_file && row.preview_file).length;
  }
  const canonicalDuplicateCount = await applyCanonicalDedupe(records);
  const visualDuplicateCount = await applyVisualDedupe(records);
  const report = {
    generated_at: new Date().toISOString(),
    conversion_mode: shouldConvert ? "convert_all_missing" : "raw_preview_index",
    local_repo_input: inputs.length,
    total_input: records.length,
    converted_count: records.filter((row) => row.webp_file).length,
    raw_preview_count: records.filter((row) => !row.webp_file && row.preview_file).length,
    failed_count: records.filter((row) => !row.preview_file).length,
    duplicate_count: canonicalDuplicateCount + visualDuplicateCount,
    canonical_duplicate_count: canonicalDuplicateCount,
    visual_duplicate_count: visualDuplicateCount,
    by_source: bySource
  };
  writeJson(path.join(root, "data", "all_logo_candidates_index.json"), records);
  writeCsv(path.join(root, "data", "all_logo_candidates_index.csv"), records, columns);
  const playable = records.filter((row) => row.preview_file && row.auto_exclude !== "true" && row.is_wordmark !== "true");
  writeJson(path.join(root, "data", "playable_logo_candidates_index.json"), playable);
  writeCsv(path.join(root, "data", "playable_logo_candidates_index.csv"), playable, columns);
  writeJson(path.join(root, "reports", "all-logo-corpus-report.json"), report);
  generatePreview(records, report);
  console.log(`all logo corpus ${records.filter((row) => row.preview_file).length}/${report.total_input}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

