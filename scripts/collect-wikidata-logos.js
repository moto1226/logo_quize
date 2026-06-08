const path = require("node:path");
const {
  seedRows,
  fetchBuffer,
  extFromUrlOrType,
  saveCandidateAsset,
  writeSourceCandidates,
  writeJson,
  delay,
  root
} = require("./logo-candidates-common");

async function wikidataSearch(brand) {
  const queries = [brand.name_en, brand.name_zh].filter(Boolean);
  for (const query of queries) {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&limit=5&origin=*`;
    const json = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json();
    if (Array.isArray(json.search) && json.search.length) return json.search.map((item) => item.id);
  }
  return [];
}

async function entityLogo(qid) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const json = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json();
  const entity = json.entities?.[qid];
  const claim = entity?.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
  return claim || "";
}

async function commonsInfo(fileName) {
  const title = fileName.startsWith("File:") ? fileName : `File:${fileName}`;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|extmetadata`;
  const json = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json();
  const page = Object.values(json.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.url) return null;
  const meta = info.extmetadata || {};
  return {
    url: info.url,
    descriptionUrl: info.descriptionurl || "",
    license: meta.LicenseShortName?.value || meta.UsageTerms?.value || "unknown",
    licenseUrl: meta.LicenseUrl?.value || ""
  };
}

async function main() {
  const candidates = [];
  const report = [];
  for (const brand of seedRows()) {
    const errors = [];
    try {
      const qids = await wikidataSearch(brand);
      let saved = 0;
      for (const qid of qids.slice(0, 3)) {
        const fileName = await entityLogo(qid);
        if (!fileName) continue;
        const info = await commonsInfo(fileName);
        if (!info) continue;
        const fetched = await fetchBuffer(info.url);
        if (!fetched.ok) throw new Error(`commons http ${fetched.status}`);
        const ext = extFromUrlOrType(info.url, fetched.contentType);
        candidates.push(await saveCandidateAsset({
          sourceType: "wikimedia",
          brand,
          sourceUrl: info.descriptionUrl || info.url,
          sourceName: `Wikidata P154 ${qid}`,
          license: info.license,
          licenseUrl: info.licenseUrl,
          rawBuffer: fetched.buffer,
          originalFormat: ext,
          suffix: `${qid}_${fileName}`,
          qualityScore: 80,
          matchConfidence: "medium",
          notes: "Wikidata P154 logo image"
        }));
        saved += 1;
        break;
      }
      if (!saved) errors.push("missing P154");
      report.push({ brand_id: brand.brand_id, candidate_count: saved, errors });
    } catch (err) {
      report.push({ brand_id: brand.brand_id, candidate_count: 0, errors: [err.message] });
    }
    console.log(`[wikimedia] ${brand.brand_id}`);
    await delay(600);
  }
  writeSourceCandidates("wikimedia", candidates);
  writeJson(path.join(root, "reports", "wikimedia-collect-report.json"), {
    generated_at: new Date().toISOString(),
    candidate_count: candidates.length,
    entries: report
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
