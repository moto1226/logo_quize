const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("csv-parse/sync");

const root = path.resolve(__dirname, "..");
const csvFile = path.join(root, "logo_industry_brand_collection_MAX_flat.csv");
const logoDir = path.join(root, "dist", "logos", "v20260620r2");
const reportDir = path.join(root, "reports");
const reviewDir = path.join(root, "review");
const jsonFile = path.join(reportDir, "logo-manual-asset-issues.json");
const htmlFile = path.join(reviewDir, "logo-manual-asset-issues.html");

const issues = [
  { brand_id: "al_jazeera", issue_type: "blur", issue_label: "图片模糊" },
  { brand_id: "bloomberg", issue_type: "blur", issue_label: "图片模糊" },
  { brand_id: "cn_882c305e", issue_type: "blur", issue_label: "图片模糊" },
  { brand_id: "cn_992b39c4", issue_type: "blur", issue_label: "图片模糊" },
  { brand_id: "himalaya", issue_type: "blur", issue_label: "图片模糊" },
  { brand_id: "vcg", issue_type: "blur", issue_label: "图片模糊" },
  { brand_id: "wired", issue_type: "blur", issue_label: "图片模糊" },
  { brand_id: "zaker", issue_type: "blur", issue_label: "图片模糊" },

  { brand_id: "aesop", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "amazon", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "citibank", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "cisco", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "cn_b0ec25ac", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "cn_bf699c32", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "columbia_university", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "lazada", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "peking_university", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "tsinghua_university", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "ucla", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "uc_berkeley", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "university_of_tokyo", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" },
  { brand_id: "wanda", issue_type: "crop_or_border", issue_label: "边框 / 裁切 / 不居中 / 残缺" }
];

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readRows() {
  return parse(fs.readFileSync(csvFile, "utf8"), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

function buildHtml(data, summary) {
  const cards = data.map((item) => `
    <article class="card ${item.issue_type}">
      <img src="../${item.file.replace(/\\/g, "/")}" loading="lazy" alt="">
      <div class="body">
        <div class="tag">${htmlEscape(item.issue_label)}</div>
        <h2>${htmlEscape(item.name)}</h2>
        <p>${htmlEscape(item.brand_id)}</p>
        <p>${htmlEscape(item.category)}</p>
      </div>
    </article>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Logo 人工问题清单</title>
  <style>
    body{margin:0;background:#f6f7f9;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid #e5e7eb;padding:16px 20px}
    h1{margin:0 0 8px;font-size:22px}.summary{display:flex;gap:8px;flex-wrap:wrap;color:#667085;font-size:13px}.summary span{border:1px solid #e5e7eb;border-radius:999px;padding:5px 9px}
    main{padding:18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}.card.blur{border-color:#ff7875}.card.crop_or_border{border-color:#ffd591}
    img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#fff;border-bottom:1px solid #eef2f7}.body{padding:10px}.tag{display:inline-block;border-radius:999px;background:#f2f4f7;color:#344054;padding:4px 8px;font-size:12px;font-weight:700}h2{font-size:16px;margin:8px 0 4px;word-break:break-word}p{margin:3px 0;color:#667085;font-size:12px;word-break:break-word}
  </style>
</head>
<body>
  <header>
    <h1>Logo 人工问题清单</h1>
    <div class="summary">
      <span>总数 ${summary.total}</span>
      <span>图片模糊 ${summary.blur}</span>
      <span>边框/裁切/不居中/残缺 ${summary.crop_or_border}</span>
      <span>生成时间 ${htmlEscape(summary.generatedAt)}</span>
    </div>
  </header>
  <main>${cards}</main>
</body>
</html>`;
}

const rowMap = new Map(readRows().map((row) => [row.brand_id, row]));
const data = issues.map((issue) => {
  const row = rowMap.get(issue.brand_id) || {};
  const file = path.join(logoDir, `${issue.brand_id}.webp`);
  return {
    ...issue,
    name: row["品牌名称"] || row["英文名/常用名"] || issue.brand_id,
    category: [row["一级行业"], row["小分类名称"]].filter(Boolean).join(" / "),
    file: path.relative(root, file),
    exists: fs.existsSync(file)
  };
});

const summary = {
  total: data.length,
  blur: data.filter((item) => item.issue_type === "blur").length,
  crop_or_border: data.filter((item) => item.issue_type === "crop_or_border").length,
  missingFiles: data.filter((item) => !item.exists).length,
  generatedAt: new Date().toISOString()
};

fs.mkdirSync(reportDir, { recursive: true });
fs.mkdirSync(reviewDir, { recursive: true });
fs.writeFileSync(jsonFile, `${JSON.stringify({ summary, issues: data }, null, 2)}\n`, "utf8");
fs.writeFileSync(htmlFile, buildHtml(data, summary), "utf8");
console.log(JSON.stringify(summary, null, 2));
