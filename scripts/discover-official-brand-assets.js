const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");
const {
  root,
  seedRows,
  toAbsUrl,
  writeCsv,
  writeJson,
  delay
} = require("./logo-candidates-common");

const paths = ["/brand", "/brands", "/press", "/media", "/newsroom", "/about", "/assets", "/brand-assets", "/media-kit", "/press-kit", "/brand-guidelines"];
const keywords = ["brand assets", "media kit", "press kit", "logo", "logo package", "brand guidelines", "assets", "download"];

function classify(url, text) {
  const value = `${url} ${text}`.toLowerCase();
  if (value.includes("press")) return "press";
  if (value.includes("media")) return "media-kit";
  if (value.includes("brand")) return "brand-assets";
  if (value.includes("logo")) return "logo";
  return "unknown";
}

async function checkPage(brand, pagePath) {
  const pageUrl = `https://${brand.domain}${pagePath}`;
  const rows = [];
  try {
    const response = await fetch(pageUrl, {
      headers: { "user-agent": "Mozilla/5.0 logo-candidates-harvester/1.0", accept: "text/html,*/*;q=0.8" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return rows;
    const html = await response.text();
    const $ = cheerio.load(html);
    $("a[href]").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      const href = $(el).attr("href");
      const abs = toAbsUrl(pageUrl, href);
      const haystack = `${text} ${href}`.toLowerCase();
      const matched = keywords.find((keyword) => haystack.includes(keyword));
      if (!matched || !abs) return;
      rows.push({
        brand_id: brand.brand_id,
        domain: brand.domain,
        candidate_page_url: pageUrl,
        link_text: text.slice(0, 180),
        asset_url: abs,
        asset_type: classify(abs, text),
        confidence: matched.includes("brand") || matched.includes("logo") ? "medium" : "low",
        notes: `matched keyword: ${matched}`
      });
    });
  } catch {}
  return rows;
}

async function main() {
  const rows = [];
  const report = [];
  for (const brand of seedRows().filter((row) => row.domain)) {
    let count = 0;
    for (const pagePath of paths) {
      const found = await checkPage(brand, pagePath);
      rows.push(...found);
      count += found.length;
      await delay(250);
    }
    report.push({ brand_id: brand.brand_id, link_count: count });
    console.log(`[official-assets] ${brand.brand_id} ${count}`);
  }
  writeCsv(path.join(root, "data", "official_asset_links.csv"), rows, ["brand_id", "domain", "candidate_page_url", "link_text", "asset_url", "asset_type", "confidence", "notes"]);
  writeJson(path.join(root, "reports", "official-assets-discover-report.json"), { generated_at: new Date().toISOString(), link_count: rows.length, entries: report });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
