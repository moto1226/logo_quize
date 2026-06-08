function calcAccuracy(items) {
  if (!items.length) return 0;
  return Math.round((items.filter((item) => item.is_correct).length / items.length) * 100);
}

function calcAverageTime(items) {
  if (!items.length) return 0;
  return Math.round(items.reduce((sum, item) => sum + (item.response_time_ms || 0), 0) / items.length);
}

function groupStats(items, key) {
  const map = {};
  items.forEach((item) => {
    const value = item[key] || "未分组";
    if (!map[value]) map[value] = [];
    map[value].push(item);
  });
  return Object.keys(map).map((name) => ({
    name,
    count: map[name].length,
    correct_count: map[name].filter((item) => item.is_correct).length,
    accuracy: calcAccuracy(map[name]),
    average_time_ms: calcAverageTime(map[name])
  }));
}

function calcStatsByIndustry(items) {
  return groupStats(items, "industry");
}

function calcStatsBySimilarGroup(items) {
  return groupStats(items, "similar_group");
}

function calcStatsByQuestionType(items) {
  return groupStats(items, "type");
}

function generateInsightText(result) {
  const industryStats = result.industry_stats || [];
  const typeStats = result.type_stats || [];
  const best = [...industryStats].sort((a, b) => b.accuracy - a.accuracy)[0];
  const fastest = [...industryStats].sort((a, b) => a.average_time_ms - b.average_time_ms)[0];
  const weakest = [...industryStats].sort((a, b) => a.accuracy - b.accuracy)[0];
  const logoType = typeStats.find((item) => item.name === "logo_to_brand");
  const reverseType = typeStats.find((item) => item.name === "brand_to_logo");
  const parts = [];
  if (best) parts.push(`你对${best.name}类品牌识别较强`);
  if (fastest) parts.push(`${fastest.name}类反应速度较快`);
  if (weakest && (!best || weakest.name !== best.name)) parts.push(`${weakest.name}类还可以继续练习`);
  if (logoType && reverseType) {
    parts.push(reverseType.average_time_ms > logoType.average_time_ms ? "相比看 Logo 选品牌，你在看品牌名选 Logo 时反应时间更长" : "你在反向记忆题上的反应并不弱于基础识别题");
  }
  return parts.length ? `${parts.join("，")}。` : "完成得不错，继续练习可以提升 Logo 细节记忆。";
}

module.exports = {
  calcAccuracy,
  calcAverageTime,
  calcStatsByIndustry,
  calcStatsBySimilarGroup,
  calcStatsByQuestionType,
  generateInsightText
};
