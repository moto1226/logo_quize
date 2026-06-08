let summary = {};

try {
  summary = require("../../data/summary.js");
} catch (error) {
  summary = {};
}

function getHeaderMetrics() {
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

  const menuButtonTop = menuButton.top;
  const menuButtonHeight = menuButton.height;
  const navBarHeight = statusBarHeight + (menuButtonTop - statusBarHeight) * 2 + menuButtonHeight;

  return {
    statusBarHeight,
    menuButtonTop,
    menuButtonHeight,
    navBarHeight,
    headerPaddingTop: statusBarHeight + 12,
    menuRightSpace: Math.max(112, windowWidth - menuButton.left + 12)
  };
}

function getCacheNumber(keys) {
  for (let i = 0; i < keys.length; i += 1) {
    try {
      const value = wx.getStorageSync(keys[i]);
      if (typeof value === "number" && !Number.isNaN(value)) return value;
    } catch (error) {
      // Ignore unavailable cache keys.
    }
  }
  return 0;
}

function getFinishedCount() {
  const cached = getCacheNumber(["finished_count", "quiz_finished_count"]);
  if (cached) return cached;

  try {
    const history = wx.getStorageSync("quiz_history");
    if (Array.isArray(history)) return history.length;
  } catch (error) {
    // Ignore unavailable cache keys.
  }

  try {
    const latest = wx.getStorageSync("latest_quiz_result");
    return latest && latest.records ? 1 : 0;
  } catch (error) {
    return 0;
  }
}

function getLatestAccuracy() {
  try {
    const best = wx.getStorageSync("best_accuracy");
    if (typeof best === "number" && !Number.isNaN(best)) return Math.round(best);
  } catch (error) {
    // Ignore unavailable cache keys.
  }

  try {
    const latest = wx.getStorageSync("latest_quiz_result");
    if (!latest || !latest.records || !latest.records.length) return 0;
    const correct = latest.records.filter((item) => item.is_correct).length;
    return Math.round((correct / latest.records.length) * 100);
  } catch (error) {
    return 0;
  }
}

function buildModes() {
  return [
    {
      id: "logo-to-brand",
      mode: "logo_to_brand",
      title: "基础识别",
      desc: "看 Logo 选品牌",
      badge: "可练习",
      icon: "⌕",
      colorClass: "mode-green",
      locked: false
    },
    {
      id: "brand-to-logo",
      mode: "brand_to_logo",
      title: "反向记忆",
      desc: "看品牌名选 Logo",
      badge: "可练习",
      icon: "A",
      colorClass: "mode-blue",
      locked: false
    },
    {
      id: "similar",
      mode: "similar_confusion",
      title: "相似混淆",
      desc: "辨认相似 Logo 的细节",
      badge: "锁定",
      icon: "≈",
      colorClass: "mode-orange",
      locked: true,
      toast: "相似混淆题即将开放"
    },
    {
      id: "clue",
      mode: "brand_clue",
      title: "线索推理",
      desc: "根据描述选择 Logo",
      badge: "锁定",
      icon: "?",
      colorClass: "mode-purple",
      locked: true,
      toast: "线索推理题即将开放"
    }
  ];
}

Page({
  data: {
    statusBarHeight: 0,
    menuButtonTop: 0,
    menuButtonHeight: 0,
    navBarHeight: 0,
    headerPaddingTop: 0,
    menuRightSpace: 112,
    brandCount: 0,
    questionCount: 0,
    finishedCount: 0,
    bestAccuracy: 0,
    logoToBrandCount: 0,
    brandToLogoCount: 0,
    modes: []
  },

  onLoad() {
    const metrics = getHeaderMetrics();
    const brandCount = summary.brand_count || 0;
    const questionCount = summary.question_count || 0;
    const logoToBrandCount = summary.logo_to_brand_count || 0;
    const brandToLogoCount = summary.brand_to_logo_count || 0;
    const finishedCount = getFinishedCount();
    const bestAccuracy = getLatestAccuracy();

    this.setData(Object.assign({}, metrics, {
      brandCount,
      questionCount,
      finishedCount,
      bestAccuracy,
      logoToBrandCount,
      brandToLogoCount,
      modes: buildModes()
    }));
  },

  onShow() {
    this.setData({
      finishedCount: getFinishedCount(),
      bestAccuracy: getLatestAccuracy()
    });
  },

  handleModeTap(event) {
    const mode = event.currentTarget.dataset.mode;
    const item = this.data.modes.find((modeItem) => modeItem.mode === mode);

    if (item && item.locked) {
      wx.showToast({
        title: item && item.toast ? item.toast : "该模式即将开放",
        icon: "none"
      });
      return;
    }

    wx.navigateTo({
      url: `/packages/quiz/pages/quiz/quiz?mode=${mode}`
    });
  },

  startMixed() {
    wx.navigateTo({
      url: "/packages/quiz/pages/quiz/quiz?mode=mixed"
    });
  }
});
