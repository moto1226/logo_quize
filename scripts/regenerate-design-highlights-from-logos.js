const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const sharp = require("sharp");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");

const root = path.resolve(__dirname, "..");
const csvFile = path.join(root, "logo_industry_brand_collection_MAX_flat_with_design_v9.csv");
const logoDir = path.join(root, "dist", "logos", "v20260620r2");
const reportFile = path.join(root, "reports", "design-highlights-regeneration.json");

const colorLabels = {
  black: "黑色",
  gray: "灰色",
  red: "红色",
  orange: "橙色",
  yellow: "黄色",
  green: "绿色",
  cyan: "青色",
  blue: "蓝色",
  purple: "紫色",
  pink: "粉色",
  brown: "棕色"
};

const colorSemantics = {
  black: "强化克制、专业和高识别度",
  gray: "带来理性、稳定和中性的系统感",
  red: "制造强记忆点和直接的视觉冲击",
  orange: "增加活力、亲和和消费场景里的热度",
  yellow: "提高明度、乐观感和远距离可见度",
  green: "建立自然、健康、增长或服务友好的联想",
  cyan: "带出清爽、科技和数字服务感",
  blue: "传递可信、效率和技术秩序",
  purple: "强化创意、娱乐或高辨识的差异化",
  pink: "增加柔和、时尚或年轻化气质",
  brown: "带来材质、传统或生活方式联想"
};

const manualHighlights = {
  npm: "红白横向字标把 npm 的小写字母处理成连续块面，直角边框和粗笔画带出代码包、模块与命令行工具的秩序感；高对比色块比复杂图形更适合开发者工具列表、文档页和终端周边的小尺寸识别。",
  apple: "被咬一口的苹果用极简剪影建立记忆，圆润外轮廓让科技产品少一点机械距离、多一点亲近感；单色标志在金属机身、系统图标和包装上都能稳定复现，核心优势是轮廓一眼可辨。",
  nike: "Swoosh 用一笔上扬曲线压缩出速度、弹性和身体运动的方向感，几乎不依赖文字也能成立；单色剪影适合鞋面、服装、广告和赛事场景放大使用，识别效率非常高。",
  adidas: "三条斜向条纹把运动品牌的速度、节奏和装备感压缩成最小图形单元，结构简单但重复记忆强；黑白高对比让它在鞋服织物、吊牌和场馆广告上都能保持清晰。",
  microsoft: "四色方格把 Microsoft 的多产品生态转化成稳定的窗口结构，几何秩序比装饰性图形更重要；红、绿、蓝、黄的模块组合让系统、办公和云服务入口保持统一识别。",
  google: "Google 字标用多色字母建立开放、轻快和服务矩阵的品牌感，几何化字形让搜索入口显得友好而不沉重；颜色顺序本身就是记忆资产，适合在各种小尺寸界面中快速被认出。",
  steam: "机械连杆图形像游戏平台背后的连接系统，深色圆形底让它在游戏库、社区和启动器里有明确的工具入口感；图形符号比完整字标更适合小尺寸图标，能把 PC 游戏平台的技术气质保留下来。"
};

function readCommittedRows() {
  try {
    const content = execFileSync("git", ["show", `HEAD:${path.basename(csvFile)}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });
    return parse(content, { columns: true, bom: true });
  } catch (error) {
    return [];
  }
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r / 255) h = ((g - b) / 255 / delta) % 6;
    else if (max === g / 255) h = (b - r) / 255 / delta + 2;
    else h = (r - g) / 255 / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function colorBucket(r, g, b) {
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v < 0.18) return "black";
  if (s < 0.12) return v > 0.55 ? "gray" : "black";
  if (h < 12 || h >= 345) return "red";
  if (h < 38) return "orange";
  if (h < 62) return "yellow";
  if (h < 155) return "green";
  if (h < 190) return "cyan";
  if (h < 250) return "blue";
  if (h < 300) return "purple";
  if (h < 345) return "pink";
  return "gray";
}

function isNearWhite(r, g, b, alpha) {
  if (alpha !== undefined && alpha < 18) return true;
  return r > 242 && g > 242 && b > 242 && Math.max(r, g, b) - Math.min(r, g, b) < 12;
}

async function analyzeLogo(brandId) {
  const file = path.join(logoDir, `${brandId}.webp`);
  if (!fs.existsSync(file)) return null;
  const image = sharp(file).resize(160, 160, { fit: "inside", withoutEnlargement: true }).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const counts = new Map();
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  let inkPixels = 0;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const a = data[offset + 3];
      pixels += 1;
      if (isNearWhite(r, g, b, a)) continue;
      inkPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const bucket = colorBucket(r, g, b);
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    }
  }

  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxY - minY + 1);
  const colors = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, ratio: count / Math.max(1, inkPixels) }))
    .filter((item) => item.ratio > 0.04)
    .slice(0, 3);

  return {
    colors,
    aspect: width / height,
    density: inkPixels / pixels
  };
}

function displayName(row) {
  return row["英文名/常用名"] || row["品牌名称"] || row.brand_id;
}

function colorPhrase(analysis) {
  const colors = analysis && analysis.colors && analysis.colors.length ? analysis.colors : [{ name: "black", ratio: 1 }];
  const names = colors.map((item) => colorLabels[item.name] || "深色");
  if (names.length === 1) return `${names[0]}与留白`;
  if (names.length === 2) return `${names[0]}、${names[1]}与留白`;
  return `${names[0]}、${names[1]}、${names[2]}与留白`;
}

function formPhrase(row, analysis) {
  const name = displayName(row);
  const clean = String(name).replace(/[^A-Za-z0-9]/g, "");
  const shortName = clean.length > 0 && clean.length <= 5;
  const cue = row["Logo识别线索"] || "";
  if (analysis && analysis.aspect > 2.1) return shortName ? "横向字母标" : "横向字标";
  if (/徽章|盾|纹章/.test(cue)) return "徽章式图形";
  if (/App|图标/.test(cue) && analysis && analysis.aspect < 1.35 && analysis.aspect > 0.75) return "紧凑图标";
  if (row["Logo类型"] && row["Logo类型"].includes("symbol")) return "图形符号";
  return shortName ? "字母化标志" : "组合标志";
}

function structurePhrase(analysis) {
  if (!analysis) return "整体以清晰轮廓和留白关系建立识别";
  if (analysis.aspect > 2.1) return "横向比例适合在导航、包装、列表和页面标题中快速阅读";
  if (analysis.aspect < 0.75) return "竖向结构让标志在紧凑入口里更容易形成独立记忆";
  if (analysis.density > 0.28) return "较高的图形密度让标志在小尺寸下依靠整体块面而不是细节识别";
  return "紧凑比例让标志在应用入口、卡片和移动端小尺寸中保持稳定";
}

function scenarioPhrase(row) {
  const industry = row["一级行业"] || "";
  const category = row["小分类名称"] || "";
  const text = `${industry} ${category}`;
  if (/开发者|软件|云|AI|数字|搜索|浏览器|工具/.test(text)) return "界面入口、文档页和工具列表";
  if (/美妆|个护|奢侈|时尚|珠宝|服饰|运动|户外/.test(text)) return "吊牌、包装、门店和社交传播";
  if (/汽车|交通|航空|物流|能源|工业|硬件/.test(text)) return "车身、设备、工牌和服务触点";
  if (/餐饮|食品|饮料|零售|电商/.test(text)) return "包装、货架、门店招牌和移动端入口";
  if (/金融|保险|银行|证券/.test(text)) return "App、卡面、网点和交易界面";
  if (/教育|大学|机构|政府|公益/.test(text)) return "证书、官网、导视和正式文件";
  if (/媒体|影视|音乐|游戏|娱乐|内容/.test(text)) return "封面、播放页、频道入口和活动物料";
  return "应用入口、品牌卡片和移动端列表";
}

function tonePhrase(row, analysis) {
  const text = `${row["一级行业"] || ""} ${row["小分类名称"] || ""}`;
  const dominant = analysis && analysis.colors && analysis.colors[0] ? analysis.colors[0].name : "black";
  const colorMeaning = colorSemantics[dominant] || "建立稳定的第一眼识别";
  if (/奢侈|时尚|美妆|珠宝/.test(text)) return `色彩和留白更偏克制，${colorMeaning}`;
  if (/开发者|软件|云|AI|硬件|工业/.test(text)) return `理性结构能对应工具属性，${colorMeaning}`;
  if (/运动|户外|汽车|交通/.test(text)) return `高对比轮廓有利于远距离识别，${colorMeaning}`;
  if (/食品|餐饮|零售|电商/.test(text)) return `明快识别能适配高频消费触点，${colorMeaning}`;
  return `视觉重点放在清晰和可复用上，${colorMeaning}`;
}

function generateHighlight(row, analysis) {
  const id = row.brand_id;
  if (manualHighlights[id]) return manualHighlights[id];
  const name = displayName(row);
  const colors = colorPhrase(analysis);
  const form = formPhrase(row, analysis);
  const structure = structurePhrase(analysis);
  const tone = tonePhrase(row, analysis);
  const scenario = scenarioPhrase(row);
  return `${name} 的标志主要依靠${colors}形成${form}，不再套用与图面无关的装饰线索，${structure}；${tone}，适合在${scenario}中保持可读和可记忆。`;
}

function mentionedColorBuckets(text) {
  const result = new Set();
  if (/黑|黑白/.test(text)) result.add("black");
  if (/灰|银/.test(text)) result.add("gray");
  if (/红/.test(text)) result.add("red");
  if (/橙/.test(text)) result.add("orange");
  if (/黄|金色/.test(text)) result.add("yellow");
  if (/绿/.test(text)) result.add("green");
  if (/青/.test(text)) result.add("cyan");
  if (/蓝/.test(text)) result.add("blue");
  if (/紫/.test(text)) result.add("purple");
  if (/粉/.test(text)) result.add("pink");
  if (/棕|褐/.test(text)) result.add("brown");
  return result;
}

function shouldRegenerate(existing, analysis) {
  if (!existing || !existing.trim()) return true;
  const genericPatterns = [
    /没有必要依赖复杂装饰/,
    /蓝绿科技色/,
    /绿色负责/,
    /几何符号、字母缩写/,
    /字母花押、动物轮廓、条纹、盾牌/,
    /圆角图标、柔和配色/,
    /更依赖.*建立记忆/
  ];
  if (genericPatterns.some((pattern) => pattern.test(existing))) return true;

  const actualColors = new Set((analysis && analysis.colors ? analysis.colors : []).map((item) => item.name));
  const mentionedColors = mentionedColorBuckets(existing);
  const meaningfulMentions = Array.from(mentionedColors).filter((name) => name !== "gray");
  if (meaningfulMentions.length && actualColors.size) {
    const mismatch = meaningfulMentions.every((name) => !actualColors.has(name));
    if (mismatch) return true;
  }
  return false;
}

async function main() {
  const rows = parse(fs.readFileSync(csvFile, "utf8"), { columns: true, bom: true });
  const committedRows = readCommittedRows();
  const committedById = new Map(committedRows.map((row) => [row.brand_id, row]));
  const headers = Object.keys(rows[0]);
  const samples = [];
  let changed = 0;
  let regenerated = 0;
  let preserved = 0;
  let missingLogo = 0;

  for (const row of rows) {
    const committed = committedById.get(row.brand_id);
    const before = committed ? (committed["设计亮点"] || "") : (row["设计亮点"] || "");
    const analysis = await analyzeLogo(row.brand_id);
    if (!analysis) missingLogo += 1;
    const generated = generateHighlight(row, analysis);
    const next = manualHighlights[row.brand_id] || (shouldRegenerate(before, analysis) ? generated : before);
    row["设计亮点"] = next;
    if (before !== next) changed += 1;
    if (before !== next) regenerated += 1;
    else preserved += 1;
    if (["npm", "loewe", "chanel_beauty", "arcteryx", "steam"].includes(row.brand_id)) {
      samples.push({
        brand_id: row.brand_id,
        name: displayName(row),
        before,
        after: next,
        analysis
      });
    }
  }

  const output = stringify(rows, { header: true, columns: headers });
  fs.writeFileSync(csvFile, output, "utf8");
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify({
    rows: rows.length,
    changed,
    regenerated,
    preserved,
    missing_logo: missingLogo,
    samples
  }, null, 2), "utf8");
  console.log(`regenerated design highlights: ${changed}/${rows.length}, missing logos: ${missingLogo}`);
  console.log(`report: ${path.relative(root, reportFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
