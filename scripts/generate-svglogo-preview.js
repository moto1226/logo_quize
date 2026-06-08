const fs = require("node:fs");
const path = require("node:path");
const {
  root,
  indexJson,
  matchesCsv,
  readJson,
  readCsv,
  writeJson,
  ensureDir,
  htmlEscape,
  isProcessableSvglogo
} = require("./svglogo-common");

function main() {
  const allIndexRows = readJson(indexJson);
  const indexRows = allIndexRows.filter(isProcessableSvglogo);
  const matches = fs.existsSync(matchesCsv) ? readCsv(matchesCsv) : [];
  const buildReportFile = path.join(root, "reports", "svglogo-build-candidates-report.json");
  const buildReport = fs.existsSync(buildReportFile) ? readJson(buildReportFile) : { entries: [] };
  const matchReportFile = path.join(root, "reports", "svglogo-match-report.json");
  const matchReport = fs.existsSync(matchReportFile) ? readJson(matchReportFile) : { matched_brands: [], missing_in_svglogo: [] };
  const matchById = new Map();
  for (const match of matches) {
    if (!matchById.has(match.svglogo_id)) matchById.set(match.svglogo_id, []);
    matchById.get(match.svglogo_id).push(match);
  }
  const converted = new Set(buildReport.entries.filter((row) => row.status === "converted").map((row) => row.svglogo_id));
  const categories = [...new Set(indexRows.map((row) => row.category_raw))].sort();

  const sections = categories.map((category) => {
    const rows = indexRows.filter((row) => row.category_raw === category);
    return `<section class="group" data-category="${htmlEscape(category)}"><h2>${htmlEscape(category)} <span>${rows.length}</span></h2><div class="grid">${rows.map((row) => {
      const rowMatches = matchById.get(row.svglogo_id) || [];
      const isRecommended = rowMatches.some((match) => match.recommended === "true");
      const webpFile = `assets/_candidates/svglogo/${row.category_raw}/${row.svglogo_id}.webp`;
      const webpExists = converted.has(row.svglogo_id) && fs.existsSync(path.join(root, webpFile));
      return `<article class="card ${row.is_wordmark === "true" ? "wordmark" : ""}" data-id="${htmlEscape(row.svglogo_id)}" data-category="${htmlEscape(row.category_raw)}" data-static-wordmark="${htmlEscape(row.is_wordmark)}" data-matched="${rowMatches.length ? "true" : "false"}" data-recommended="${isRecommended ? "true" : "false"}">
        <div class="badges">
          ${row.is_wordmark === "true" ? '<span class="badge warn">WORDMARK</span>' : ""}
          <span class="badge manual" hidden>MANUAL WORDMARK</span>
          ${rowMatches.length ? '<span class="badge ok">MATCHED</span>' : ""}
          ${isRecommended ? '<span class="badge rec">RECOMMENDED</span>' : ""}
        </div>
        <div class="image-box">${webpExists ? `<img src="../${htmlEscape(webpFile)}" alt="${htmlEscape(row.title)}">` : "<span>Missing WebP</span>"}</div>
        <div class="actions">
          <button type="button" class="mark-wordmark">标为 WORDMARK</button>
          <button type="button" class="unmark-wordmark" hidden>取消标注</button>
        </div>
        <h3>${htmlEscape(row.title || row.file_name)}</h3>
        <dl>
          <div><dt>category_raw</dt><dd>${htmlEscape(row.category_raw)}</dd></div>
          <div><dt>file_name</dt><dd>${htmlEscape(row.file_name)}</dd></div>
          <div><dt>variant</dt><dd>${htmlEscape(row.variant)}</dd></div>
          <div><dt>is_wordmark</dt><dd>${htmlEscape(row.is_wordmark)}</dd></div>
          <div><dt>url</dt><dd>${htmlEscape(row.url)}</dd></div>
          <div><dt>svglogo_id</dt><dd>${htmlEscape(row.svglogo_id)}</dd></div>
          <div><dt>matched seed</dt><dd>${htmlEscape(rowMatches.map((match) => match.brand_id).join(", "))}</dd></div>
        </dl>
      </article>`;
    }).join("")}</div></section>`;
  }).join("");

  const wordmarkCount = indexRows.filter((row) => row.is_wordmark === "true").length;
  const categoryOptions = categories.map((category) => `<option value="${htmlEscape(category)}">${htmlEscape(category)}</option>`).join("");
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SVGLOGO Preview</title>
  <style>
    :root { --bg:#eef0f3; --card:#fff; --ink:#20242a; --muted:#69717c; --line:#d9dee5; --ok:#0f766e; --warn:#a16207; --rec:#1d4ed8; --manual:#be123c; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:"Segoe UI",system-ui,sans-serif; }
    header { position:sticky; top:0; z-index:2; background:rgba(238,240,243,.94); backdrop-filter:blur(10px); border-bottom:1px solid var(--line); padding:18px 24px; }
    h1 { margin:0 0 14px; font-size:22px; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
    .stat { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
    .stat b { display:block; font-size:20px; }
    .stat span, dt { color:var(--muted); font-size:12px; }
    .controls { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-top:14px; align-items:end; }
    .control { display:grid; gap:5px; }
    label { color:var(--muted); font-size:12px; }
    select, input, button { min-height:34px; border:1px solid var(--line); border-radius:6px; background:#fff; color:var(--ink); font:inherit; font-size:13px; }
    select, input { padding:0 9px; }
    button { padding:0 10px; cursor:pointer; }
    button:hover { border-color:#9aa3af; }
    main { padding:22px 24px 44px; }
    .group { margin-bottom:28px; }
    h2 { font-size:18px; margin:0 0 12px; }
    h2 span { color:var(--muted); font-weight:500; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:12px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px; }
    .badges { min-height:24px; display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
    .badge { border-radius:999px; padding:3px 7px; font-size:11px; font-weight:700; }
    .ok { background:#e7f6f3; color:var(--ok); }
    .warn { background:#fef3c7; color:var(--warn); }
    .rec { background:#dbeafe; color:var(--rec); }
    .manual { background:#ffe4e6; color:var(--manual); }
    .image-box { width:100%; aspect-ratio:1; display:grid; place-items:center; background:#fff; border:1px solid var(--line); border-radius:6px; margin-bottom:10px; overflow:hidden; }
    img { max-width:86%; max-height:86%; object-fit:contain; }
    .image-box span { color:#98a1ad; font-size:12px; }
    .actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px; }
    .actions button { min-width:0; white-space:nowrap; }
    .card.manual-wordmark { border-color:#fecdd3; box-shadow:inset 0 0 0 1px #fecdd3; }
    .is-hidden { display:none !important; }
    h3 { font-size:15px; margin:0 0 8px; overflow-wrap:anywhere; }
    dl { display:grid; gap:6px; margin:0; }
    dd { margin:1px 0 0; font-size:12px; overflow-wrap:anywhere; }
    @media (max-width:700px) { header, main { padding-left:14px; padding-right:14px; } .grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>SVGLOGO Preview</h1>
    <div class="stats">
      <div class="stat"><b>${indexRows.length}</b><span>SVGLOGO 总资源数</span></div>
      <div class="stat"><b>${categories.length}</b><span>分类数量</span></div>
      <div class="stat"><b>${wordmarkCount}</b><span>wordmark 数量</span></div>
      <div class="stat"><b>${indexRows.length - wordmarkCount}</b><span>非 wordmark 数量</span></div>
      <div class="stat"><b>${indexRows.filter((row) => row.source_type === "orphan").length}</b><span>orphan 文件数量</span></div>
      <div class="stat"><b>${buildReport.converted_count || 0}</b><span>转换成功数量</span></div>
      <div class="stat"><b>${buildReport.failed_count || 0}</b><span>转换失败数量</span></div>
      <div class="stat"><b>${matchReport.matched_brand_count || 0}</b><span>匹配成功品牌数</span></div>
      <div class="stat"><b>${matchReport.missing_brand_count || 0}</b><span>未匹配品牌数</span></div>
      <div class="stat"><b id="manualWordmarkCount">0</b><span>手动 WORDMARK</span></div>
    </div>
    <div class="controls">
      <div class="control">
        <label for="categoryFilter">分类</label>
        <select id="categoryFilter">
          <option value="">全部分类</option>
          ${categoryOptions}
        </select>
      </div>
      <div class="control">
        <label for="wordmarkFilter">WORDMARK 状态</label>
        <select id="wordmarkFilter">
          <option value="">全部</option>
          <option value="wordmark">已有或手动 WORDMARK</option>
          <option value="manual">只看手动标注</option>
          <option value="not-wordmark">未标 WORDMARK</option>
        </select>
      </div>
      <div class="control">
        <label for="matchFilter">匹配状态</label>
        <select id="matchFilter">
          <option value="">全部</option>
          <option value="matched">已匹配 seed</option>
          <option value="recommended">Recommended</option>
          <option value="unmatched">未匹配 seed</option>
        </select>
      </div>
      <div class="control">
        <label for="searchBox">搜索</label>
        <input id="searchBox" type="search" placeholder="title / file / id">
      </div>
      <div class="control">
        <label>导出</label>
        <button type="button" id="exportAnnotations">导出手动标签 JSON</button>
      </div>
    </div>
  </header>
  <main>${sections}</main>
  <script>
    (() => {
      const storageKey = "svglogoPreviewManualWordmark:v1";
      const cards = [...document.querySelectorAll(".card")];
      const groups = [...document.querySelectorAll(".group")];
      const categoryFilter = document.getElementById("categoryFilter");
      const wordmarkFilter = document.getElementById("wordmarkFilter");
      const matchFilter = document.getElementById("matchFilter");
      const searchBox = document.getElementById("searchBox");
      const manualCount = document.getElementById("manualWordmarkCount");

      function readLabels() {
        try {
          const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
          return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
          return {};
        }
      }

      function writeLabels(labels) {
        localStorage.setItem(storageKey, JSON.stringify(labels));
      }

      let labels = readLabels();

      function isManual(card) {
        return labels[card.dataset.id]?.wordmark === true;
      }

      function isAnyWordmark(card) {
        return card.dataset.staticWordmark === "true" || isManual(card);
      }

      function applyCardState(card) {
        const manual = isManual(card);
        card.classList.toggle("manual-wordmark", manual);
        card.querySelector(".manual").hidden = !manual;
        card.querySelector(".mark-wordmark").hidden = manual;
        card.querySelector(".unmark-wordmark").hidden = !manual;
      }

      function refreshFilters() {
        const category = categoryFilter.value;
        const wordmark = wordmarkFilter.value;
        const match = matchFilter.value;
        const query = searchBox.value.trim().toLowerCase();
        let visibleManual = 0;

        cards.forEach((card) => {
          applyCardState(card);
          if (isManual(card)) visibleManual += 1;
          const text = card.textContent.toLowerCase();
          const anyWordmark = isAnyWordmark(card);
          const manual = isManual(card);
          const matched = card.dataset.matched === "true";
          const recommended = card.dataset.recommended === "true";
          const show =
            (!category || card.dataset.category === category) &&
            (!query || text.includes(query)) &&
            (!wordmark ||
              (wordmark === "wordmark" && anyWordmark) ||
              (wordmark === "manual" && manual) ||
              (wordmark === "not-wordmark" && !anyWordmark)) &&
            (!match ||
              (match === "matched" && matched) ||
              (match === "recommended" && recommended) ||
              (match === "unmatched" && !matched));
          card.classList.toggle("is-hidden", !show);
        });

        groups.forEach((group) => {
          const visibleCards = [...group.querySelectorAll(".card")].some((card) => !card.classList.contains("is-hidden"));
          group.classList.toggle("is-hidden", !visibleCards);
        });

        manualCount.textContent = String(visibleManual);
      }

      cards.forEach((card) => {
        card.querySelector(".mark-wordmark").addEventListener("click", () => {
          labels[card.dataset.id] = { wordmark: true, updated_at: new Date().toISOString() };
          writeLabels(labels);
          refreshFilters();
        });
        card.querySelector(".unmark-wordmark").addEventListener("click", () => {
          delete labels[card.dataset.id];
          writeLabels(labels);
          refreshFilters();
        });
      });

      [categoryFilter, wordmarkFilter, matchFilter, searchBox].forEach((control) => {
        control.addEventListener("input", refreshFilters);
        control.addEventListener("change", refreshFilters);
      });

      document.getElementById("exportAnnotations").addEventListener("click", () => {
        const manual_wordmark = cards
          .filter((card) => isManual(card))
          .map((card) => ({
            svglogo_id: card.dataset.id,
            category_raw: card.dataset.category,
            manual_wordmark: true,
            updated_at: labels[card.dataset.id]?.updated_at || ""
          }));
        const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), manual_wordmark }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "svglogo-manual-wordmark-labels.json";
        link.click();
        URL.revokeObjectURL(url);
      });

      refreshFilters();
    })();
  </script>
</body>
</html>
`;
  const output = path.join(root, "review", "svglogo-preview.html");
  ensureDir(path.dirname(output));
  require("node:fs").writeFileSync(output, html, "utf8");
  writeJson(path.join(root, "reports", "svglogo-preview-report.json"), {
    generated_at: new Date().toISOString(),
    output: "review/svglogo-preview.html",
    excluded_categories: ["other", "weather"],
    skipped_excluded_resources: allIndexRows.length - indexRows.length
  });
  console.log("Wrote review/svglogo-preview.html");
}

main();
