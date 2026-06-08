const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const {
  root,
  seedFile,
  matchesCsv,
  readCsv,
  writeCsv,
  writeJson,
  ensureDir,
  loadConfig,
  fileSize,
  normalizeDomain
} = require("./svglogo-common");

// Persistent browser profile. Prefer a dedicated profile directory, because the
// main Chrome profile is often locked while Chrome is open.
// Windows example:
//   BRANDFETCH_SCRAPE_USER_DATA_DIR=C:\Users\<you>\AppData\Local\Google\Chrome\User Data\BrandfetchScraper
// macOS example:
//   BRANDFETCH_SCRAPE_USER_DATA_DIR=/Users/<you>/Library/Application Support/Google/Chrome/BrandfetchScraper
const USER_DATA_DIR =
  process.env.BRANDFETCH_SCRAPE_USER_DATA_DIR ||
  path.join(root, ".cache", "brandfetch-browser-profile");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function red(message) {
  return `\x1b[31m${message}\x1b[0m`;
}

function browserChannel() {
  const value = (process.env.BRANDFETCH_SCRAPE_BROWSER_CHANNEL || "").trim();
  return value || undefined;
}

async function openBrowserSession(chromium, config) {
  ensureDir(USER_DATA_DIR);
  const launchOptions = {
    headless: false,
    viewport: { width: 1366 + randomInt(0, 120), height: 820 + randomInt(0, 80) },
    locale: "en-US",
    timezoneId: "Asia/Tokyo"
  };
  const channel = browserChannel();
  if (channel) launchOptions.channel = channel;
  if (config.userAgent) launchOptions.userAgent = config.userAgent;

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

function readManualWordmarkIds() {
  const candidates = [
    path.join(root, "data", "svglogo-manual-wordmark-labels.json"),
    path.join(root, "data", "raw", "svglogo", "svglogo-manual-wordmark-labels.json"),
    path.join(root, "review", "svglogo-manual-wordmark-labels.json")
  ];
  const ids = new Set();
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      const rows = Array.isArray(json) ? json : json.manual_wordmark || [];
      for (const row of rows) {
        if (row.svglogo_id && row.manual_wordmark !== false) ids.add(row.svglogo_id);
      }
    } catch (err) {
      console.warn(`manual wordmark file ignored: ${file} ${err.message}`);
    }
  }
  return ids;
}

function buildTargets() {
  const seedRows = readCsv(seedFile).filter((row) => (row.include_mvp || "").toLowerCase() === "true");
  const matches = fs.existsSync(matchesCsv) ? readCsv(matchesCsv) : [];
  const manualWordmarkIds = readManualWordmarkIds();
  const matchesByBrand = new Map();
  for (const match of matches) {
    if (!matchesByBrand.has(match.brand_id)) matchesByBrand.set(match.brand_id, []);
    matchesByBrand.get(match.brand_id).push(match);
  }

  const targets = [];
  const skipped = [];
  for (const seed of seedRows) {
    const existingLogo = path.join(root, "assets", "logos", `${seed.brand_id}.webp`);
    if (!hasFlag("--force") && fs.existsSync(existingLogo) && fileSize(existingLogo) > 0) {
      skipped.push({ brand_id: seed.brand_id, reason: "existing_assets_logo" });
      continue;
    }

    const brandMatches = matchesByBrand.get(seed.brand_id) || [];
    const hasNonWordmarkCandidate = brandMatches.some((match) => {
      const manuallyMarked = manualWordmarkIds.has(match.svglogo_id);
      return match.recommended === "true" && match.is_wordmark !== "true" && !manuallyMarked;
    });
    if (hasNonWordmarkCandidate) {
      skipped.push({ brand_id: seed.brand_id, reason: "has_non_wordmark_svglogo_candidate" });
      continue;
    }

    const domain = normalizeDomain(seed.domain);
    if (!domain) {
      skipped.push({ brand_id: seed.brand_id, reason: "missing_domain" });
      continue;
    }

    targets.push({
      brand_id: seed.brand_id,
      name_en: seed.name_en,
      name_zh: seed.name_zh,
      domain,
      source_reason: brandMatches.length ? "wordmark_or_manual_wordmark_only" : "missing_svglogo_non_wordmark"
    });
  }
  return { targets, skipped, manualWordmarkIds: [...manualWordmarkIds] };
}

async function setupPage(page) {
  await page.route("**/*", async (route) => {
    const type = route.request().resourceType();
    if (["font", "media", "stylesheet"].includes(type)) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function politePagePause(page, config) {
  await sleep(randomInt(1000, 2000));
  await page.mouse.wheel(0, randomInt(220, 620));
  await sleep(randomInt(1000, 2000));
  await page.mouse.wheel(0, -randomInt(160, 520));
  await sleep(randomInt(700, 1400));
  await sleep(randomInt(config.minDelayMs, config.maxDelayMs));
}

async function extractCandidates(page, domain) {
  return page.evaluate((targetDomain) => {
    function visible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width >= 24 && rect.height >= 24 && style.visibility !== "hidden" && style.display !== "none";
    }

    function scoreText(value) {
      const text = String(value || "").toLowerCase();
      let score = 0;
      if (text.includes(targetDomain)) score += 70;
      if (text.includes("brandfetch")) score += 20;
      if (text.includes("symbol")) score += 220;
      if (text.includes("icon")) score += 160;
      if (text.includes("logo")) score += 80;
      if (text.includes("wordmark")) score -= 220;
      if (text.includes("avatar")) score += 40;
      return score;
    }

    const candidates = [];
    for (const img of [...document.images]) {
      if (!visible(img)) continue;
      const rect = img.getBoundingClientRect();
      const src = img.currentSrc || img.src || "";
      const text = [src, img.alt, img.getAttribute("aria-label"), img.closest("[aria-label]")?.getAttribute("aria-label")].join(" ");
      candidates.push({
        kind: "image",
        src,
        score: scoreText(text) + Math.min(120, rect.width + rect.height),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        label: text.slice(0, 300)
      });
    }

    for (const svg of [...document.querySelectorAll("svg")]) {
      if (!visible(svg)) continue;
      const rect = svg.getBoundingClientRect();
      const text = [svg.getAttribute("aria-label"), svg.closest("[aria-label]")?.getAttribute("aria-label"), svg.outerHTML.slice(0, 500)].join(" ");
      candidates.push({
        kind: "svg",
        svg: svg.outerHTML,
        score: scoreText(text) + Math.min(80, rect.width + rect.height),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        label: text.slice(0, 300)
      });
    }

    return candidates
      .filter((item) => item.kind === "svg" || item.src)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, domain);
}

function extFromContentType(contentType, url) {
  const lower = String(contentType || "").toLowerCase();
  if (lower.includes("svg")) return "svg";
  if (lower.includes("png")) return "png";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("webp")) return "webp";
  const clean = String(url || "").split("?")[0].toLowerCase();
  const ext = path.extname(clean).replace(".", "");
  return ext || "bin";
}

async function candidateBuffer(context, candidate) {
  if (candidate.kind === "svg") {
    return { buffer: Buffer.from(candidate.svg, "utf8"), ext: "svg", contentType: "image/svg+xml" };
  }
  const response = await context.request.get(candidate.src, {
    timeout: 45000,
    headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*,*/*;q=0.8" }
  });
  if (!response.ok()) throw new Error(`image download ${response.status()}`);
  const contentType = response.headers()["content-type"] || "";
  return { buffer: await response.body(), ext: extFromContentType(contentType, candidate.src), contentType };
}

async function convertToWebp(inputBuffer, outputFile, config) {
  const size = config.logoSize;
  const contentSize = Math.round(size * 0.76);
  const resized = await sharp(inputBuffer, { animated: false, density: 192, limitInputPixels: false })
    .rotate()
    .resize({
      width: contentSize,
      height: contentSize,
      fit: "inside",
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .webp({ quality: config.webpQuality, effort: 6 })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const left = Math.max(0, Math.floor((size - meta.width) / 2));
  const top = Math.max(0, Math.floor((size - meta.height) / 2));
  ensureDir(path.dirname(outputFile));
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: resized, left, top }])
    .webp({ quality: config.webpQuality, effort: 6 })
    .toFile(outputFile);
}

async function scrapeOne(page, context, target, config) {
  const url = config.urlTemplate.replace("{domain}", encodeURIComponent(target.domain));
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await politePagePause(page, config);
  const status = response ? response.status() : 0;
  if (status >= 400) throw new Error(`page http ${status} ${url}`);
  const candidates = await extractCandidates(page, target.domain);
  if (!candidates.length) throw new Error("no visible logo candidates");

  const rawDir = path.join(root, "assets", "_raw", "brandfetch-page", target.brand_id);
  const outFile = path.join(root, "assets", "_candidates", "brandfetch-page", `${target.brand_id}.webp`);
  const errors = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    try {
      const downloaded = await candidateBuffer(context, candidate);
      const rawFile = path.join(rawDir, `candidate_${i + 1}.${downloaded.ext}`);
      ensureDir(path.dirname(rawFile));
      fs.writeFileSync(rawFile, downloaded.buffer);
      await convertToWebp(downloaded.buffer, outFile, config);
      return {
        status: "converted",
        selected_rank: i + 1,
        selected_kind: candidate.kind,
        selected_score: candidate.score,
        selected_src: candidate.kind === "image" ? candidate.src : "",
        raw_file: path.relative(root, rawFile).replace(/\\/g, "/"),
        output_file: path.relative(root, outFile).replace(/\\/g, "/"),
        output_size_bytes: fileSize(outFile),
        candidates_seen: candidates.length,
        errors
      };
    } catch (err) {
      errors.push(`candidate_${i + 1}: ${err.message}`);
    }
  }
  throw new Error(errors.join("; ") || "all candidates failed");
}

async function main() {
  const { chromium } = require("playwright");
  const baseConfig = loadConfig();
  const minDelayMs = Number.parseInt(process.env.BRANDFETCH_SCRAPE_MIN_DELAY_MS || "10000", 10);
  const maxDelayMs = Number.parseInt(process.env.BRANDFETCH_SCRAPE_MAX_DELAY_MS || "20000", 10);
  const config = {
    ...baseConfig,
    minDelayMs,
    maxDelayMs,
    urlTemplate: process.env.BRANDFETCH_SCRAPE_URL_TEMPLATE || "https://brandfetch.com/{domain}",
    userAgent: (process.env.BRANDFETCH_SCRAPE_USER_AGENT || "").trim(),
    limit: Number.parseInt(argValue("--limit", "0"), 10) || 0,
    dryRun: hasFlag("--dry-run")
  };

  const targetInfo = buildTargets();
  const targets = config.limit ? targetInfo.targets.slice(0, config.limit) : targetInfo.targets;
  writeCsv(path.join(root, "data", "brandfetch_page_targets.csv"), targets, ["brand_id", "name_en", "name_zh", "domain", "source_reason"]);
  writeJson(path.join(root, "reports", "brandfetch-page-targets-report.json"), {
    generated_at: new Date().toISOString(),
    total_targets: targetInfo.targets.length,
    run_targets: targets.length,
    skipped: targetInfo.skipped,
    manual_wordmark_ids: targetInfo.manualWordmarkIds
  });

  if (config.dryRun) {
    console.log(`dry-run targets=${targets.length}`);
    return;
  }

  const { context, page } = await openBrowserSession(chromium, config);
  await setupPage(page);

  const entries = [];
  try {
    for (const target of targets) {
      await sleep(randomInt(config.minDelayMs, config.maxDelayMs));
      try {
        const result = await scrapeOne(page, context, target, config);
        entries.push({ ...target, ...result });
        console.log(`[ok] ${target.brand_id} ${result.output_file}`);
      } catch (err) {
        entries.push({ ...target, status: "failed", error: err.message });
        console.log(red(`[failed] ${target.brand_id} ${err.message}`));
      }
    }
  } finally {
    await context.close();
  }

  writeJson(path.join(root, "reports", "brandfetch-page-scrape-report.json"), {
    generated_at: new Date().toISOString(),
    delay_ms: { min: config.minDelayMs, max: config.maxDelayMs },
    url_template: config.urlTemplate,
    browser_mode: "persistent_context",
    user_data_dir: USER_DATA_DIR,
    browser_channel: browserChannel() || "playwright-chromium",
    total_targets: targets.length,
    converted_count: entries.filter((row) => row.status === "converted").length,
    failed_count: entries.filter((row) => row.status !== "converted").length,
    entries
  });
}

main().catch((err) => {
  console.error(red(err.stack || err.message));
  process.exit(1);
});
