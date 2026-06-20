const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parse } = require("csv-parse/sync");

const root = path.resolve(__dirname, "..");
const csvFile = path.join(root, "logo_industry_brand_collection_MAX_flat.csv");
const gridDataDir = path.join(root, "generated", "logo-test", "data");
const tilesDir = path.join(root, "generated", "logo-test", "tiles");
const miniprogramRoot = path.join(root, "miniprogram");
const quizDataDir = path.join(miniprogramRoot, "packages", "quiz", "data");
const mainDataDir = path.join(miniprogramRoot, "data");
const reviewDir = path.join(root, "review");
const reportDir = path.join(root, "reports");
const distLogoDir = path.join(root, "dist", "logos", "v20260620r2");

const cdnBase = (process.env.LOGO_CDN_BASE || "https://logos.lupio.studio/logos/v20260620r2").replace(/\/+$/, "");
const questionReviewFile = path.join(reviewDir, "quiz-questions-preview.html");
const buildReportFile = path.join(reportDir, "logo-test-build-report.json");
const validationReportFile = path.join(reportDir, "quiz-data-validation-report.json");
const duplicateExclusionReportFile = path.join(reportDir, "logo-duplicate-exclusion-report.json");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readCsv(file) {
  return parse(fs.readFileSync(file, "utf8"), { bom: true, columns: true, skip_empty_lines: true, trim: true });
}

function writeJs(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `module.exports=${JSON.stringify(data)};\n`, "utf8");
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function fileSha1(file) {
  return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
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

function logoUrl(brandId) {
  return `${cdnBase}/${brandId}.webp`;
}

function localReviewLogo(brandId) {
  return `../dist/logos/v20260620r2/${brandId}.webp`;
}

function numericScore(value) {
  const number = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function difficultyNumber(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : 2;
}

function loadGridMap() {
  const map = new Map();
  const files = fs.readdirSync(gridDataDir).filter((file) => /^logo-grid.*\.json$/i.test(file)).sort();
  for (const file of files) {
    const grid = readJson(path.join(gridDataDir, file));
    for (const item of grid.items || []) {
      if (!item.brand_id || map.has(item.brand_id)) continue;
      map.set(item.brand_id, {
        grid_id: grid.grid_id || path.basename(file, ".json"),
        brand_name: item.brand_name || "",
        tile_png: item.tile_png || "",
        tile_webp: item.tile_webp || ""
      });
    }
  }
  return map;
}

function brandFromRow(row, gridMap) {
  const brandId = row.brand_id;
  const grid = gridMap.get(brandId) || {};
  return {
    brand_id: brandId,
    display_name: row["品牌名称"] || row["英文名/常用名"] || grid.brand_name || brandId,
    name_zh: row["品牌名称"] || "",
    name_en: row["英文名/常用名"] || "",
    industry: row["一级行业"] || "其他",
    category: row["小分类名称"] || "",
    scene: row["三级场景"] || "",
    region: row["国家/地区"] || "",
    coverage: row["覆盖范围"] || "",
    popularity_score: numericScore(row["知名度评分（百分制）"]),
    popularity_level: row["知名度等级"] || "",
    logo_type: row["Logo类型"] || "",
    pure_symbol_likelihood: row["是否有纯图形标"] || "",
    logo_clue: row["Logo识别线索"] || "",
    difficulty: row["建议题目难度"] || "",
    difficulty_rank: difficultyNumber(row["建议题目难度"]),
    similar_group: row.similar_group || row["小分类名称"] || row["一级行业"] || "general",
    description: row["简介"] || "",
    clue_prompt: row["描述题型问题文本"] || "",
    suited_types: row["适合题型"] || "",
    priority: row["收集优先级"] || "",
    compliance_label: row["合规/敏感标签"] || "",
    source_grid_id: grid.grid_id || "",
    logo: logoUrl(brandId)
  };
}

function shuffleStable(items, seedText) {
  let state = 2166136261;
  for (const ch of String(seedText || "")) {
    state ^= ch.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function addOptions(chosen, answer, pool) {
  for (const item of pool) {
    if (chosen.size >= 4) break;
    if (item.brand_id !== answer.brand_id && !chosen.has(item.brand_id)) {
      chosen.set(item.brand_id, item);
    }
  }
}

function makeOptions(answer, brands) {
  const chosen = new Map([[answer.brand_id, answer]]);
  addOptions(chosen, answer, shuffleStable(brands.filter((item) => item.similar_group === answer.similar_group), `${answer.brand_id}:group`));
  addOptions(chosen, answer, shuffleStable(brands.filter((item) => item.category && item.category === answer.category), `${answer.brand_id}:category`));
  addOptions(chosen, answer, shuffleStable(brands.filter((item) => item.industry === answer.industry), `${answer.brand_id}:industry`));
  addOptions(chosen, answer, shuffleStable(brands, `${answer.brand_id}:all`));
  return shuffleStable([...chosen.values()].slice(0, 4), `${answer.brand_id}:options`);
}

function makeClueOptions(answer, brands) {
  const chosen = new Map([[answer.brand_id, answer]]);
  const answerPrompt = answer.clue_prompt || "";
  const pools = [
    brands.filter((item) => item.brand_id !== answer.brand_id && item.category !== answer.category && item.clue_prompt !== answerPrompt),
    brands.filter((item) => item.brand_id !== answer.brand_id && item.industry !== answer.industry && item.clue_prompt !== answerPrompt),
    brands.filter((item) => item.brand_id !== answer.brand_id && item.clue_prompt !== answerPrompt),
    brands
  ];
  for (let index = 0; index < pools.length && chosen.size < 4; index += 1) {
    addOptions(chosen, answer, shuffleStable(pools[index], `${answer.brand_id}:clue:${index}`));
  }
  return shuffleStable([...chosen.values()].slice(0, 4), `${answer.brand_id}:clue:options`);
}

function publicBrand(brand) {
  return {
    brand_id: brand.brand_id,
    display_name: brand.display_name,
    industry: brand.industry,
    category: brand.category,
    similar_group: brand.similar_group
  };
}

function findDuplicateLogoExclusions(brands) {
  const hashGroups = new Map();
  const missing = [];
  for (const brand of brands) {
    const file = path.join(tilesDir, `${brand.brand_id}.webp`);
    if (!fs.existsSync(file)) {
      missing.push(brand.brand_id);
      continue;
    }
    const hash = fileSha1(file);
    if (!hashGroups.has(hash)) hashGroups.set(hash, []);
    hashGroups.get(hash).push(brand);
  }

  const duplicateGroups = [];
  const excludedBrandIds = new Set();
  for (const [sha1, group] of hashGroups) {
    if (group.length <= 1) continue;
    const [kept, ...excluded] = group;
    for (const brand of excluded) excludedBrandIds.add(brand.brand_id);
    duplicateGroups.push({
      sha1,
      count: group.length,
      kept: {
        brand_id: kept.brand_id,
        display_name: kept.display_name,
        file: `generated/logo-test/tiles/${kept.brand_id}.webp`
      },
      excluded: excluded.map((brand) => ({
        brand_id: brand.brand_id,
        display_name: brand.display_name,
        file: `generated/logo-test/tiles/${brand.brand_id}.webp`
      }))
    });
  }

  duplicateGroups.sort((a, b) => b.count - a.count || a.kept.brand_id.localeCompare(b.kept.brand_id));
  return {
    missing,
    duplicateGroups,
    excludedBrandIds,
    duplicateAffectedBrandCount: duplicateGroups.reduce((sum, group) => sum + group.count, 0),
    excludedBrandCount: excludedBrandIds.size
  };
}

function buildQuestions(brands) {
  const questions = [];
  for (const brand of brands) {
    const options = makeOptions(brand, brands);
    if (options.length !== 4) continue;
    const base = {
      answer_brand_id: brand.brand_id,
      options: options.map((item) => ({ brand_id: item.brand_id })),
      industry: brand.industry,
      category: brand.category,
      similar_group: brand.similar_group,
      difficulty_rank: brand.difficulty_rank,
      popularity_score: brand.popularity_score
    };
    questions.push({
      id: `q_logo_to_brand_${brand.brand_id}_001`,
      type: "logo_to_brand",
      ...base
    });
    questions.push({
      id: `q_brand_to_logo_${brand.brand_id}_001`,
      type: "brand_to_logo",
      ...base
    });
  }
  return questions;
}

function buildClueQuestions(brands) {
  const questions = [];
  for (const brand of brands) {
    const prompt = String(brand.clue_prompt || "").trim();
    if (!prompt) continue;
    const options = makeClueOptions(brand, brands);
    if (options.length !== 4) continue;
    questions.push({
      id: `q_brand_clue_to_logo_${brand.brand_id}_001`,
      type: "brand_clue_to_logo",
      prompt,
      answer_brand_id: brand.brand_id,
      options: options.map((item) => ({ brand_id: item.brand_id })),
      industry: brand.industry,
      category: brand.category,
      similar_group: brand.similar_group
    });
  }
  return questions;
}

function copyDistLogos(brands) {
  ensureDir(distLogoDir);
  const missing = [];
  for (const brand of brands) {
    const source = path.join(tilesDir, `${brand.brand_id}.webp`);
    const target = path.join(distLogoDir, `${brand.brand_id}.webp`);
    if (!fs.existsSync(source)) {
      missing.push(brand.brand_id);
      continue;
    }
    copyFileWithRetry(source, target);
  }
  ensureDir(path.join(root, "dist"));
  fs.writeFileSync(path.join(root, "dist", "index.html"), "<!doctype html><title>Logo Assets</title>\n", "utf8");
  return missing;
}

function copyFileWithRetry(source, target, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.copyFileSync(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80 * attempt);
    }
  }
  throw lastError;
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
      category: question.category || answer.category || "",
      similar_group: question.similar_group || answer.similar_group || "",
      prompt: question.prompt || "",
      logo: localReviewLogo(question.answer_brand_id),
      remote_logo: logoUrl(question.answer_brand_id),
      brand_name: answer.display_name || question.answer_brand_id,
      options: (question.options || []).map((option, index) => {
        const brand = brandMap.get(option.brand_id) || {};
        return {
          brand_id: option.brand_id,
          name: brand.display_name || option.brand_id,
          image: localReviewLogo(option.brand_id),
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
    logo_base_url: cdnBase,
    brand_count: brands.length,
    question_count: questions.length,
    type_counts: typeCounts,
    industry_counts: industryCounts,
    questions: reviewQuestions
  };
  ensureDir(reviewDir);
  fs.writeFileSync(questionReviewFile, `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>题目审核 - 识标挑战</title>
  <style>
    :root { color-scheme: light; --green:#58cc02; --blue:#1cb0f6; --text:#263238; --muted:#7c8794; --line:#e5e7eb; --bg:#f6f8fb; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    header { position: sticky; top: 0; z-index: 5; padding: 18px 22px; background: rgba(246,248,251,.96); border-bottom: 1px solid var(--line); backdrop-filter: blur(8px); }
    h1 { margin: 0 0 12px; font-size: 22px; }
    .summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; color: var(--muted); font-size: 13px; }
    .pill { padding: 5px 10px; border-radius: 999px; background: #fff; border: 1px solid var(--line); }
    .filters { display: grid; grid-template-columns: minmax(180px, 1fr) 180px 180px 180px; gap: 10px; max-width: 980px; }
    input, select { height: 36px; border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 0 10px; font: inherit; }
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
    .question-logo { height: 148px; display:flex; align-items:center; justify-content:center; border:1px solid var(--line); border-radius: 12px; background:#fff; margin-bottom: 12px; }
    .question-logo img { width: 126px; height: 126px; object-fit: contain; }
    .logo-options { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .logo-option { position:relative; min-height: 124px; display:flex; align-items:center; justify-content:center; border:1px solid var(--line); border-radius: 12px; padding: 16px; background:#fff; }
    .logo-option img { width: 92px; height: 92px; object-fit: contain; }
    .text-options { display: grid; gap: 8px; }
    .text-option { display:flex; align-items:center; gap: 10px; min-height: 42px; padding: 8px 10px; border:1px solid var(--line); border-radius: 10px; }
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
      <span class="pill">线索推理：${typeCounts.brand_clue_to_logo || 0}</span>
      <span class="pill" id="visibleCount"></span>
    </div>
    <div class="filters">
      <input id="search" placeholder="搜索品牌名 / brand_id / 题目 ID">
      <select id="type"><option value="">全部题型</option><option value="logo_to_brand">基础识别</option><option value="brand_to_logo">反向记忆</option><option value="brand_clue_to_logo">线索推理</option></select>
      <select id="industry"><option value="">全部行业</option></select>
      <select id="category"><option value="">全部小分类</option></select>
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
    const categorySelect = document.getElementById('category');
    const typeLabel = { logo_to_brand: '基础识别', brand_to_logo: '反向记忆', brand_clue_to_logo: '线索推理' };
    function addOptions(select, values) {
      Object.entries(values).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])).forEach(([name, count]) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name + ' (' + count + ')';
        select.appendChild(option);
      });
    }
    function counts(field) {
      return data.questions.reduce((map, question) => {
        const key = question[field] || '未分类';
        map[key] = (map[key] || 0) + 1;
        return map;
      }, {});
    }
    addOptions(industrySelect, data.industry_counts);
    addOptions(categorySelect, counts('category'));
    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
    }
    function renderCard(question) {
      const cls = 'card ' + question.type;
      const meta = '<div class="meta"><span>' + escapeHtml(question.industry || '未分类') + '</span><span>' + escapeHtml(question.category || '') + '</span><span>' + escapeHtml(question.answer_brand_id) + '</span></div>';
      if (question.type === 'brand_to_logo' || question.type === 'brand_clue_to_logo') {
        const prompt = question.type === 'brand_clue_to_logo'
          ? escapeHtml(question.prompt || '根据线索选择对应的 Logo')
          : '请选择 <span class="answer">' + escapeHtml(question.brand_name) + '</span> 对应的 Logo';
        return '<article class="' + cls + '"><div class="card-head"><div class="qid">' + escapeHtml(question.id) + '</div><div class="type">' + typeLabel[question.type] + '</div></div><div class="prompt">' + prompt + '</div><div class="logo-options">' + question.options.map(option => '<div class="logo-option ' + (option.correct ? 'correct' : '') + '"><span class="letter">' + option.letter + '</span><img src="' + escapeHtml(option.image) + '" loading="lazy" alt="' + escapeHtml(option.name) + '"></div>').join('') + '</div>' + meta + '</article>';
      }
      return '<article class="' + cls + '"><div class="card-head"><div class="qid">' + escapeHtml(question.id) + '</div><div class="type">' + typeLabel[question.type] + '</div></div><div class="prompt">请选择该 Logo 对应的品牌</div><div class="question-logo"><img src="' + escapeHtml(question.logo) + '" loading="lazy" alt="' + escapeHtml(question.answer_name) + '"></div><div class="text-options">' + question.options.map(option => '<div class="text-option ' + (option.correct ? 'correct' : '') + '"><span class="letter">' + option.letter + '</span><span>' + escapeHtml(option.name) + '</span></div>').join('') + '</div>' + meta + '</article>';
    }
    function applyFilters() {
      const term = searchInput.value.trim().toLowerCase();
      const type = typeSelect.value;
      const industry = industrySelect.value;
      const category = categorySelect.value;
      const filtered = data.questions.filter(question => {
        if (type && question.type !== type) return false;
        if (industry && question.industry !== industry) return false;
        if (category && question.category !== category) return false;
        if (!term) return true;
        return [question.id, question.answer_brand_id, question.answer_name, question.industry, question.category, question.similar_group].some(value => String(value || '').toLowerCase().includes(term))
          || question.options.some(option => [option.brand_id, option.name].some(value => String(value || '').toLowerCase().includes(term)));
      });
      visibleCount.textContent = '当前显示：' + filtered.length;
      grid.innerHTML = filtered.map(renderCard).join('');
      empty.style.display = filtered.length ? 'none' : 'block';
    }
    searchInput.addEventListener('input', applyFilters);
    typeSelect.addEventListener('change', applyFilters);
    industrySelect.addEventListener('change', applyFilters);
    categorySelect.addEventListener('change', applyFilters);
    applyFilters();
  </script>
</body>
</html>
`, "utf8");
}

function validate(brands, questions) {
  const brandIds = new Set(brands.map((brand) => brand.brand_id));
  const errors = [];
  for (const brand of brands) {
    if (!fs.existsSync(path.join(distLogoDir, `${brand.brand_id}.webp`))) errors.push({ brand_id: brand.brand_id, error: "missing_dist_logo" });
  }
  for (const question of questions) {
    if (!["logo_to_brand", "brand_to_logo", "brand_clue_to_logo"].includes(question.type)) errors.push({ question_id: question.id, error: "invalid_type" });
    if (!brandIds.has(question.answer_brand_id)) errors.push({ question_id: question.id, error: "answer_brand_missing" });
    if (!Array.isArray(question.options) || question.options.length !== 4) errors.push({ question_id: question.id, error: "option_count_not_4" });
    const optionIds = (question.options || []).map((option) => option.brand_id);
    if (new Set(optionIds).size !== optionIds.length) errors.push({ question_id: question.id, error: "duplicate_options" });
    if (!optionIds.includes(question.answer_brand_id)) errors.push({ question_id: question.id, error: "answer_not_in_options" });
  }
  return errors;
}

function build() {
  if (!fs.existsSync(csvFile)) throw new Error("logo_industry_brand_collection_MAX_flat.csv not found");
  const rows = readCsv(csvFile);
  const gridMap = loadGridMap();
  const brands = rows.map((row) => brandFromRow(row, gridMap));
  const allPublicBrands = brands.map(publicBrand);
  const duplicateAudit = findDuplicateLogoExclusions(allPublicBrands);
  const publicBrands = allPublicBrands.filter((brand) => !duplicateAudit.excludedBrandIds.has(brand.brand_id));
  const publicBrandIds = new Set(publicBrands.map((brand) => brand.brand_id));
  const clueBrands = brands.filter((brand) => publicBrandIds.has(brand.brand_id));
  const missingDistSources = copyDistLogos(publicBrands);
  const baseQuestions = buildQuestions(publicBrands);
  const clueQuestions = buildClueQuestions(clueBrands);
  const questions = baseQuestions.concat(clueQuestions);

  writeJs(path.join(quizDataDir, "brands.js"), publicBrands);
  writeJs(path.join(quizDataDir, "questions.js"), clueQuestions);
  writeJs(path.join(mainDataDir, "summary.js"), {
    brand_count: publicBrands.length,
    question_count: questions.length,
    logo_to_brand_count: questions.filter((q) => q.type === "logo_to_brand").length,
    brand_to_logo_count: questions.filter((q) => q.type === "brand_to_logo").length,
    brand_clue_to_logo_count: questions.filter((q) => q.type === "brand_clue_to_logo").length
  });
  writeQuizPreview(publicBrands, questions);

  const errors = validate(publicBrands, questions);
  const byIndustry = {};
  const byPriority = {};
  for (const brand of publicBrands) {
    byIndustry[brand.industry] = (byIndustry[brand.industry] || 0) + 1;
    byPriority[brand.priority] = (byPriority[brand.priority] || 0) + 1;
  }
  const report = {
    generated_at: new Date().toISOString(),
    source_csv: "logo_industry_brand_collection_MAX_flat.csv",
    source_tiles: "generated/logo-test/tiles",
    logo_base_url: cdnBase,
    original_brand_count: allPublicBrands.length,
    brand_count: publicBrands.length,
    question_count: questions.length,
    logo_to_brand_count: questions.filter((q) => q.type === "logo_to_brand").length,
    brand_to_logo_count: questions.filter((q) => q.type === "brand_to_logo").length,
    brand_clue_to_logo_count: questions.filter((q) => q.type === "brand_clue_to_logo").length,
    dist_logo_dir: "dist/logos/v20260620r2",
    duplicate_logo_group_count: duplicateAudit.duplicateGroups.length,
    duplicate_logo_affected_brand_count: duplicateAudit.duplicateAffectedBrandCount,
    duplicate_logo_excluded_brand_count: duplicateAudit.excludedBrandCount,
    duplicate_logo_exclusion_report: "reports/logo-duplicate-exclusion-report.json",
    missing_dist_source_count: missingDistSources.length,
    missing_dist_sources: missingDistSources.slice(0, 50),
    validation_error_count: errors.length,
    validation_errors: errors.slice(0, 100),
    by_industry: byIndustry,
    by_priority: byPriority
  };
  writeJson(buildReportFile, report);
  writeJson(duplicateExclusionReportFile, {
    generated_at: report.generated_at,
    original_brand_count: allPublicBrands.length,
    kept_brand_count: publicBrands.length,
    duplicate_group_count: duplicateAudit.duplicateGroups.length,
    duplicate_affected_brand_count: duplicateAudit.duplicateAffectedBrandCount,
    excluded_brand_count: duplicateAudit.excludedBrandCount,
    missing_tile_source_count: duplicateAudit.missing.length,
    missing_tile_sources: duplicateAudit.missing,
    duplicate_groups: duplicateAudit.duplicateGroups
  });
  writeJson(validationReportFile, {
    generated_at: report.generated_at,
    brand_count: publicBrands.length,
    question_count: questions.length,
    valid: errors.length === 0,
    error_count: errors.length,
    errors: errors.slice(0, 300)
  });

  if (errors.length) {
    console.error(`quiz data validation failed: ${errors.length}`);
    process.exitCode = 1;
    return;
  }
  console.log(`logo-test quiz data built: ${publicBrands.length} brands, ${questions.length} questions`);
}

build();
