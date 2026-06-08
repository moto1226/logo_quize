const fs = require("node:fs");
const path = require("node:path");
const {
  root,
  seedRows,
  readJson,
  writeJson,
  ensureDir,
  htmlEscape
} = require("./logo-candidates-common");

function main() {
  const indexFile = path.join(root, "data", "logo_candidates_index.json");
  const rows = fs.existsSync(indexFile) ? readJson(indexFile) : [];
  const brands = seedRows();
  const byBrand = new Map();
  for (const row of rows) {
    if (!byBrand.has(row.brand_id)) byBrand.set(row.brand_id, []);
    byBrand.get(row.brand_id).push(row);
  }
  const bySource = {};
  for (const row of rows) bySource[row.source_type] = (bySource[row.source_type] || 0) + 1;
  const groups = [...new Set(brands.map((brand) => brand.similar_group))].sort();
  const missing = brands.filter((brand) => !byBrand.has(brand.brand_id)).map((brand) => brand.brand_id);
  const sections = groups.map((group) => {
    const groupBrands = brands.filter((brand) => brand.similar_group === group);
    return `<section><h2>${htmlEscape(group)} <span>${groupBrands.filter((brand) => byBrand.has(brand.brand_id)).length}/${groupBrands.length}</span></h2>${groupBrands.map((brand) => {
      const candidates = byBrand.get(brand.brand_id) || [];
      return `<article class="brand"><h3>${htmlEscape(brand.brand_id)} <span>${htmlEscape(brand.name_en)} / ${htmlEscape(brand.name_zh)}</span></h3><div class="grid">${candidates.length ? candidates.map((item) => {
        const img = item.webp_file && fs.existsSync(path.join(root, item.webp_file)) ? `<img src="../${htmlEscape(item.webp_file)}" alt="${htmlEscape(item.candidate_id)}">` : "<span>Missing file</span>";
        const textWarn = item.has_visible_text !== "false" || item.is_wordmark === "true";
        return `<div class="card ${textWarn ? "warn-card" : ""}">
          <div class="image">${img}</div>
          <b>${htmlEscape(item.source_type)}</b>
          <dl>
            <div><dt>license</dt><dd>${htmlEscape(item.license)}</dd></div>
            <div><dt>wordmark</dt><dd>${htmlEscape(item.is_wordmark)}</dd></div>
            <div><dt>visible text</dt><dd>${htmlEscape(item.has_visible_text)}</dd></div>
            <div><dt>status</dt><dd>${htmlEscape(item.review_status)}</dd></div>
            <div><dt>score</dt><dd>${htmlEscape(item.quality_score)}</dd></div>
            <div><dt>id</dt><dd>${htmlEscape(item.candidate_id)}</dd></div>
          </dl>
        </div>`;
      }).join("") : '<p class="empty">No candidates</p>'}</div></article>`;
    }).join("")}</section>`;
  }).join("");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logo Candidates Preview</title><style>
  body{margin:0;background:#eef0f3;color:#20242a;font-family:"Segoe UI",system-ui,sans-serif}header{position:sticky;top:0;z-index:2;background:rgba(238,240,243,.95);border-bottom:1px solid #d9dee5;padding:18px 24px}h1{margin:0 0 12px;font-size:22px}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.stat{background:white;border:1px solid #d9dee5;border-radius:8px;padding:10px}.stat b{display:block;font-size:20px}main{padding:22px 24px}section{margin-bottom:30px}h2{font-size:18px}h2 span,h3 span,dt,.empty{color:#69717c}.brand{margin-bottom:18px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}.card{background:#fff;border:1px solid #d9dee5;border-radius:8px;padding:10px}.warn-card{border-color:#fbbf24}.image{aspect-ratio:1;background:#fff;border:1px solid #d9dee5;border-radius:6px;display:grid;place-items:center;margin-bottom:8px;overflow:hidden}img{max-width:86%;max-height:86%;object-fit:contain}dl{display:grid;gap:5px;margin:8px 0 0}dd{margin:0;font-size:12px;overflow-wrap:anywhere}dt{font-size:11px}</style></head><body><header><h1>Logo Candidates Preview</h1><div class="stats"><div class="stat"><b>${rows.length}</b><span>总候选数</span></div><div class="stat"><b>${Object.entries(bySource).map(([k,v]) => `${htmlEscape(k)}:${v}`).join(" ")}</b><span>各来源候选数</span></div><div class="stat"><b>${brands.length - missing.length}/${brands.length}</b><span>有候选品牌</span></div><div class="stat"><b>${missing.length}</b><span>没有候选图品牌</span></div></div></header><main>${sections}</main></body></html>`;
  const output = path.join(root, "review", "logo-candidates-preview.html");
  ensureDir(path.dirname(output));
  fs.writeFileSync(output, html, "utf8");
  writeJson(path.join(root, "reports", "logo-candidates-preview-report.json"), { generated_at: new Date().toISOString(), output: "review/logo-candidates-preview.html" });
  console.log("Wrote review/logo-candidates-preview.html");
}

main();
