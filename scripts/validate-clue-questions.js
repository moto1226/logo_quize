const fs = require("node:fs");
const { parse } = require("csv-parse/sync");

const rows = parse(fs.readFileSync("logo_industry_brand_collection_MAX_flat.csv", "utf8"), {
  bom: true,
  columns: true,
  skip_empty_lines: true,
  trim: true
});

const badQuestionPattern = /如果只看业务方向|这类业务|灰色|争议|待筛|需人工|regulated|高风险行业|特殊行业|是的|时可结合|蓝绿科技色|醒目字标|视觉|Logo|图标|颜色|配色|符号|字母|轮廓|底色|字样|图形|绿色|蓝色|红色|黄色/i;
const badRows = rows.filter((row) => badQuestionPattern.test(row["描述题型问题文本"] || ""));
const brandHits = rows.filter((row) => {
  const question = row["描述题型问题文本"] || "";
  return (row["品牌名称"] && question.includes(row["品牌名称"])) ||
    (row["英文名/常用名"] && question.includes(row["英文名/常用名"]));
});

const html = fs.readFileSync("review/clue-question-bank-audit.html", "utf8");
const match = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
const data = match ? JSON.parse(match[1]) : [];
const high = data.filter((item) => item.risk.level === "high");
const medium = data.filter((item) => item.risk.level === "medium");
const sameCategory = data.filter((item) => item.risk.sameCategoryCount);
const duplicateQuestion = data.filter((item) => item.risk.duplicateQuestionCount);
const closeDistractors = data.filter((item) => item.risk.closeDistractors);

console.log(JSON.stringify({
  csvRows: rows.length,
  csvColumns: Object.keys(rows[0] || {}).length,
  badQuestions: badRows.length,
  brandHits: brandHits.length,
  htmlQuestions: data.length,
  htmlHighRisk: high.length,
  htmlMediumRisk: medium.length,
  sameCategoryDistractors: sameCategory.length,
  duplicateQuestionSets: duplicateQuestion.length,
  closeDistractorSets: closeDistractors.length
}, null, 2));

if (badRows.length) {
  console.log("bad question samples:");
  console.log(badRows.slice(0, 10).map((row) => `${row.brand_id}: ${row["描述题型问题文本"]}`).join("\n"));
}

console.log("sensitive samples:");
console.log(data
  .filter((item) => /灰色|争议|待筛|成人|烟草|武器|约会/.test(`${item.category} ${item.question}`))
  .slice(0, 12)
  .map((item) => `${item.answer_brand_id} | ${item.category} | ${item.question}`)
  .join("\n"));

const sampleIds = new Set(["sany", "cn_cfbf6f4c", "twitch", "google_maps"]);
console.log("selected samples:");
console.log(data
  .filter((item) => sampleIds.has(item.answer_brand_id))
  .map((item) => [
    `${item.answer_brand_id} | ${item.question}`,
    ...item.options.map((option) => `  - ${option.name} | ${option.category} | ${option.question}${option.correct ? " | 答案" : ""}`)
  ].join("\n"))
  .join("\n"));
