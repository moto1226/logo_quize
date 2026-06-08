const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const sharp = require("sharp");
const {
  root,
  seedFile,
  matchesCsv,
  indexJson: svglogoIndexJson,
  readCsv,
  readJson,
  writeCsv,
  writeJson,
  ensureDir,
  normalizeName,
  normalizeDomain,
  htmlEscape,
  fileSize,
  listFiles,
  loadConfig
} = require("./svglogo-common");

const candidateColumns = [
  "candidate_id",
  "brand_id",
  "name_en",
  "name_zh",
  "domain",
  "similar_group",
  "industry",
  "source_type",
  "source_name",
  "source_url",
  "license",
  "license_url",
  "raw_file",
  "webp_file",
  "original_format",
  "width",
  "height",
  "file_size_bytes",
  "is_wordmark",
  "has_visible_text",
  "quality_score",
  "match_confidence",
  "review_status",
  "notes"
];

function candidateJsonFile(sourceType) {
  return path.join(root, "data", "raw", "logo-candidates", `${sourceType}.json`);
}

function readSourceCandidates(sourceType) {
  const file = candidateJsonFile(sourceType);
  return fs.existsSync(file) ? readJson(file) : [];
}

function writeSourceCandidates(sourceType, rows) {
  writeJson(candidateJsonFile(sourceType), rows);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "item";
}

function candidateId(sourceType, brandId, suffix) {
  return `${sourceType}_${brandId}_${slug(suffix)}`;
}

function seedRows() {
  return readCsv(seedFile).filter((row) => (row.include_mvp || "").toLowerCase() === "true");
}

function seedByBrandId() {
  return new Map(seedRows().map((row) => [row.brand_id, row]));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAbsUrl(base, value) {
  if (!value) return "";
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
}

function extFromUrlOrType(url, contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("svg")) return "svg";
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("x-icon") || type.includes("icon")) return "ico";
  const ext = path.extname(String(url || "").split("?")[0]).replace(".", "").toLowerCase();
  return ext || "bin";
}

async function fetchBuffer(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 logo-candidates-harvester/1.0",
      accept: options.accept || "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*,*/*;q=0.8"
    },
    signal: AbortSignal.timeout(options.timeoutMs || 25000)
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    buffer
  };
}

async function convertBufferToWebp(buffer, outputFile, options = {}) {
  const config = loadConfig();
  const size = options.size || config.logoSize || 512;
  const contentSize = Math.round(size * (options.fillRatio || 0.76));
  ensureDir(path.dirname(outputFile));
  const resized = await sharp(buffer, { animated: false, density: 192, limitInputPixels: false })
    .rotate()
    .resize({ width: contentSize, height: contentSize, fit: "inside", withoutEnlargement: false })
    .webp({ quality: config.webpQuality || 82, effort: 6 })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const left = Math.max(0, Math.floor((size - meta.width) / 2));
  const top = Math.max(0, Math.floor((size - meta.height) / 2));
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: resized, left, top }])
    .webp({ quality: config.webpQuality || 82, effort: 6 })
    .toFile(outputFile);
  return sharp(outputFile).metadata();
}

async function saveCandidateAsset({ sourceType, brand, sourceUrl, sourceName, license = "unknown", licenseUrl = "", rawBuffer, originalFormat, suffix, qualityScore = 50, matchConfidence = "medium", isWordmark = "unknown", notes = "" }) {
  const id = candidateId(sourceType, brand.brand_id, suffix);
  const rawFile = path.join(root, "assets", "_raw", sourceType, brand.brand_id, `${id}.${originalFormat || "bin"}`);
  const webpFile = path.join(root, "assets", "_candidates", sourceType, brand.brand_id, `${id}.webp`);
  ensureDir(path.dirname(rawFile));
  fs.writeFileSync(rawFile, rawBuffer);
  const meta = await convertBufferToWebp(rawBuffer, webpFile);
  return {
    candidate_id: id,
    brand_id: brand.brand_id,
    name_en: brand.name_en,
    name_zh: brand.name_zh,
    domain: brand.domain,
    similar_group: brand.similar_group,
    industry: brand.industry,
    source_type: sourceType,
    source_name: sourceName,
    source_url: sourceUrl,
    license,
    license_url: licenseUrl,
    raw_file: path.relative(root, rawFile).replace(/\\/g, "/"),
    webp_file: path.relative(root, webpFile).replace(/\\/g, "/"),
    original_format: originalFormat,
    width: meta.width || "",
    height: meta.height || "",
    file_size_bytes: fileSize(webpFile),
    is_wordmark: String(isWordmark),
    has_visible_text: "unknown",
    quality_score: qualityScore,
    match_confidence: matchConfidence,
    review_status: "pending",
    notes
  };
}

function cloneOrPull(repoUrl, targetDir) {
  ensureDir(path.dirname(targetDir));
  if (!fs.existsSync(targetDir)) {
    execFileSync("git", ["clone", "--depth", "1", repoUrl, targetDir], { cwd: root, stdio: "pipe" });
    return "clone";
  }
  execFileSync("git", ["pull", "--ff-only"], { cwd: targetDir, stdio: "pipe" });
  return "pull";
}

function textMatchesBrand(fileOrTitle, brand) {
  const text = normalizeName(path.basename(fileOrTitle, path.extname(fileOrTitle)));
  const names = [brand.brand_id, brand.name_en, brand.name_zh].map(normalizeName).filter(Boolean);
  return names.some((name) => text === name || text.includes(name) || name.includes(text));
}

function svglogoCandidates() {
  if (!fs.existsSync(matchesCsv) || !fs.existsSync(svglogoIndexJson)) return [];
  const brands = seedByBrandId();
  const indexRows = new Map(readJson(svglogoIndexJson).map((row) => [row.svglogo_id, row]));
  return readCsv(matchesCsv).map((match) => {
    const brand = brands.get(match.brand_id) || {};
    const index = indexRows.get(match.svglogo_id) || {};
    return {
      candidate_id: candidateId("svglogo", match.brand_id, match.svglogo_id),
      brand_id: match.brand_id,
      name_en: brand.name_en || match.name_en,
      name_zh: brand.name_zh || match.name_zh,
      domain: brand.domain || match.domain,
      similar_group: brand.similar_group || match.similar_group,
      industry: brand.industry || "",
      source_type: "svglogo",
      source_name: "HeyHuazi/SVGLOGO",
      source_url: match.svglogo_url || "",
      license: "unknown",
      license_url: "",
      raw_file: index.file_rel_path ? `assets/_raw/svglogo/${index.file_rel_path}` : "",
      webp_file: match.svglogo_webp_file,
      original_format: "svg",
      width: "",
      height: "",
      file_size_bytes: fileSize(path.join(root, match.svglogo_webp_file)),
      is_wordmark: match.is_wordmark || "unknown",
      has_visible_text: "unknown",
      quality_score: match.recommended === "true" ? 90 : 60,
      match_confidence: match.confidence || "medium",
      review_status: "pending",
      notes: match.notes || ""
    };
  });
}

module.exports = {
  root,
  candidateColumns,
  candidateJsonFile,
  readSourceCandidates,
  writeSourceCandidates,
  seedRows,
  seedByBrandId,
  delay,
  toAbsUrl,
  extFromUrlOrType,
  fetchBuffer,
  saveCandidateAsset,
  cloneOrPull,
  textMatchesBrand,
  normalizeName,
  normalizeDomain,
  htmlEscape,
  writeCsv,
  writeJson,
  readCsv,
  readJson,
  ensureDir,
  listFiles,
  fileSize,
  slug,
  candidateId,
  svglogoCandidates
};
