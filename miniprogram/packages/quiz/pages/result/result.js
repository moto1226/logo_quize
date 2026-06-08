let brands = [];

try {
  brands = require("../../data/brands.js");
} catch (error) {
  console.warn("brands.js load failed", error);
  brands = [];
}

const typeMetaMap = {
  logo_to_brand: {
    label: "基础识别",
    desc: "看 Logo 选品牌",
    colorClass: "type-green"
  },
  brand_to_logo: {
    label: "反向记忆",
    desc: "看品牌名选 Logo",
    colorClass: "type-blue"
  },
  similar_logo_confusion: {
    label: "相似混淆",
    desc: "从相似 Logo 中精确判断",
    colorClass: "type-orange"
  },
  brand_clue_to_logo: {
    label: "线索推理",
    desc: "根据描述选择 Logo",
    colorClass: "type-purple"
  }
};

const brandNameMap = brands.reduce((map, brand) => {
  map[brand.brand_id] = brand.display_name || brand.name_zh || brand.name_en || brand.brand_id;
  return map;
}, {});

function getSystemMetrics() {
  let systemInfo = {};
  let menuButton = null;

  try {
    systemInfo = wx.getSystemInfoSync();
  } catch (error) {
    systemInfo = {};
  }

  const statusBarHeight = systemInfo.statusBarHeight || 24;
  const windowWidth = systemInfo.windowWidth || 375;

  try {
    menuButton = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuButton = null;
  }

  if (!menuButton || !menuButton.height || !menuButton.top || !menuButton.left) {
    menuButton = {
      top: statusBarHeight + 6,
      height: 32,
      left: windowWidth - 95
    };
  }

  return {
    statusBarHeight,
    navBarHeight: statusBarHeight + (menuButton.top - statusBarHeight) * 2 + menuButton.height,
    menuRightSpace: Math.max(112, windowWidth - menuButton.left + 12)
  };
}

function groupRecords(records, key) {
  return records.reduce((map, record) => {
    const name = record[key] || "未分类";
    if (!map[name]) {
      map[name] = {
        name,
        records: []
      };
    }
    map[name].records.push(record);
    return map;
  }, {});
}

Page({
  data: {
    statusBarHeight: 0,
    navBarHeight: 0,
    menuRightSpace: 112,
    hasResult: false,
    mode: "mixed",
    total: 0,
    score: 0,
    accuracy: 0,
    accuracyClass: "score-green",
    resultTitle: "",
    resultComment: "",
    coreMetrics: [],
    typeStats: [],
    industryStats: [],
    wrongAnswers: [],
    insightText: ""
  },

  onLoad() {
    this.initSystemInfo();
    this.loadResult();
  },

  initSystemInfo() {
    this.setData(getSystemMetrics());
  },

  loadResult() {
    let result = null;
    try {
      result = wx.getStorageSync("latest_quiz_result");
    } catch (error) {
      console.warn("latest_quiz_result read failed", error);
    }

    const records = result && Array.isArray(result.records) ? result.records : [];
    if (!result || !records.length) {
      this.setData({ hasResult: false, mode: result && result.mode ? result.mode : "mixed" });
      return;
    }

    const summary = this.buildSummary(result, records);
    const coreMetrics = this.calcCoreMetrics(records, summary.score);
    const typeStats = this.calcTypeStats(records);
    const industryStats = this.calcIndustryStats(records);
    const wrongAnswers = this.buildWrongAnswers(records);

    this.setData({
      hasResult: true,
      mode: result.mode || "mixed",
      total: summary.total,
      score: summary.score,
      accuracy: summary.accuracy,
      accuracyClass: summary.accuracyClass,
      resultTitle: this.generateTitle(summary.accuracy),
      resultComment: summary.comment,
      coreMetrics,
      typeStats,
      industryStats,
      wrongAnswers,
      insightText: this.generateInsightText({ records, typeStats, industryStats })
    });
  },

  buildSummary(result, records) {
    const total = result.total || records.length;
    const score = typeof result.score === "number"
      ? result.score
      : records.filter((record) => record.is_correct).length;
    const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;
    let accuracyClass = "score-red";
    let comment = "继续练习，你会更快记住常见品牌 Logo。";

    if (accuracy >= 75) {
      accuracyClass = "score-green";
      comment = "你已经能快速识别不少常见品牌 Logo。";
    } else if (accuracy >= 50) {
      accuracyClass = "score-orange";
      comment = "你的品牌记忆正在成形，继续练习会更稳定。";
    }

    return {
      total,
      score,
      accuracy,
      accuracyClass,
      comment
    };
  },

  calcCoreMetrics(records, score) {
    const correctRecords = records.filter((record) => record.is_correct);
    const avgMs = records.length
      ? records.reduce((sum, record) => sum + (record.response_time_ms || 0), 0) / records.length
      : 0;
    const fastest = correctRecords.length
      ? correctRecords.reduce((min, record) => ((record.response_time_ms || 0) < (min.response_time_ms || 0) ? record : min), correctRecords[0])
      : null;
    const slowest = records.length
      ? records.reduce((max, record) => ((record.response_time_ms || 0) > (max.response_time_ms || 0) ? record : max), records[0])
      : null;

    return [
      { label: "答对题数", value: `${score}`, sub: `共 ${records.length} 题`, colorClass: "metric-green" },
      { label: "平均反应", value: this.formatTime(avgMs), sub: "每题平均", colorClass: "metric-blue" },
      { label: "最快答对", value: fastest ? this.formatTime(fastest.response_time_ms) : "--", sub: fastest ? this.getRecordAnswerName(fastest) : "暂无", colorClass: "metric-orange" },
      { label: "最慢题", value: slowest ? this.formatTime(slowest.response_time_ms) : "--", sub: slowest ? this.getRecordAnswerName(slowest) : "暂无", colorClass: "metric-purple" }
    ];
  },

  calcTypeStats(records) {
    const groups = groupRecords(records, "type");
    return Object.keys(groups).map((type) => {
      const rows = groups[type].records;
      const correct = rows.filter((record) => record.is_correct).length;
      const accuracy = rows.length ? Math.round((correct / rows.length) * 100) : 0;
      const avgMs = rows.length
        ? rows.reduce((sum, record) => sum + (record.response_time_ms || 0), 0) / rows.length
        : 0;
      const meta = typeMetaMap[type] || { label: type, desc: "识标挑战", colorClass: "type-purple" };
      return {
        type,
        label: meta.label,
        desc: meta.desc,
        colorClass: meta.colorClass,
        count: rows.length,
        accuracy,
        averageTimeText: this.formatTime(avgMs)
      };
    }).sort((a, b) => b.accuracy - a.accuracy);
  },

  calcIndustryStats(records) {
    const groups = groupRecords(records, "industry");
    return Object.keys(groups).map((name) => {
      const rows = groups[name].records;
      const correct = rows.filter((record) => record.is_correct).length;
      const accuracy = rows.length ? Math.round((correct / rows.length) * 100) : 0;
      const avgMs = rows.length
        ? rows.reduce((sum, record) => sum + (record.response_time_ms || 0), 0) / rows.length
        : 0;
      return {
        name,
        count: rows.length,
        correct,
        accuracy,
        averageTimeText: this.formatTime(avgMs)
      };
    }).sort((a, b) => b.accuracy - a.accuracy || b.count - a.count).slice(0, 6);
  },

  buildWrongAnswers(records) {
    return records.filter((record) => !record.is_correct).map((record) => {
      const meta = typeMetaMap[record.type] || { label: record.type || "识标挑战" };
      return {
        question_id: record.question_id,
        typeLabel: meta.label,
        correctAnswer: record.correct_answer_name || this.getBrandName(record.answer_brand_id),
        selectedAnswer: record.selected_answer_name || this.getBrandName(record.selected_brand_id),
        timeText: this.formatTime(record.response_time_ms),
        industry: record.industry || "未分类",
        similarGroup: record.similar_group || "未分组"
      };
    });
  },

  generateTitle(accuracy) {
    if (accuracy >= 90) return "Logo 识别大师";
    if (accuracy >= 75) return "品牌记忆高手";
    if (accuracy >= 60) return "识标进阶者";
    if (accuracy >= 40) return "视觉观察者";
    return "新手侦探";
  },

  generateInsightText(payload) {
    const records = payload.records || [];
    const industryStats = payload.industryStats || [];
    const typeStats = payload.typeStats || [];

    if (records.length < 4) {
      return "本次题量较少，继续答题可以生成更准确的识标画像。";
    }

    const bestIndustry = industryStats[0];
    const weakestIndustry = [...industryStats].sort((a, b) => a.accuracy - b.accuracy)[0];
    const fastestIndustry = [...industryStats].sort((a, b) => {
      const aMs = Number(a.averageTimeText.replace("s", "")) || 999;
      const bMs = Number(b.averageTimeText.replace("s", "")) || 999;
      return aMs - bMs;
    })[0];
    const logoType = typeStats.find((item) => item.type === "logo_to_brand");
    const reverseType = typeStats.find((item) => item.type === "brand_to_logo");
    const lines = [];

    if (bestIndustry) {
      lines.push(`你对${bestIndustry.name}类品牌更熟悉，正确率达到 ${bestIndustry.accuracy}%。`);
    }
    if (fastestIndustry && fastestIndustry.name !== (bestIndustry && bestIndustry.name)) {
      lines.push(`${fastestIndustry.name}类品牌的反应速度更快，平均 ${fastestIndustry.averageTimeText}。`);
    }
    if (logoType && reverseType) {
      const better = logoType.accuracy >= reverseType.accuracy ? "看 Logo 选品牌" : "看品牌名选 Logo";
      lines.push(`本次${better}表现更稳定，可以针对另一种题型继续练习。`);
    } else if (weakestIndustry && weakestIndustry.accuracy < 60) {
      lines.push(`${weakestIndustry.name}类品牌还容易混淆，可以重点复习。`);
    }

    return lines.slice(0, 3).join("");
  },

  formatTime(ms) {
    if (!ms) return "--";
    return `${(ms / 1000).toFixed(2)}s`;
  },

  formatAccuracy(value) {
    return `${Math.round(value || 0)}%`;
  },

  getRecordAnswerName(record) {
    return record.correct_answer_name || this.getBrandName(record.answer_brand_id);
  },

  getBrandName(brandId) {
    return brandNameMap[brandId] || brandId || "--";
  },

  handleRetry() {
    wx.redirectTo({
      url: `/packages/quiz/pages/quiz/quiz?mode=${this.data.mode || "mixed"}`
    });
  },

  handleBackHome() {
    wx.reLaunch({
      url: "/pages/index/index"
    });
  }
});
