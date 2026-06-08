const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { parse } = require("csv-parse/sync");

const root = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(root, "miniprogram");
const quizRoot = path.join(miniprogramRoot, "packages", "quiz");
const logoDir = path.join(quizRoot, "assets", "logos");
const dataDir = path.join(quizRoot, "data");
const mainDataDir = path.join(miniprogramRoot, "data");
const reportDir = path.join(root, "reports");
const reviewDir = path.join(root, "review");

const sourceIndexFile = path.join(root, "data", "all_logo_candidates_index.json");
const reviewMarksFile = path.join(root, "data", "all-logo-corpus-marks.json");
const brandOverridesFile = path.join(root, "data", "logo_brand_overrides.csv");
const brandNameEnrichmentFile = path.join(root, "data", "brand_name_enrichment_cache.json");
const brandsSeedFile = path.join(root, "data", "brands_seed.csv");
const expandedBrandsFile = path.join(root, "logo_brand_expanded_candidates.csv");
const buildReportFile = path.join(reportDir, "build-brands-report.json");
const validationReportFile = path.join(reportDir, "quiz-data-validation-report.json");
const quizPreviewFile = path.join(reviewDir, "quiz-questions-preview.html");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  return parse(fs.readFileSync(file, "utf8"), { bom: true, columns: true, skip_empty_lines: true, trim: true });
}

function loadReviewMarks() {
  if (!fs.existsSync(reviewMarksFile)) return { wordmarkIds: new Set(), marks: {} };
  const payload = readJson(reviewMarksFile);
  const ids = new Set();
  for (const id of payload.wordmark_ids || []) ids.add(id);
  for (const id of payload.manual_wordmark_ids || []) ids.add(id);
  if (payload.marks && typeof payload.marks === "object") {
    for (const [id, value] of Object.entries(payload.marks)) {
      if (value && value.wordmark === true) ids.add(id);
    }
  }
  return { wordmarkIds: ids, marks: payload.marks || {} };
}

function isReviewUsable(row, reviewMarks) {
  if (!row.webp_file || !row.preview_file) return false;
  if (row.auto_exclude === "true") return false;
  if (row.is_wordmark === "true") return false;
  if (reviewMarks.wordmarkIds.has(row.corpus_id)) return false;
  return true;
}

function writeJs(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `module.exports=${JSON.stringify(data)};\n`, "utf8");
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonScriptEscape(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "brand";
}

function displayName(row) {
  return cleanDisplayName(row.name_zh || row.display_name || row.name_en || row.title || row.brand_id);
}

function promptBrandName(name) {
  return /[\u4e00-\u9fff]/.test(String(name || "")) ? String(name) : ` ${name} `;
}

function cleanDisplayName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  const stripped = raw
    .replace(/\.(svg|png|jpe?g|webp)$/i, "")
    .replace(/(?:^|[-_\s])(icon|logo|default|color|black|white|symbol|mark)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function firstNoteToken(notes) {
  return String(notes || "").split(";")[0].trim();
}

function loadBrandOverrides() {
  const byCorpusId = new Map();
  for (const row of readCsv(brandOverridesFile)) {
    if (!row.corpus_id || !row.brand_id) continue;
    byCorpusId.set(row.corpus_id, {
      brand_id: slug(row.brand_id),
      name_en: row.name_en || "",
      name_zh: row.name_zh || "",
      display_name: row.display_name || "",
      industry: row.industry || "",
      similar_group: row.similar_group || ""
    });
  }
  return byCorpusId;
}

function loadBrandNameEnrichment() {
  if (!fs.existsSync(brandNameEnrichmentFile)) return new Map();
  const payload = readJson(brandNameEnrichmentFile);
  const records = Array.isArray(payload) ? payload : Object.values(payload.records || payload);
  const map = new Map();
  for (const record of records) {
    if (!record || record.status !== "matched" || !record.brand_id) continue;
    if ((record.confidence || 0) < 80) continue;
    map.set(record.brand_id, {
      label_en: record.label_en || "",
      label_zh: record.label_zh || record.label_zh_hans || "",
      industry: record.industry || "",
      source: record.source || ""
    });
  }
  return map;
}

function loadBrandMeta() {
  const map = new Map();
  for (const row of readCsv(brandsSeedFile)) {
    map.set(row.brand_id, {
      brand_id: row.brand_id,
      name_en: row.name_en,
      name_zh: row.name_zh,
      industry: row.industry || "其他",
      similar_group: row.similar_group || row.industry || "general",
      has_pure_symbol: String(row.has_pure_symbol || "").toLowerCase() !== "false",
      include_mvp: row.include_mvp
    });
  }
  for (const row of readCsv(expandedBrandsFile)) {
    if (!map.has(row.brand_id)) {
      map.set(row.brand_id, {
        brand_id: row.brand_id,
        name_en: row.name_en,
        name_zh: row.name_zh,
        industry: row.industry || "其他",
        similar_group: row.similar_group || row.industry || "general",
        has_pure_symbol: String(row.pure_symbol_likelihood || "").toLowerCase() !== "low",
        include_mvp: row.collect_status || ""
      });
    }
  }
  return map;
}

function svglogoBrandId(row) {
  if (!row.legacy_svglogo_id) return "";
  const id = String(row.legacy_svglogo_id);
  const category = firstNoteToken(row.notes);
  if (category && id.startsWith(`${category}_`)) return slug(id.slice(category.length + 1));
  return slug(id);
}

function isGenericBrandId(value) {
  return /^(logo|logos|icon|icons|default|color|black|white|symbol|mark|app|brand|favicon|apple_touch_icon|og_image|meta|orphan)$/i.test(String(value || ""));
}

function brandIdFromPath(row) {
  const raw = String(row.raw_file || "").replace(/\\/g, "/").toLowerCase();
  const notes = String(row.notes || "").replace(/\\/g, "/").toLowerCase();
  const candidates = [raw, notes];
  for (const value of candidates) {
    const wiki = value.match(/assets\/_raw\/(?:expanded-wikimedia|expanded-website-icons|wikimedia)\/([^/]+)\//);
    if (wiki) return slug(wiki[1]);
    const vector = value.match(/vendor\/vectorlogozone\/www\/logos\/([^/]+)\//) || value.match(/^([^/]+)\/[^/]+-(?:icon|ar21)\.svg/);
    if (vector) return slug(vector[1]);
    const thesvg = value.match(/vendor\/thesvg\/public\/icons\/([^/]+)\//) || value.match(/public\/icons\/([^/]+)\//);
    if (thesvg) return slug(thesvg[1]);
    const car = value.match(/vendor\/car-logos-dataset\/(?:logos\/optimized|local-logos)\/([^/]+)\.(?:svg|png|webp|jpe?g)$/) || value.match(/(?:logos\/optimized|local-logos)\/([^/]+)\.(?:svg|png|webp|jpe?g)$/);
    if (car) return slug(car[1]);
    const gilbarbara = value.match(/vendor\/gilbarbara-logos\/logos\/([^/]+)\.svg$/);
    if (gilbarbara) return slug(gilbarbara[1].replace(/[-_](icon|logo|symbol|mark|default|color)$/i, ""));
  }
  return "";
}

function brandIdFromRecord(row, overrides) {
  const override = overrides && overrides.get(row.corpus_id);
  if (override?.brand_id) return override.brand_id;
  if (row.source_type === "svglogo") {
    const svglogoId = svglogoBrandId(row);
    if (svglogoId) return svglogoId;
  }
  const pathBrand = brandIdFromPath(row);
  if (pathBrand && !isGenericBrandId(pathBrand)) return pathBrand;
  const notesBrand = firstNoteToken(row.notes);
  if (notesBrand && /^[a-z0-9_]+$/.test(notesBrand) && !["meta", "orphan"].includes(notesBrand)) return notesBrand;
  const raw = String(row.raw_file || "").replace(/\\/g, "/").toLowerCase();
  if (row.legacy_svglogo_id) return slug(String(row.legacy_svglogo_id).replace(/^[^_]+_/, ""));
  const base = path.basename(raw, path.extname(raw));
  return slug(base.replace(/[-_ ]?(icon|default|color|logo)$/i, ""));
}

function hasReliableMeta(brandId, row, metaMap) {
  if (!brandId || isGenericBrandId(brandId)) return false;
  if (row.source_type === "svglogo") return true;
  if (metaMap.has(brandId)) return true;
  if (["wikimedia", "expanded-wikimedia", "expanded-website-icons"].includes(row.source_type)) return true;
  if (["gilbarbara", "vectorlogozone", "thesvg", "car-logos"].includes(row.source_type)) return true;
  return false;
}

function categoryFromSvglogo(row) {
  const category = firstNoteToken(row.notes);
  const map = {
    aigc: "科技互联网",
    airline: "航空交通",
    automotive: "汽车交通",
    company: "企业品牌",
    consumerBrands: "消费品牌",
    cosmetic: "美妆个护",
    goldJewelry: "珠宝腕表",
    pay: "金融支付",
    school: "公共机构/教育",
    social: "社交媒体",
    tools: "工具软件"
  };
  return map[category] || category || "其他";
}

function inferIndustry(row) {
  if (row.source_type === "car-logos") return "汽车交通";
  if (row.source_type === "expanded-website-icons" || row.source_type === "expanded-wikimedia" || row.source_type === "wikimedia") return "品牌机构";
  if (row.source_type === "gilbarbara" || row.source_type === "vectorlogozone" || row.source_type === "thesvg") return "科技互联网";
  return "其他";
}

function brandFromRecord(row, metaMap, overrides, enrichmentMap) {
  const brand_id = brandIdFromRecord(row, overrides);
  const meta = metaMap.get(brand_id) || {};
  const override = overrides && overrides.get(row.corpus_id);
  const enriched = enrichmentMap && enrichmentMap.get(brand_id);
  const industry = meta.industry || enriched?.industry || (row.source_type === "svglogo" ? categoryFromSvglogo(row) : inferIndustry(row)) || "其他";
  const enrichedDisplayName = enriched?.label_zh || enriched?.label_en || "";
  return {
    brand_id,
    name_en: cleanDisplayName(override?.name_en || meta.name_en || enriched?.label_en || row.title || brand_id),
    name_zh: override?.name_zh || meta.name_zh || enriched?.label_zh || "",
    display_name: displayName({ ...meta, display_name: override?.display_name || enrichedDisplayName, title: row.title, brand_id }),
    logo: `/packages/quiz/assets/logos/${brand_id}.jpg`,
    industry: override?.industry || industry,
    similar_group: override?.similar_group || meta.similar_group || industry,
    has_pure_symbol: meta.has_pure_symbol !== false,
    _source: row.source_type,
    _source_id: row.corpus_id,
    _source_file: row.webp_file || row.preview_file || row.raw_file
  };
}

function sourcePriority(row) {
  const order = {
    svglogo: 1000,
    wikimedia: 800,
    "expanded-wikimedia": 750,
    "expanded-website-icons": 700,
    gilbarbara: 650,
    vectorlogozone: 600,
    thesvg: 520,
    "car-logos": 500
  };
  return (order[row.source_type] || 100) + (row.webp_file ? 20 : 0);
}

async function copyLogo(row, brand) {
  const sourceRel = row.webp_file;
  const source = path.join(root, sourceRel);
  const target = path.join(logoDir, `${brand.brand_id}.jpg`);
  ensureDir(path.dirname(target));
  if (!fs.existsSync(source)) throw new Error(`missing source ${sourceRel}`);
  await sharp(source, { animated: false, limitInputPixels: false })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: 216, height: 216, fit: "contain", background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 70, mozjpeg: true })
    .toFile(target);
}

function shuffleStable(items, seed) {
  let state = seed || 123456789;
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeOptions(answer, brands) {
  const chosen = new Map([[answer.brand_id, answer]]);
  const add = (pool) => {
    for (const item of shuffleStable(pool, answer.brand_id.length + chosen.size * 97)) {
      if (chosen.size >= 4) break;
      if (item.brand_id !== answer.brand_id && !chosen.has(item.brand_id)) chosen.set(item.brand_id, item);
    }
  };
  add(brands.filter((item) => item.similar_group === answer.similar_group));
  add(brands.filter((item) => item.industry === answer.industry));
  add(brands);
  return chosen.size === 4 ? shuffleStable([...chosen.values()], answer.brand_id.length * 31) : [];
}

function buildQuestions(brands) {
  const questions = [];
  for (const brand of brands) {
    const options = makeOptions(brand, brands);
    if (options.length !== 4) continue;
    questions.push({
      id: `q_logo_to_brand_${brand.brand_id}_001`,
      type: "logo_to_brand",
      answer_brand_id: brand.brand_id,
      options: options.map((item) => ({ brand_id: item.brand_id })),
      industry: brand.industry,
      similar_group: brand.similar_group
    });
    questions.push({
      id: `q_brand_to_logo_${brand.brand_id}_001`,
      type: "brand_to_logo",
      answer_brand_id: brand.brand_id,
      options: options.map((item) => ({ brand_id: item.brand_id })),
      industry: brand.industry,
      similar_group: brand.similar_group
    });
  }
  return questions;
}

function writeQuizPreview(brands, questions) {
  const brandMap = new Map(brands.map((brand) => [brand.brand_id, brand]));
  const reviewQuestions = questions.map((question) => {
    const answer = brandMap.get(question.answer_brand_id) || {};
    return {
      id: question.id,
      type: question.type,
      answer_brand_id: question.answer_brand_id,
      answer_name: answer.display_name || question.answer_brand_id,
      industry: question.industry || answer.industry || "",
      similar_group: question.similar_group || answer.similar_group || "",
      logo: `../miniprogram/packages/quiz/assets/logos/${question.answer_brand_id}.jpg`,
      brand_name: answer.display_name || question.answer_brand_id,
      options: (question.options || []).map((option, index) => {
        const brand = brandMap.get(option.brand_id) || {};
        return {
          brand_id: option.brand_id,
          name: brand.display_name || option.brand_id,
          image: `../miniprogram/packages/quiz/assets/logos/${option.brand_id}.jpg`,
          letter: "ABCD"[index] || "",
          correct: option.brand_id === question.answer_brand_id
        };
      })
    };
  });
  const typeCounts = {};
  const industryCounts = {};
  for (const question of reviewQuestions) {
    typeCounts[question.type] = (typeCounts[question.type] || 0) + 1;
    industryCounts[question.industry || "未分类"] = (industryCounts[question.industry || "未分类"] || 0) + 1;
  }
  const payload = {
    generated_at: new Date().toISOString(),
    brand_count: brands.length,
    question_count: questions.length,
    type_counts: typeCounts,
    industry_counts: industryCounts,
    questions: reviewQuestions
  };
  ensureDir(reviewDir);
  fs.writeFileSync(quizPreviewFile, `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>题目审核 - 识标挑战</title>
  <style>
    :root { color-scheme: light; --green:#58cc02; --blue:#1cb0f6; --red:#ff4b4b; --text:#263238; --muted:#7c8794; --line:#e5e7eb; --bg:#f6f8fb; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    header { position: sticky; top: 0; z-index: 5; padding: 18px 22px; background: rgba(246,248,251,.96); border-bottom: 1px solid var(--line); backdrop-filter: blur(8px); }
    h1 { margin: 0 0 12px; font-size: 22px; }
    .summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; color: var(--muted); font-size: 13px; }
    .pill { padding: 5px 10px; border-radius: 999px; background: #fff; border: 1px solid var(--line); }
    .filters { display: grid; grid-template-columns: minmax(180px, 1fr) 180px 180px 160px; gap: 10px; max-width: 980px; }
    input, select, button { height: 36px; border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 0 10px; font: inherit; }
    button { cursor: pointer; font-weight: 700; }
    main { padding: 20px 22px 40px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .card { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 14px; box-shadow: 0 2px 8px rgba(15,23,42,.05); }
    .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
    .qid { font-size: 12px; color: var(--muted); word-break: break-all; }
    .type { flex-shrink: 0; padding: 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 800; }
    .logo_to_brand .type { background: #eaf8e3; color: #3f9800; }
    .brand_to_logo .type { background: #eaf6ff; color: #0877b5; }
    .prompt { margin: 8px 0 12px; font-size: 18px; font-weight: 800; text-align: center; }
    .answer { color: var(--green); }
    .question-logo { height: 128px; display:flex; align-items:center; justify-content:center; border:1px solid var(--line); border-radius: 12px; background:#fff; margin-bottom: 12px; }
    .question-logo img { max-width: 72%; max-height: 72%; object-fit: contain; }
    .brand-prompt { min-height: 108px; display:flex; align-items:center; justify-content:center; border:1px solid var(--line); border-radius: 12px; background:#fff; font-size: 26px; font-weight: 900; text-align:center; padding: 10px; margin-bottom: 12px; }
    .text-options { display: grid; gap: 8px; }
    .text-option { display:flex; align-items:center; gap: 10px; min-height: 42px; padding: 8px 10px; border:1px solid var(--line); border-radius: 10px; }
    .logo-options { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .logo-option { position:relative; min-height: 104px; display:flex; align-items:center; justify-content:center; border:1px solid var(--line); border-radius: 12px; padding: 16px; background:#fff; }
    .logo-option img { max-width: 74%; max-height: 74px; object-fit: contain; }
    .letter { flex: 0 0 26px; width: 26px; height: 26px; border-radius: 50%; display:flex; align-items:center; justify-content:center; background:#f1f5f9; color:#64748b; font-weight:900; font-size:13px; }
    .logo-option .letter { position:absolute; left: 9px; top: 9px; }
    .correct { border-color: rgba(88,204,2,.7); background:#f3ffe9; }
    .correct .letter { background: var(--green); color: #fff; }
    .meta { margin-top: 10px; display:flex; flex-wrap:wrap; gap:6px; font-size:12px; color:var(--muted); }
    .empty { display:none; padding:40px; text-align:center; color:var(--muted); }
    @media (max-width: 760px) { .filters { grid-template-columns: 1fr; } main, header { padding-left: 14px; padding-right: 14px; } }
  </style>
</head>
<body>
  <header>
    <h1>题目审核</h1>
    <div class="summary">
      <span class="pill">生成时间：${htmlEscape(payload.generated_at)}</span>
      <span class="pill">品牌：${brands.length}</span>
      <span class="pill">题目：${questions.length}</span>
      <span class="pill">基础识别：${typeCounts.logo_to_brand || 0}</span>
      <span class="pill">反向记忆：${typeCounts.brand_to_logo || 0}</span>
      <span class="pill" id="visibleCount"></span>
    </div>
    <div class="filters">
      <input id="search" placeholder="搜索品牌名 / brand_id / 题目 ID">
      <select id="type"><option value="">全部题型</option><option value="logo_to_brand">基础识别</option><option value="brand_to_logo">反向记忆</option></select>
      <select id="industry"><option value="">全部行业</option></select>
      <button id="onlyWrongRisk">只看疑似问题</button>
    </div>
  </header>
  <main>
    <div id="grid" class="grid"></div>
    <div id="empty" class="empty">没有匹配的题目</div>
  </main>
  <script id="payload" type="application/json">${jsonScriptEscape(payload)}</script>
  <script>
    const data = JSON.parse(document.getElementById('payload').textContent);
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    const visibleCount = document.getElementById('visibleCount');
    const searchInput = document.getElementById('search');
    const typeSelect = document.getElementById('type');
    const industrySelect = document.getElementById('industry');
    const onlyWrongRisk = document.getElementById('onlyWrongRisk');
    let riskOnly = false;
    const typeLabel = { logo_to_brand: '基础识别', brand_to_logo: '反向记忆' };
    for (const name of Object.keys(data.industry_counts).sort()) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name + ' (' + data.industry_counts[name] + ')';
      industrySelect.appendChild(option);
    }
    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
    }
    function isRisk(question) {
      const names = question.options.map(option => option.name);
      const uniqueNames = new Set(names.map(name => String(name).toLowerCase()));
      if (uniqueNames.size !== names.length) return true;
      if (!question.options.some(option => option.correct)) return true;
      if (/[-_](icon|logo)\\b/i.test(question.answer_name)) return true;
      if (/^[a-z0-9_]{12,}$/i.test(question.answer_name)) return true;
      return false;
    }
    function renderCard(question) {
      const cls = 'card ' + question.type;
      const meta = '<div class="meta"><span>' + escapeHtml(question.industry || '未分类') + '</span><span>' + escapeHtml(question.similar_group || '') + '</span><span>' + escapeHtml(question.answer_brand_id) + '</span></div>';
      if (question.type === 'brand_to_logo') {
        return '<article class="' + cls + '"><div class="card-head"><div class="qid">' + escapeHtml(question.id) + '</div><div class="type">' + typeLabel[question.type] + '</div></div><div class="prompt">请选择 <span class="answer">' + escapeHtml(question.brand_name) + '</span> 对应的 Logo</div><div class="logo-options">' + question.options.map(option => '<div class="logo-option ' + (option.correct ? 'correct' : '') + '"><span class="letter">' + option.letter + '</span><img src="' + escapeHtml(option.image) + '" loading="lazy" alt="' + escapeHtml(option.name) + '"></div>').join('') + '</div>' + meta + '</article>';
      }
      return '<article class="' + cls + '"><div class="card-head"><div class="qid">' + escapeHtml(question.id) + '</div><div class="type">' + typeLabel[question.type] + '</div></div><div class="prompt">请选择该 Logo 对应的品牌</div><div class="question-logo"><img src="' + escapeHtml(question.logo) + '" loading="lazy" alt="' + escapeHtml(question.answer_name) + '"></div><div class="text-options">' + question.options.map(option => '<div class="text-option ' + (option.correct ? 'correct' : '') + '"><span class="letter">' + option.letter + '</span><span>' + escapeHtml(option.name) + '</span></div>').join('') + '</div>' + meta + '</article>';
    }
    function applyFilters() {
      const term = searchInput.value.trim().toLowerCase();
      const type = typeSelect.value;
      const industry = industrySelect.value;
      const filtered = data.questions.filter(question => {
        if (type && question.type !== type) return false;
        if (industry && question.industry !== industry) return false;
        if (riskOnly && !isRisk(question)) return false;
        if (!term) return true;
        return [question.id, question.answer_brand_id, question.answer_name, question.industry, question.similar_group].some(value => String(value || '').toLowerCase().includes(term))
          || question.options.some(option => [option.brand_id, option.name].some(value => String(value || '').toLowerCase().includes(term)));
      });
      visibleCount.textContent = '当前显示：' + filtered.length;
      grid.innerHTML = filtered.map(renderCard).join('');
      empty.style.display = filtered.length ? 'none' : 'block';
    }
    searchInput.addEventListener('input', applyFilters);
    typeSelect.addEventListener('change', applyFilters);
    industrySelect.addEventListener('change', applyFilters);
    onlyWrongRisk.addEventListener('click', () => {
      riskOnly = !riskOnly;
      onlyWrongRisk.textContent = riskOnly ? '显示全部' : '只看疑似问题';
      applyFilters();
    });
    applyFilters();
  </script>
</body>
</html>
`, "utf8");
}

async function build() {
  if (!fs.existsSync(sourceIndexFile)) throw new Error("data/all_logo_candidates_index.json not found");
  const reviewMarks = loadReviewMarks();
  const allRows = readJson(sourceIndexFile);
  const rows = allRows.filter((row) => isReviewUsable(row, reviewMarks));
  const metaMap = loadBrandMeta();
  const overrides = loadBrandOverrides();
  const enrichmentMap = loadBrandNameEnrichment();
  const best = new Map();
  const skipped = [];
  for (const row of rows) {
    const brand_id = brandIdFromRecord(row, overrides);
    if (!brand_id) {
      skipped.push({ corpus_id: row.corpus_id, reason: "missing_brand_id" });
      continue;
    }
    if (!hasReliableMeta(brand_id, row, metaMap)) {
      skipped.push({ corpus_id: row.corpus_id, brand_id, reason: "missing_reliable_brand_meta" });
      continue;
    }
    const current = best.get(brand_id);
    if (!current || sourcePriority(row) > sourcePriority(current)) best.set(brand_id, row);
  }

  fs.rmSync(logoDir, { recursive: true, force: true });
  ensureDir(logoDir);

  const brands = [];
  const missingLogos = [];
  for (const row of [...best.values()].sort((a, b) => brandIdFromRecord(a, overrides).localeCompare(brandIdFromRecord(b, overrides)))) {
    const brand = brandFromRecord(row, metaMap, overrides, enrichmentMap);
    try {
      await copyLogo(row, brand);
      brands.push(brand);
    } catch (err) {
      missingLogos.push({ brand_id: brand.brand_id, source_id: row.corpus_id, source_file: row.webp_file || row.preview_file || row.raw_file, error: err.message });
    }
  }

  const publicBrands = brands.map((brand) => ({
    brand_id: brand.brand_id,
    display_name: brand.display_name,
    industry: brand.industry,
    similar_group: brand.similar_group
  }));
  const questions = buildQuestions(publicBrands);
  writeJs(path.join(dataDir, "brands.js"), publicBrands);
  writeJs(path.join(dataDir, "questions.js"), questions);
  writeQuizPreview(publicBrands, questions);
  writeJs(path.join(mainDataDir, "summary.js"), {
    brand_count: publicBrands.length,
    question_count: questions.length,
    logo_to_brand_count: questions.filter((q) => q.type === "logo_to_brand").length,
    brand_to_logo_count: questions.filter((q) => q.type === "brand_to_logo").length
  });

  const byIndustry = {};
  const bySimilarGroup = {};
  for (const brand of publicBrands) {
    byIndustry[brand.industry] = (byIndustry[brand.industry] || 0) + 1;
    bySimilarGroup[brand.similar_group] = (bySimilarGroup[brand.similar_group] || 0) + 1;
  }
  const similarGroupReady = Object.fromEntries(Object.entries(bySimilarGroup).map(([group, count]) => [group, count >= 4]));
  writeJson(buildReportFile, {
    generated_at: new Date().toISOString(),
    formal_logo_source: "data/all_logo_candidates_index.json filtered by review/all-logo-corpus-preview.html usable state",
    review_marks_file: fs.existsSync(reviewMarksFile) ? "data/all-logo-corpus-marks.json" : "",
    brand_name_enrichment_file: fs.existsSync(brandNameEnrichmentFile) ? "data/brand_name_enrichment_cache.json" : "",
    enriched_brand_name_count: enrichmentMap.size,
    all_corpus_count: allRows.length,
    review_usable_count: rows.length,
    raw_brand_count: rows.length,
    unique_brand_count: best.size,
    usable_brand_count: publicBrands.length,
    question_count: questions.length,
    logo_to_brand_count: questions.filter((q) => q.type === "logo_to_brand").length,
    brand_to_logo_count: questions.filter((q) => q.type === "brand_to_logo").length,
    missing_logo_count: missingLogos.length,
    skipped_brand_count: skipped.length,
    by_industry: byIndustry,
    by_similar_group: bySimilarGroup,
    similar_group_ready: similarGroupReady,
    missing_logos: missingLogos.slice(0, 300),
    skipped_brands: skipped.slice(0, 300),
    selected_sources: brands.map((brand) => ({
      brand_id: brand.brand_id,
      source: brand._source,
      source_id: brand._source_id,
      source_file: brand._source_file
    }))
  });
}

function validate() {
  const brands = require(path.join(dataDir, "brands.js"));
  const questions = require(path.join(dataDir, "questions.js"));
  const brandIds = new Set(brands.map((brand) => brand.brand_id));
  const errors = [];
  const similarGroupStats = {};
  const checkImage = (image, qid) => {
    if (!image || /^https?:\/\//i.test(image)) errors.push({ question_id: qid, error: "external_or_missing_image", image });
    const file = path.join(miniprogramRoot, image.replace(/^\//, ""));
    if (!fs.existsSync(file)) errors.push({ question_id: qid, error: "image_file_not_found", image });
  };
  for (const question of questions) {
    if (!["logo_to_brand", "brand_to_logo"].includes(question.type)) errors.push({ question_id: question.id, error: "invalid_type" });
    if (!brandIds.has(question.answer_brand_id)) errors.push({ question_id: question.id, error: "answer_brand_missing" });
    if (!Array.isArray(question.options) || question.options.length !== 4) errors.push({ question_id: question.id, error: "option_count_not_4" });
    const optionIds = (question.options || []).map((option) => option.brand_id);
    if (new Set(optionIds).size !== optionIds.length) errors.push({ question_id: question.id, error: "duplicate_options" });
    if (!optionIds.includes(question.answer_brand_id)) errors.push({ question_id: question.id, error: "answer_not_in_options" });
    if (question.type === "logo_to_brand") checkImage(question.logo || `/packages/quiz/assets/logos/${question.answer_brand_id}.jpg`, question.id);
    if (question.type === "brand_to_logo") {
      for (const option of question.options || []) checkImage(option.image || `/packages/quiz/assets/logos/${option.brand_id}.jpg`, question.id);
    }
    similarGroupStats[question.similar_group] = (similarGroupStats[question.similar_group] || 0) + 1;
  }
  writeJson(validationReportFile, {
    generated_at: new Date().toISOString(),
    brand_count: brands.length,
    question_count: questions.length,
    valid: errors.length === 0,
    error_count: errors.length,
    errors: errors.slice(0, 300),
    similar_group_stats: similarGroupStats
  });
  if (errors.length) {
    console.error(`quiz data validation failed: ${errors.length}`);
    process.exitCode = 1;
  } else {
    console.log(`quiz data validation ok: ${questions.length} questions`);
  }
}

function preview() {
  delete require.cache[require.resolve(path.join(dataDir, "brands.js"))];
  delete require.cache[require.resolve(path.join(dataDir, "questions.js"))];
  const brands = require(path.join(dataDir, "brands.js"));
  const questions = require(path.join(dataDir, "questions.js"));
  writeQuizPreview(brands, questions);
  console.log(`quiz preview written: ${path.relative(root, quizPreviewFile)}`);
}

async function main() {
  const command = process.argv[2] || "build";
  if (command === "build") await build();
  else if (command === "validate") validate();
  else if (command === "preview") preview();
  else throw new Error(`unknown command ${command}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
