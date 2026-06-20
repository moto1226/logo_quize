const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const report = JSON.parse(fs.readFileSync(path.join(root, "reports", "logo-similar-asset-issue-candidates.json"), "utf8"));
const outFile = path.join(root, "review", "logo-similar-candidates-contact.webp");
const logoDir = path.join(root, "dist", "logos", "v20260620r2");

const items = [
  ...report.candidates.filter((item) => item.issue_type === "blur").slice(0, 24),
  ...report.candidates.filter((item) => item.issue_type === "crop_or_border").slice(0, 48)
];

const cell = 190;
const labelHeight = 42;
const cols = 6;
const rows = Math.ceil(items.length / cols);
const width = cols * cell;
const height = rows * (cell + labelHeight);

function svgLabel(item) {
  const label = `${item.issue_type === "blur" ? "B" : "C"} ${item.brand_id}`.slice(0, 30);
  return Buffer.from(`<svg width="${cell}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="8" y="16" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#111827">${label}</text>
    <text x="8" y="34" font-family="Arial, sans-serif" font-size="11" fill="#667085">score ${item.score ?? "-"} off ${item.layout.offsetX}/${item.layout.offsetY}</text>
  </svg>`);
}

async function main() {
  const composites = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const x = (index % cols) * cell;
    const y = Math.floor(index / cols) * (cell + labelHeight);
    const file = path.join(logoDir, `${item.brand_id}.webp`);
    const image = await sharp(file).resize(cell, cell, { fit: "contain", background: "#ffffff" }).webp().toBuffer();
    composites.push({ input: image, left: x, top: y });
    composites.push({ input: svgLabel(item), left: x, top: y + cell });
  }
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#f6f7f9"
    }
  }).composite(composites).webp({ quality: 90 }).toFile(outFile);
  console.log(outFile);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
