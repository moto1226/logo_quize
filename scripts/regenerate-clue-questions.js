const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");

const root = path.resolve(__dirname, "..");
const csvFile = path.join(root, "logo_industry_brand_collection_MAX_flat.csv");
const reviewFile = path.join(root, "review", "clue-question-bank-audit.html");
const logoDir = "../dist/logos/v20260620r2";

const internalSource = "灰色|争议|待筛|待筛选|需人工判断|需谨慎筛选|需合规筛选|regulated|高风险行业|特殊行业|人工校验|合规/敏感|信息收集阶段|启发式估计";
const visualSource = "logo|Logo|视觉|识别|图标|图形|符号|字母|字样|轮廓|底色|配色|颜色|主色|绿色|蓝色|红色|黄色|灰色|黑色|白色|橙色|紫色|粉色|几何|圆角|高对比色|播放符号|醒目字标|蓝绿科技色|时可结合";
const awkwardSource = "是的|面向是|围绕是|更接近是|、是|/亚洲的|/华语圈的";
const internalPattern = new RegExp(internalSource, "i");
const visualPattern = new RegExp(visualSource, "i");
const awkwardPattern = new RegExp(awkwardSource, "i");
const internalReplacePattern = new RegExp(internalSource, "gi");
const visualReplacePattern = new RegExp(visualSource, "gi");
const awkwardReplacePattern = new RegExp(awkwardSource, "gi");
const phraseCache = new WeakMap();
const tokenCache = new WeakMap();

const categoryRules = [
  [/成人|Adult|Porn/i, "成人内容或成人消费服务"],
  [/烟草|尼古丁|Vape/i, "受监管的烟草、尼古丁或替代消费品"],
  [/武器|防务|枪|Tactical/i, "防务装备、户外安全或战术消费品"],
  [/博彩|赌场|竞猜|Lottery|Bet/i, "博彩娱乐、竞猜或抽奖服务"],
  [/约会|婚恋|社交匹配|Dating/i, "约会交友、社交匹配或关系建立服务"],
  [/灰色|争议|待筛/i, "匿名社区、开放内容发布或文件获取服务"],
  [/社交平台|即时通讯|社区/i, "即时沟通、社区互动和社交关系"],
  [/短视频|直播|视频平台|流媒体/i, "视频内容、直播互动和创作者经营"],
  [/搜索|浏览器/i, "信息搜索、网页入口和在线浏览"],
  [/办公协作|项目管理|会议|文档/i, "团队协作、文档项目和会议沟通"],
  [/云计算|云服务|服务器|主机/i, "云服务器、企业基础设施和数据托管"],
  [/AI|大模型|人工智能|机器学习/i, "智能对话、生成式内容和自动化工具"],
  [/地图|导航/i, "地图导航、本地搜索和出行路线"],
  [/电商|购物|零售|Marketplace/i, "在线购物、商家交易和商品履约"],
  [/外卖|本地生活|餐饮配送/i, "餐饮配送、本地生活和即时履约"],
  [/支付|金融科技|钱包/i, "移动支付、数字钱包和金融服务入口"],
  [/银行|证券|保险|资管/i, "金融账户、交易服务和资产管理"],
  [/汽车|新能源车|车企/i, "车辆制造、出行产品和汽车服务"],
  [/航空|机场|铁路|航运/i, "客运交通、航线网络和出行服务"],
  [/酒店|旅游|OTA|旅行/i, "旅行预订、住宿服务和目的地体验"],
  [/餐饮|咖啡|茶饮|快餐/i, "门店餐饮、饮品消费和连锁服务"],
  [/食品|零食|饮料|酒/i, "包装食品、饮品消费和日常零售"],
  [/服装|鞋|奢侈|美妆|护肤/i, "时尚消费、个人形象和零售门店"],
  [/运动|户外|健身/i, "运动装备、健身训练和户外生活"],
  [/游戏|电竞/i, "游戏内容、互动娱乐和玩家社区"],
  [/教育|学习|课程/i, "课程学习、培训服务和知识工具"],
  [/医疗|健康|药/i, "健康服务、药品护理和医疗支持"],
  [/能源|石油|电力|电池/i, "能源供应、工业基础设施和动力服务"],
  [/农业|农化|种子|作物/i, "作物种植、农业投入品和农场服务"],
  [/工业|制造|机械|自动化/i, "工业制造、设备系统和企业生产"],
  [/物流|快递|供应链/i, "包裹运输、仓储配送和供应链服务"],
  [/媒体|新闻|出版/i, "新闻内容、媒体传播和公共信息"],
  [/音乐|播客|音频/i, "音乐音频、内容订阅和听觉娱乐"],
  [/设计|创意|图片|图库/i, "创意设计、素材管理和内容制作"],
  [/开发者|代码|开源|API/i, "软件开发、代码协作和技术工具"]
];

function readRows() {
  return parse(fs.readFileSync(csvFile, "utf8"), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

function cleanText(value) {
  return String(value || "")
    .replace(internalReplacePattern, "")
    .replace(visualReplacePattern, "")
    .replace(awkwardReplacePattern, "")
    .replace(/[；;].*$/g, "")
    .replace(/[（）()【】\[\]]/g, "")
    .replace(/\s+/g, "")
    .replace(/\/+/g, "/")
    .replace(/、+/g, "、")
    .replace(/^、|、$/g, "")
    .trim();
}

function splitParts(value) {
  return cleanText(value)
    .split(/[、,，/]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part.length >= 2 && !internalPattern.test(part) && !visualPattern.test(part));
}

function phraseFromRule(row) {
  const category = row["小分类名称"] || "";
  const categoryRule = categoryRules.find(([pattern]) => pattern.test(category));
  if (categoryRule) return categoryRule[1];
  const source = [row["三级场景"], row["一级行业"]].join(" ");
  const fallbackRule = categoryRules.find(([pattern]) => pattern.test(source));
  return fallbackRule ? fallbackRule[1] : "";
}

function genericPhrase(row) {
  const categoryParts = splitParts(row["小分类名称"]).slice(0, 2);
  const sceneParts = splitParts(row["三级场景"]).slice(0, 2);
  const industryParts = splitParts(row["一级行业"]).filter((p) => !/其他|待定|综合/.test(p)).slice(0, 1);
  const parts = [...categoryParts, ...sceneParts, ...industryParts]
    .filter((part, index, arr) => arr.indexOf(part) === index)
    .slice(0, 3);
  if (parts.length) return parts.join("、");
  return "该品牌所属的核心业务和用户场景";
}

function makeQuestion(row) {
  let phrase = phraseFromRule(row) || genericPhrase(row);
  phrase = cleanText(phrase).replace(/、+/g, "、").replace(/^、|、$/g, "");
  if (!phrase || phrase.length < 6) phrase = genericPhrase(row);
  const templates = [
    `哪一个主要服务于${phrase}？`,
    `哪一个更接近${phrase}？`,
    `哪个品牌围绕${phrase}展开？`
  ];
  const index = stableNumber(row.brand_id || row["品牌名称"]) % templates.length;
  return templates[index].replace(/、、/g, "、").replace(/？+/g, "？");
}

function cluePhrase(row) {
  if (phraseCache.has(row)) return phraseCache.get(row);
  const phrase = cleanText(phraseFromRule(row) || genericPhrase(row)).replace(/、+/g, "、").replace(/^、|、$/g, "");
  phraseCache.set(row, phrase);
  return phrase;
}

function clueTokens(row) {
  if (tokenCache.has(row)) return tokenCache.get(row);
  const tokens = cluePhrase(row)
    .split(/[、,，/和或及]+/g)
    .map((part) => cleanText(part))
    .filter((part) => part.length >= 2)
    .filter((part, index, arr) => arr.indexOf(part) === index);
  tokenCache.set(row, tokens);
  return tokens;
}

function clueSimilarity(a, b) {
  const left = clueTokens(a);
  const right = clueTokens(b);
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const intersection = left.filter((token) => rightSet.has(token)).length;
  return intersection / Math.max(left.length, right.length);
}

function stableNumber(seed) {
  let state = 2166136261;
  for (const ch of String(seed || "")) {
    state ^= ch.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return state >>> 0;
}

function shuffleStable(items, seed) {
  let state = stableNumber(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function optionBrand(row, correct) {
  return {
    brand_id: row.brand_id,
    name: row["品牌名称"] || row["英文名/常用名"] || row.brand_id,
    industry: row["一级行业"] || "",
    category: row["小分类名称"] || "",
    scene: row["三级场景"] || "",
    question: row["描述题型问题文本"] || "",
    correct
  };
}

function chooseDistractors(row, rows) {
  const answerCategory = row["小分类名称"] || "";
  const answerIndustry = row["一级行业"] || "";
  const answerQuestion = row["描述题型问题文本"] || "";
  const answerPhrase = cluePhrase(row);
  const selected = [];
  const usedCategories = new Set([answerCategory]);
  const usedPhrases = new Set([answerPhrase]);
  const candidates = shuffleStable(
    rows.filter((item) => {
      if (item.brand_id === row.brand_id) return false;
      if ((item["小分类名称"] || "") === answerCategory) return false;
      if ((item["描述题型问题文本"] || "") === answerQuestion) return false;
      if (cluePhrase(item) === answerPhrase) return false;
      return clueSimilarity(row, item) < 0.34;
    }),
    row.brand_id
  ).sort((a, b) => {
    const sameIndustryA = (a["一级行业"] || "") === answerIndustry ? 1 : 0;
    const sameIndustryB = (b["一级行业"] || "") === answerIndustry ? 1 : 0;
    const scoreA = clueSimilarity(row, a) + sameIndustryA * 0.5;
    const scoreB = clueSimilarity(row, b) + sameIndustryB * 0.5;
    return scoreA - scoreB;
  });
  for (const candidate of candidates) {
    const category = candidate["小分类名称"] || "";
    const phrase = cluePhrase(candidate);
    if (usedCategories.has(category)) continue;
    if (usedPhrases.has(phrase)) continue;
    if (selected.some((item) => clueSimilarity(item, candidate) >= 0.34 || cluePhrase(item) === phrase)) continue;
    usedCategories.add(category);
    usedPhrases.add(phrase);
    selected.push(candidate);
    if (selected.length === 3) break;
  }
  if (selected.length < 3) {
    const fallback = shuffleStable(
      rows.filter((item) => item.brand_id !== row.brand_id && !selected.includes(item)),
      `${row.brand_id}:fallback`
    ).sort((a, b) => clueSimilarity(row, a) - clueSimilarity(row, b));
    for (const candidate of fallback) {
      const category = candidate["小分类名称"] || "";
      const phrase = cluePhrase(candidate);
      if (selected.includes(candidate)) continue;
      if (usedCategories.has(category)) continue;
      if (usedPhrases.has(phrase)) continue;
      if (clueSimilarity(row, candidate) >= 0.34) continue;
      if (selected.some((item) => clueSimilarity(item, candidate) >= 0.34 || cluePhrase(item) === phrase)) continue;
      selected.push(candidate);
      usedCategories.add(category);
      usedPhrases.add(phrase);
      if (selected.length === 3) break;
    }
  }
  return selected;
}

function riskFor(row, options) {
  const question = row["描述题型问题文本"] || "";
  const notes = [];
  if (internalPattern.test(question)) notes.push("包含内部审核词");
  if (visualPattern.test(question)) notes.push("包含视觉提示词");
  if (awkwardPattern.test(question)) notes.push("包含拼接残留词");
  if ((row["品牌名称"] && question.includes(row["品牌名称"])) || (row["英文名/常用名"] && question.includes(row["英文名/常用名"]))) notes.push("包含答案品牌名");
  const answerCategory = row["小分类名称"] || "";
  const sameCategoryCount = options.filter((option) => !option.correct && option.category === answerCategory).length;
  if (sameCategoryCount) notes.push("干扰项存在同分类");
  const optionQuestions = options.map((option) => option.question).filter(Boolean);
  const duplicateQuestionCount = optionQuestions.length - new Set(optionQuestions).size;
  if (duplicateQuestionCount) notes.push("选项题干重复");
  const answerPhrase = cluePhrase(row);
  const closeDistractors = options
    .filter((option) => !option.correct)
    .filter((option) => {
      const source = { "小分类名称": option.category, "三级场景": option.scene, "一级行业": option.industry };
      return cluePhrase(source) === answerPhrase || clueSimilarity(row, source) >= 0.34;
    }).length;
  if (closeDistractors) notes.push("干扰项业务线索过近");
  const level = notes.length ? "high" : question.length < 14 ? "medium" : "ok";
  return { level, notes, sameCategoryCount, duplicateQuestionCount, closeDistractors };
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

function buildHtml(data, stats) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>描述题型题库审核</title>
  <style>
    :root{--bg:#f6f7f9;--card:#fff;--line:#dfe5ee;--text:#111827;--muted:#667085;--ok:#18794e;--mid:#b76e00;--high:#b42318;--ok-bg:#edfdf5;--mid-bg:#fff7e6;--high-bg:#fff1f0}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header{position:sticky;top:0;z-index:10;background:rgba(246,247,249,.96);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:18px 22px}
    h1{margin:0 0 10px;font-size:24px}.summary{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;color:var(--muted);font-size:13px}.summary span{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 10px}.toolbar{display:grid;grid-template-columns:minmax(220px,1fr) 160px 170px 170px;gap:10px;max-width:1120px}input,select{height:40px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text);padding:0 12px;font-size:14px}
    main{padding:20px 22px 40px}.count{margin:0 0 14px;color:var(--muted);font-size:14px}.list{display:grid;gap:16px}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}.card.high{border-color:#ffa39e;background:var(--high-bg)}.card.medium{border-color:#ffd591;background:var(--mid-bg)}.head{padding:14px 14px 10px;border-bottom:1px solid var(--line)}.q{font-size:18px;font-weight:800;line-height:1.35;margin-bottom:8px}.meta{font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px}.pill{border-radius:999px;padding:4px 8px;font-weight:700}.pill.ok{background:var(--ok-bg);color:var(--ok)}.pill.medium{background:#fff0d2;color:var(--mid)}.pill.high{background:#ffe4e0;color:var(--high)}.risk-note{margin-top:8px;font-size:12px;color:var(--muted)}
    .options{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0}.option{border-right:1px solid var(--line);padding:10px;min-width:0}.option:last-child{border-right:0}.option.correct{box-shadow:inset 0 0 0 2px #40a85b}.option img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#fff;border:1px solid #eef2f7;border-radius:8px;display:block}.name{font-weight:800;margin-top:8px;word-break:break-word}.oid,.otype,.oq{font-size:12px;color:var(--muted);line-height:1.45;margin-top:4px;word-break:break-word}.oq{color:#344054}.empty{display:none;background:#fff;border:1px dashed var(--line);border-radius:8px;padding:28px;text-align:center;color:var(--muted)}
    @media(max-width:980px){.toolbar{grid-template-columns:1fr 1fr}.options{grid-template-columns:repeat(2,minmax(0,1fr))}.option:nth-child(2){border-right:0}.option{border-bottom:1px solid var(--line)}.option:nth-child(n+3){border-bottom:0}}
    @media(max-width:620px){header{position:static}.toolbar{grid-template-columns:1fr}.options{grid-template-columns:1fr}.option{border-right:0!important;border-bottom:1px solid var(--line)}.option:last-child{border-bottom:0}}
  </style>
</head>
<body>
  <header>
    <h1>描述题型题库审核（业务线索清洗版）</h1>
    <div class="summary">
      <span>题目 ${stats.total}</span>
      <span>高风险 ${stats.high}</span>
      <span>中风险 ${stats.medium}</span>
      <span>正常 ${stats.ok}</span>
      <span>生成时间 ${htmlEscape(new Date().toISOString())}</span>
    </div>
    <div class="toolbar">
      <input id="search" type="search" placeholder="搜索题目 / 品牌 / brand_id / 行业 / 分类">
      <select id="risk"><option value="all">全部风险</option><option value="high">只看高风险</option><option value="medium">只看中风险</option><option value="ok">只看正常</option></select>
      <select id="industry"><option value="all">全部行业</option></select>
      <select id="category"><option value="all">全部分类</option></select>
    </div>
  </header>
  <main>
    <p id="count" class="count"></p>
    <div id="list" class="list"></div>
    <div id="empty" class="empty">没有匹配的题目。</div>
  </main>
  <script id="data" type="application/json">${jsonScriptEscape(data)}</script>
  <script>
    const data = JSON.parse(document.getElementById("data").textContent);
    const list = document.getElementById("list");
    const count = document.getElementById("count");
    const empty = document.getElementById("empty");
    const search = document.getElementById("search");
    const risk = document.getElementById("risk");
    const industry = document.getElementById("industry");
    const category = document.getElementById("category");
    const industries = [...new Set(data.map(item => item.industry).filter(Boolean))].sort();
    const categories = [...new Set(data.map(item => item.category).filter(Boolean))].sort();
    industry.insertAdjacentHTML("beforeend", industries.map(v => \`<option value="\${escapeHtml(v)}">\${escapeHtml(v)}</option>\`).join(""));
    category.insertAdjacentHTML("beforeend", categories.map(v => \`<option value="\${escapeHtml(v)}">\${escapeHtml(v)}</option>\`).join(""));
    function escapeHtml(value){return String(value || "").replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[ch]));}
    function card(item){
      const riskText = item.risk.level === "high" ? "高风险" : item.risk.level === "medium" ? "中风险" : "正常";
      const options = item.options.map(option => \`
        <div class="option \${option.correct ? "correct" : ""}">
          <img src="${logoDir}/\${escapeHtml(option.brand_id)}.webp" loading="lazy" alt="">
          <div class="name">\${escapeHtml(option.name)} \${option.correct ? "（答案）" : ""}</div>
          <div class="oid">\${escapeHtml(option.brand_id)}</div>
          <div class="otype">\${escapeHtml(option.industry)} / \${escapeHtml(option.category)}</div>
          <div class="oq">\${escapeHtml(option.question)}</div>
        </div>\`).join("");
      return \`<article class="card \${item.risk.level}">
        <div class="head">
          <div class="q">\${escapeHtml(item.question)}</div>
          <div class="meta">
            <span class="pill \${item.risk.level}">\${riskText}</span>
            <span>\${escapeHtml(item.answer_name)}</span>
            <span>\${escapeHtml(item.answer_brand_id)}</span>
            <span>\${escapeHtml(item.industry)}</span>
            <span>\${escapeHtml(item.category)}</span>
          </div>
          \${item.risk.notes.length ? \`<div class="risk-note">\${escapeHtml(item.risk.notes.join("；"))}</div>\` : ""}
        </div>
        <div class="options">\${options}</div>
      </article>\`;
    }
    function render(){
      const q = search.value.trim().toLowerCase();
      const filtered = data.filter(item => {
        if (risk.value !== "all" && item.risk.level !== risk.value) return false;
        if (industry.value !== "all" && item.industry !== industry.value) return false;
        if (category.value !== "all" && item.category !== category.value) return false;
        if (!q) return true;
        return [item.question,item.answer_name,item.answer_brand_id,item.industry,item.category,item.scene].join(" ").toLowerCase().includes(q);
      });
      count.textContent = \`显示 \${filtered.length} / \${data.length} 题\`;
      list.innerHTML = filtered.slice(0, 500).map(card).join("");
      empty.style.display = filtered.length ? "none" : "block";
    }
    [search,risk,industry,category].forEach(el => el.addEventListener("input", render));
    render();
  </script>
</body>
</html>
`;
}

const rows = readRows();
const columns = Object.keys(rows[0] || {});

for (const row of rows) {
  row["描述题型问题文本"] = makeQuestion(row);
}

const auditData = rows.map((row) => {
  const distractors = chooseDistractors(row, rows);
  const options = shuffleStable([row, ...distractors], `${row.brand_id}:options`).map((item) => optionBrand(item, item === row));
  const risk = riskFor(row, options);
  return {
    id: `q_clue_${row.brand_id}`,
    answer_brand_id: row.brand_id,
    answer_name: row["品牌名称"] || row["英文名/常用名"] || row.brand_id,
    question: row["描述题型问题文本"],
    industry: row["一级行业"] || "",
    category: row["小分类名称"] || "",
    scene: row["三级场景"] || "",
    similar_group: row.similar_group || "",
    risk,
    options
  };
});

const stats = auditData.reduce((acc, item) => {
  acc.total += 1;
  acc[item.risk.level] += 1;
  return acc;
}, { total: 0, high: 0, medium: 0, ok: 0 });

fs.writeFileSync(csvFile, `\uFEFF${stringify(rows, { header: true, columns })}`, "utf8");
fs.mkdirSync(path.dirname(reviewFile), { recursive: true });
fs.writeFileSync(reviewFile, buildHtml(auditData, stats), "utf8");

console.log(JSON.stringify(stats, null, 2));
