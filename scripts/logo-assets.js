const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const dotenv = require("dotenv");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const seedFile = path.join(root, "data", "brands_seed.csv");
const candidatesFile = path.join(root, "data", "brands_candidates.csv");
const assetsFile = path.join(root, "data", "brands_assets.csv");

const seedColumns = [
  "brand_id",
  "name_en",
  "name_zh",
  "domain",
  "industry",
  "country_region",
  "fame_level",
  "similar_group",
  "has_pure_symbol",
  "symbol_review_status",
  "include_mvp",
  "preferred_source",
  "notes"
];

const candidateTypes = [
  ["symbol_light", "symbol", "light"],
  ["symbol_dark", "symbol", "dark"],
  ["icon_light", "icon", "light"],
  ["icon_dark", "icon", "dark"],
  ["logo_light", "logo", "light"],
  ["logo_dark", "logo", "dark"]
];

const selectionOrder = [
  "symbol_light",
  "symbol_dark",
  "icon_light",
  "icon_dark",
  "logo_light",
  "logo_dark"
];

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

function readCsv(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  return parse(raw, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

function writeCsv(file, rows, columns) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, stringify(rows, { header: true, columns }), "utf8");
}

function loadConfig({ requireClientId }) {
  dotenv.config({ path: path.join(root, ".env") });
  const clientId = (process.env.BRANDFETCH_CLIENT_ID || "").trim();
  if (requireClientId && !clientId) {
    throw new Error("BRANDFETCH_CLIENT_ID 缺失。请在项目根目录创建 .env，并参考 .env.example 配置。");
  }
  return {
    clientId,
    brandApiKey: (process.env.BRANDFETCH_API_KEY || "").trim(),
    enableBrandApi: (process.env.ENABLE_BRANDFETCH_BRAND_API || "false").trim().toLowerCase() === "true",
    outputFormat: (process.env.LOGO_OUTPUT_FORMAT || "webp").trim().toLowerCase(),
    logoSize: Number.parseInt(process.env.LOGO_SIZE || "512", 10),
    webpQuality: Number.parseInt(process.env.LOGO_WEBP_QUALITY || "82", 10),
    assetBudgetMb: Number.parseFloat(process.env.ASSET_BUDGET_MB || "20")
  };
}

function validateSeed({ stopOnError = true } = {}) {
  const rows = readCsv(seedFile);
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const groupCounts = {};

  for (const col of seedColumns) {
    if (!Object.prototype.hasOwnProperty.call(rows[0] || {}, col)) {
      errors.push(`CSV 缺少字段: ${col}`);
    }
  }

  rows.forEach((row, index) => {
    const rowNo = index + 2;
    const id = row.brand_id || "";
    if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(id)) {
      errors.push(`第 ${rowNo} 行 brand_id 非法: ${id}`);
    }
    if (seen.has(id)) {
      errors.push(`brand_id 重复: ${id}`);
    }
    seen.add(id);

    if (!row.similar_group) {
      errors.push(`第 ${rowNo} 行 similar_group 不能为空: ${id}`);
    } else {
      groupCounts[row.similar_group] = (groupCounts[row.similar_group] || 0) + 1;
    }

    if (!["true", "false", "unknown"].includes((row.has_pure_symbol || "").toLowerCase())) {
      errors.push(`第 ${rowNo} 行 has_pure_symbol 必须是 true/false/unknown: ${id}`);
    }
    if (!["true", "false"].includes((row.include_mvp || "").toLowerCase())) {
      errors.push(`第 ${rowNo} 行 include_mvp 必须是 true/false: ${id}`);
    }
  });

  for (const [group, count] of Object.entries(groupCounts)) {
    if (count < 4) {
      errors.push(`similar_group 至少需要 4 个品牌: ${group} 当前 ${count} 个`);
    }
  }

  const includeRows = rows.filter((row) => (row.include_mvp || "").toLowerCase() === "true");
  const report = {
    generated_at: new Date().toISOString(),
    valid: errors.length === 0,
    total_rows: rows.length,
    include_mvp_rows: includeRows.length,
    similar_group_counts: groupCounts,
    errors,
    warnings
  };
  writeJson(path.join(root, "reports", "seed-validation-report.json"), report);

  if (errors.length && stopOnError) {
    throw new Error(`seed 校验失败:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  }
  return { rows, includeRows, report };
}

function firstSearchDomain(results) {
  if (!Array.isArray(results)) return "";
  const hit = results.find((item) => item && typeof item.domain === "string" && item.domain.trim());
  return hit ? hit.domain.trim() : "";
}

async function fetchJson(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw_text: text.slice(0, 1000) };
    }
    return { status: response.status, ok: response.ok, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSearch() {
  const config = loadConfig({ requireClientId: true });
  const { includeRows } = validateSeed();
  const outputRows = [];

  for (const row of includeRows) {
    const query = encodeURIComponent(row.name_en);
    const url = `https://api.brandfetch.io/v2/search/${query}?c=${encodeURIComponent(config.clientId)}`;
    const rawPath = path.join(root, "data", "raw", "brandfetch-search", `${row.brand_id}.json`);
    let searchStatus = "error";
    let results = [];
    let status = 0;
    let error = "";

    try {
      const fetched = await fetchJson(url);
      status = fetched.status;
      if (fetched.ok && Array.isArray(fetched.body)) {
        searchStatus = "ok";
        results = fetched.body;
      } else {
        searchStatus = fetched.ok ? "unexpected_body" : "http_error";
      }
      writeJson(rawPath, {
        fetched_at: new Date().toISOString(),
        brand_id: row.brand_id,
        query: row.name_en,
        http_status: status,
        search_status: searchStatus,
        results: fetched.body
      });
    } catch (err) {
      error = err.message;
      writeJson(rawPath, {
        fetched_at: new Date().toISOString(),
        brand_id: row.brand_id,
        query: row.name_en,
        http_status: status,
        search_status: "error",
        error
      });
    }

    const searchTopDomain = firstSearchDomain(results);
    const originalDomain = row.domain || "";
    outputRows.push({
      ...row,
      resolved_domain: originalDomain || searchTopDomain,
      domain_source: originalDomain ? "seed" : searchTopDomain ? "brandfetch_search" : "missing",
      search_top_domain: searchTopDomain,
      domain_matches_existing: originalDomain && searchTopDomain ? String(originalDomain.toLowerCase() === searchTopDomain.toLowerCase()) : "",
      search_http_status: status || "",
      search_status: error ? "error" : searchStatus
    });
    console.log(`[search] ${row.brand_id} ${status || "error"} ${originalDomain || searchTopDomain || "no-domain"}`);
  }

  writeCsv(candidatesFile, outputRows, [
    ...seedColumns,
    "resolved_domain",
    "domain_source",
    "search_top_domain",
    "domain_matches_existing",
    "search_http_status",
    "search_status"
  ]);
  console.log(`写入 ${rel(candidatesFile)}`);
}

function candidateUrl(domain, type, theme, config) {
  const cleanDomain = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return `https://cdn.brandfetch.io/${cleanDomain}/w/${config.logoSize}/h/${config.logoSize}/theme/${theme}/fallback/404/type/${type}?c=${encodeURIComponent(config.clientId)}`;
}

function redactedCandidateUrl(domain, type, theme, config) {
  const cleanDomain = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return `https://cdn.brandfetch.io/${cleanDomain}/w/${config.logoSize}/h/${config.logoSize}/theme/${theme}/fallback/404/type/${type}?c=<BRANDFETCH_CLIENT_ID>`;
}

function extFrom(contentType, format) {
  const type = (contentType || "").toLowerCase();
  if (type.includes("svg")) return "svg";
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (format === "jpeg") return "jpg";
  return format || "bin";
}

async function fetchBuffer(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8,*/*;q=0.5",
        referer: "https://localhost/"
      }
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      location: response.headers.get("location") || "",
      buffer
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isImageResponse(contentType) {
  const type = (contentType || "").toLowerCase();
  return type.startsWith("image/") || type.includes("svg+xml") || type.includes("octet-stream");
}

async function convertToWebp(inputBuffer, outputFile, size, quality) {
  const resized = await sharp(inputBuffer, { animated: false })
    .rotate()
    .resize({
      width: size,
      height: size,
      fit: "inside",
      withoutEnlargement: true,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .webp({ quality })
    .toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  const left = Math.max(0, Math.floor((size - resizedMeta.width) / 2));
  const top = Math.max(0, Math.floor((size - resizedMeta.height) / 2));
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: resized, left, top }])
    .webp({ quality })
    .toFile(outputFile);
  return fs.statSync(outputFile).size;
}

function readCollectionRows() {
  if (fs.existsSync(candidatesFile)) {
    return readCsv(candidatesFile);
  }
  return validateSeed().includeRows.map((row) => ({
    ...row,
    resolved_domain: row.domain,
    domain_source: row.domain ? "seed" : "missing"
  }));
}

async function buildCandidates() {
  const config = loadConfig({ requireClientId: true });
  if (config.outputFormat !== "webp") {
    throw new Error("当前管线只支持 LOGO_OUTPUT_FORMAT=webp。");
  }
  const rows = readCollectionRows();
  const entries = [];

  for (const row of rows) {
    const domain = (row.resolved_domain || row.domain || "").trim();
    for (const [candidateName, type, theme] of candidateTypes) {
      const base = {
        brand_id: row.brand_id,
        candidate_name: candidateName,
        source_url: domain ? redactedCandidateUrl(domain, type, theme, config) : "",
        http_status: "",
        raw_file_size_bytes: 0,
        output_size_bytes: 0,
        original_width: null,
        original_height: null,
        output_width: null,
        output_height: null,
        raw_file_path: "",
        output_file_path: "",
        status: "missing_domain",
        error: ""
      };

      if (!domain) {
        entries.push(base);
        continue;
      }

      const url = candidateUrl(domain, type, theme, config);
      try {
        const fetched = await fetchBuffer(url);
        base.http_status = fetched.status;
        if (fetched.status >= 300 && fetched.status < 400) {
          base.status = fetched.location.includes("hotlinking") ? "hotlink_blocked" : "redirected";
          base.error = fetched.location ? `redirected to ${fetched.location.replace(/\?.*$/, "")}` : "redirected";
          entries.push(base);
          continue;
        }
        if (!fetched.ok || !fetched.buffer.length) {
          base.status = fetched.status === 404 ? "not_found" : "download_failed";
          entries.push(base);
          continue;
        }
        if (!isImageResponse(fetched.contentType)) {
          base.status = "not_image_response";
          base.error = `content-type ${fetched.contentType || "unknown"}`;
          entries.push(base);
          continue;
        }

        const metadata = await sharp(fetched.buffer, { animated: false }).metadata();
        base.original_width = metadata.width || null;
        base.original_height = metadata.height || null;
        const ext = extFrom(fetched.contentType, metadata.format);
        const rawFile = path.join(root, "assets", "_raw", "brandfetch", row.brand_id, `${candidateName}.${ext}`);
        const outputFile = path.join(root, "assets", "_candidates", row.brand_id, `${candidateName}.webp`);
        ensureDir(path.dirname(rawFile));
        ensureDir(path.dirname(outputFile));
        fs.writeFileSync(rawFile, fetched.buffer);
        base.raw_file_size_bytes = fetched.buffer.length;
        base.raw_file_path = rel(rawFile);
        base.output_size_bytes = await convertToWebp(fetched.buffer, outputFile, config.logoSize, config.webpQuality);
        base.output_width = config.logoSize;
        base.output_height = config.logoSize;
        base.output_file_path = rel(outputFile);
        base.status = "converted";
      } catch (err) {
        base.status = "error";
        base.error = err.message;
      }

      entries.push(base);
    }
    console.log(`[logos] ${row.brand_id}`);
  }

  const report = {
    generated_at: new Date().toISOString(),
    total_brands: rows.length,
    total_candidates: entries.length,
    converted_candidates: entries.filter((entry) => entry.status === "converted").length,
    entries
  };
  writeJson(path.join(root, "reports", "logo-fetch-report.json"), report);
  selectInitialLogos(rows, entries);
  console.log(`写入 ${rel(path.join(root, "reports", "logo-fetch-report.json"))}`);
}

function selectInitialLogos(rows, entries) {
  const byBrand = new Map();
  for (const entry of entries) {
    if (!byBrand.has(entry.brand_id)) byBrand.set(entry.brand_id, new Map());
    byBrand.get(entry.brand_id).set(entry.candidate_name, entry);
  }

  ensureDir(path.join(root, "assets", "logos"));
  const outputRows = [];
  const selectionEntries = [];

  for (const row of rows) {
    const target = path.join(root, "assets", "logos", `${row.brand_id}.webp`);
    if (fs.existsSync(target)) fs.unlinkSync(target);

    let selected = null;
    let logoReviewStatus = "missing";
    const brandCandidates = byBrand.get(row.brand_id) || new Map();

    if ((row.has_pure_symbol || "").toLowerCase() === "false") {
      logoReviewStatus = "skipped_no_pure_symbol";
    } else {
      for (const candidateName of selectionOrder) {
        const entry = brandCandidates.get(candidateName);
        if (entry && entry.status === "converted" && entry.output_file_path) {
          selected = entry;
          logoReviewStatus = candidateName.startsWith("logo_") ? "needs_manual_review" : "initial_selected";
          break;
        }
      }
    }

    if (selected) {
      fs.copyFileSync(path.join(root, selected.output_file_path), target);
    }

    const size = fs.existsSync(target) ? fs.statSync(target).size : 0;
    outputRows.push({
      brand_id: row.brand_id,
      name_en: row.name_en,
      name_zh: row.name_zh,
      domain: row.resolved_domain || row.domain || "",
      industry: row.industry,
      country_region: row.country_region,
      fame_level: row.fame_level,
      similar_group: row.similar_group,
      has_pure_symbol: row.has_pure_symbol,
      symbol_review_status: row.symbol_review_status,
      logo_review_status: logoReviewStatus,
      selected_logo_type: selected ? selected.candidate_name : "",
      selected_logo_file: `assets/logos/${row.brand_id}.webp`,
      selected_logo_size_bytes: size,
      preferred_source: row.preferred_source,
      notes: row.notes
    });
    selectionEntries.push({
      brand_id: row.brand_id,
      selected_logo_type: selected ? selected.candidate_name : "",
      selected_logo_file: selected ? `assets/logos/${row.brand_id}.webp` : "",
      selected_logo_size_bytes: size,
      logo_review_status: logoReviewStatus
    });
  }

  writeCsv(assetsFile, outputRows, [
    "brand_id",
    "name_en",
    "name_zh",
    "domain",
    "industry",
    "country_region",
    "fame_level",
    "similar_group",
    "has_pure_symbol",
    "symbol_review_status",
    "logo_review_status",
    "selected_logo_type",
    "selected_logo_file",
    "selected_logo_size_bytes",
    "preferred_source",
    "notes"
  ]);
  writeJson(path.join(root, "reports", "logo-selection-report.json"), {
    generated_at: new Date().toISOString(),
    total_brands: rows.length,
    entries: selectionEntries
  });
}

function fileSize(file) {
  return fs.existsSync(file) ? fs.statSync(file).size : 0;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function generateAssetReport() {
  const config = loadConfig({ requireClientId: false });
  const rows = fs.existsSync(assetsFile) ? readCsv(assetsFile) : [];
  const logoRows = rows.map((row) => {
    const abs = path.join(root, row.selected_logo_file || `assets/logos/${row.brand_id}.webp`);
    return {
      brand_id: row.brand_id,
      file: row.selected_logo_file || `assets/logos/${row.brand_id}.webp`,
      size_bytes: fileSize(abs),
      similar_group: row.similar_group,
      logo_review_status: row.logo_review_status || "missing"
    };
  });
  const existing = logoRows.filter((row) => row.size_bytes > 0);
  const totalSize = existing.reduce((sum, row) => sum + row.size_bytes, 0);
  const average = existing.length ? Math.round(totalSize / existing.length) : 0;
  const byGroup = {};
  for (const row of logoRows) {
    if (!byGroup[row.similar_group]) {
      byGroup[row.similar_group] = { logo_count: 0, size_bytes: 0 };
    }
    if (row.size_bytes > 0) {
      byGroup[row.similar_group].logo_count += 1;
      byGroup[row.similar_group].size_bytes += row.size_bytes;
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    total_logo_size_bytes: totalSize,
    total_logo_size_mb: Number((totalSize / 1024 / 1024).toFixed(4)),
    asset_budget_mb: config.assetBudgetMb,
    over_budget: totalSize > config.assetBudgetMb * 1024 * 1024,
    average_logo_size_bytes: average,
    estimated_300_brands_size_bytes: average * 300,
    estimated_300_brands_size_mb: Number(((average * 300) / 1024 / 1024).toFixed(4)),
    logos: logoRows,
    similar_group_sizes: byGroup,
    largest_20_logos: [...logoRows].sort((a, b) => b.size_bytes - a.size_bytes).slice(0, 20),
    missing_brands: logoRows.filter((row) => row.logo_review_status === "missing" || row.size_bytes === 0).map((row) => row.brand_id),
    needs_manual_review_brands: logoRows.filter((row) => row.logo_review_status === "needs_manual_review").map((row) => row.brand_id),
    skipped_no_pure_symbol_brands: logoRows.filter((row) => row.logo_review_status === "skipped_no_pure_symbol").map((row) => row.brand_id)
  };
  writeJson(path.join(root, "reports", "asset-size-report.json"), report);
  console.log(`assets/logos 总体积: ${formatBytes(totalSize)}`);
  return report;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generatePreview() {
  const rows = fs.existsSync(assetsFile) ? readCsv(assetsFile) : [];
  const fetchReportFile = path.join(root, "reports", "logo-fetch-report.json");
  const fetchReport = fs.existsSync(fetchReportFile) ? JSON.parse(fs.readFileSync(fetchReportFile, "utf8")) : { entries: [] };
  const assetReport = generateAssetReport();
  const groups = {};
  rows.forEach((row) => {
    if (!groups[row.similar_group]) groups[row.similar_group] = [];
    groups[row.similar_group].push(row);
  });

  const cards = Object.entries(groups).map(([group, groupRows]) => `
    <section class="group">
      <h2>${htmlEscape(group)} <span>${groupRows.length}</span></h2>
      <div class="brand-grid">
        ${groupRows.map((row) => {
          const selectedPath = path.join(root, row.selected_logo_file);
          const selectedExists = fs.existsSync(selectedPath);
          return `
            <article class="brand-card">
              <div class="brand-head">
                <div>
                  <h3>${htmlEscape(row.name_en)}</h3>
                  <p>${htmlEscape(row.name_zh)} · ${htmlEscape(row.brand_id)}</p>
                </div>
                <span class="status ${htmlEscape(row.logo_review_status)}">${htmlEscape(row.logo_review_status)}</span>
              </div>
              <dl>
                <div><dt>domain</dt><dd>${htmlEscape(row.domain)}</dd></div>
                <div><dt>industry</dt><dd>${htmlEscape(row.industry)}</dd></div>
                <div><dt>similar_group</dt><dd>${htmlEscape(row.similar_group)}</dd></div>
                <div><dt>has_pure_symbol</dt><dd>${htmlEscape(row.has_pure_symbol)}</dd></div>
                <div><dt>symbol_review_status</dt><dd>${htmlEscape(row.symbol_review_status)}</dd></div>
              </dl>
              <div class="selected">
                <div class="label">Selected · ${htmlEscape(row.selected_logo_type || "none")}</div>
                <div class="image-box large">${selectedExists ? `<img src="../${htmlEscape(row.selected_logo_file)}" alt="${htmlEscape(row.brand_id)} selected">` : "<span>Missing</span>"}</div>
              </div>
              <div class="candidate-grid">
                ${candidateTypes.map(([candidateName]) => {
                  const candidateFile = `assets/_candidates/${row.brand_id}/${candidateName}.webp`;
                  const exists = fs.existsSync(path.join(root, candidateFile));
                  return `
                    <div class="candidate">
                      <div class="label">${htmlEscape(candidateName)}</div>
                      <div class="image-box">${exists ? `<img src="../${htmlEscape(candidateFile)}" alt="${htmlEscape(row.brand_id)} ${htmlEscape(candidateName)}">` : "<span>Missing</span>"}</div>
                    </div>`;
                }).join("")}
              </div>
            </article>`;
        }).join("")}
      </div>
    </section>`).join("");

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brandfetch Logo Preview</title>
  <style>
    :root { color-scheme: light; --bg: #eef0f3; --card: #ffffff; --ink: #20242a; --muted: #68707a; --line: #d9dde3; --accent: #0f766e; --warn: #a16207; --bad: #b91c1c; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: "Segoe UI", system-ui, sans-serif; }
    header { position: sticky; top: 0; z-index: 2; background: rgba(238, 240, 243, .94); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); padding: 18px 24px; }
    h1 { margin: 0 0 14px; font-size: 22px; font-weight: 700; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .stat { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
    .stat b { display: block; font-size: 20px; margin-bottom: 2px; }
    .stat span, .label, dt { color: var(--muted); font-size: 12px; }
    main { padding: 22px 24px 42px; }
    .group { margin-bottom: 26px; }
    h2 { font-size: 18px; margin: 0 0 12px; }
    h2 span { color: var(--muted); font-weight: 500; }
    .brand-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px; }
    .brand-card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .brand-head { display: flex; justify-content: space-between; gap: 12px; align-items: start; margin-bottom: 10px; }
    h3 { margin: 0; font-size: 17px; }
    p { margin: 3px 0 0; color: var(--muted); font-size: 13px; }
    .status { border-radius: 999px; padding: 4px 8px; font-size: 12px; background: #e7f6f3; color: var(--accent); white-space: nowrap; }
    .status.needs_manual_review { background: #fef3c7; color: var(--warn); }
    .status.missing, .status.skipped_no_pure_symbol { background: #fee2e2; color: var(--bad); }
    dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 12px; margin: 0 0 12px; }
    dt { margin-bottom: 2px; }
    dd { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
    .selected { margin-bottom: 12px; }
    .candidate-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .image-box { width: 100%; aspect-ratio: 1; display: grid; place-items: center; background: #fff; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .image-box.large { max-width: 156px; }
    img { max-width: 86%; max-height: 86%; object-fit: contain; }
    .image-box span { color: #9aa1aa; font-size: 12px; }
    @media (max-width: 760px) { header, main { padding-left: 14px; padding-right: 14px; } .brand-grid { grid-template-columns: 1fr; } .candidate-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } dl { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>Brandfetch Logo Preview</h1>
    <div class="stats">
      <div class="stat"><b>${rows.length}</b><span>总品牌数</span></div>
      <div class="stat"><b>${fetchReport.converted_candidates || 0}</b><span>成功生成候选图数量</span></div>
      <div class="stat"><b>${assetReport.missing_brands.length}</b><span>missing</span></div>
      <div class="stat"><b>${assetReport.needs_manual_review_brands.length}</b><span>needs_manual_review</span></div>
      <div class="stat"><b>${assetReport.skipped_no_pure_symbol_brands.length}</b><span>skipped_no_pure_symbol</span></div>
      <div class="stat"><b>${formatBytes(assetReport.total_logo_size_bytes)}</b><span>assets/logos 总体积</span></div>
    </div>
  </header>
  <main>${cards}</main>
</body>
</html>
`;
  const output = path.join(root, "review", "brandfetch-preview.html");
  ensureDir(path.dirname(output));
  fs.writeFileSync(output, html, "utf8");
  console.log(`写入 ${rel(output)}`);
}

async function buildAll() {
  validateSeed();
  await fetchSearch();
  await buildCandidates();
  generatePreview();
  generateAssetReport();
}

async function main() {
  const command = process.argv[2];
  try {
    if (command === "validate-seed") {
      validateSeed();
      console.log("seed 校验通过。");
    } else if (command === "fetch-search") {
      await fetchSearch();
    } else if (command === "build-candidates") {
      await buildCandidates();
    } else if (command === "preview-logos") {
      generatePreview();
    } else if (command === "report-assets") {
      generateAssetReport();
    } else if (command === "build-all") {
      await buildAll();
    } else {
      throw new Error("未知命令。");
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
