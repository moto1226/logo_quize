const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const dotenv = require("dotenv");

const root = path.resolve(__dirname, "..");
const repoDir = path.join(root, "vendor", "SVGLOGO");
const libraryDir = path.join(repoDir, "static", "library");
const indexJson = path.join(root, "data", "raw", "svglogo", "svglogo_index.json");
const indexCsv = path.join(root, "data", "raw", "svglogo", "svglogo_index.csv");
const seedFile = path.join(root, "data", "brands_seed.csv");
const matchesCsv = path.join(root, "data", "svglogo_seed_matches.csv");

const categoryMap = {
  aigc: "AIGC",
  airline: "航空公司",
  automotive: "汽车交通",
  company: "企业品牌",
  consumerBrands: "消费品牌",
  cosmetic: "美妆个护",
  goldJewelry: "黄金珠宝",
  other: "其他",
  pay: "金融支付",
  school: "学校",
  social: "社交媒体",
  tools: "工具软件",
  weather: "天气"
};

const excludedSvglogoCategories = new Set(["other", "weather"]);

function isProcessableSvglogo(rowOrCategory) {
  const category = typeof rowOrCategory === "string" ? rowOrCategory : rowOrCategory?.category_raw;
  return !excludedSvglogoCategories.has(category);
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readCsv(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  return parse(raw, { bom: true, columns: true, skip_empty_lines: true, trim: true });
}

function writeCsv(file, rows, columns) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, stringify(rows, { header: true, columns }), "utf8");
}

function loadConfig() {
  dotenv.config({ path: path.join(root, ".env") });
  return {
    logoSize: Number.parseInt(process.env.LOGO_SIZE || "512", 10),
    webpQuality: Number.parseInt(process.env.LOGO_WEBP_QUALITY || "82", 10),
    assetBudgetMb: Number.parseFloat(process.env.ASSET_BUDGET_MB || "20")
  };
}

function getCommitHash() {
  if (!fs.existsSync(repoDir)) return "";
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
}

function fileSize(file) {
  return fs.existsSync(file) ? fs.statSync(file).size : 0;
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) total += dirSize(full);
    else total += fileSize(full);
  }
  return total;
}

function listFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...listFiles(full, predicate));
    else if (!predicate || predicate(full)) out.push(full);
  }
  return out;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s_\-.'’]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function normalizeDomain(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const url = input.startsWith("http") ? new URL(input) : new URL(`https://${input}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return input.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const indexColumns = [
  "svglogo_id",
  "title",
  "category",
  "category_raw",
  "file_name",
  "file_rel_path",
  "file_abs_path",
  "url",
  "variant",
  "is_wordmark",
  "source_type",
  "source_repo",
  "source_commit",
  "exists",
  "notes"
];

module.exports = {
  root,
  repoDir,
  libraryDir,
  indexJson,
  indexCsv,
  seedFile,
  matchesCsv,
  categoryMap,
  excludedSvglogoCategories,
  isProcessableSvglogo,
  indexColumns,
  rel,
  ensureDir,
  writeJson,
  readJson,
  readCsv,
  writeCsv,
  loadConfig,
  getCommitHash,
  fileSize,
  dirSize,
  listFiles,
  normalizeName,
  normalizeDomain,
  htmlEscape
};
