let sourceQuestions = [];
let sourceBrands = [];

try {
  sourceQuestions = require("../../data/questions.js");
} catch (error) {
  console.warn("questions.js load failed", error);
  sourceQuestions = [];
}

try {
  sourceBrands = require("../../data/brands.js");
} catch (error) {
  console.warn("brands.js load failed", error);
  sourceBrands = [];
}

const { shuffle } = require("../../../../utils/quiz.js");
const { saveLatestResult } = require("../../../../utils/storage.js");

const letters = ["A", "B", "C", "D"];
const ROUND_QUESTION_COUNT = 20;
const brandNameMap = sourceBrands.reduce((map, brand) => {
  map[brand.brand_id] = brand.display_name || brand.name_zh || brand.name_en || brand.brand_id;
  return map;
}, {});

function logoPath(brandId) {
  return `/packages/quiz/assets/logos/${brandId}.jpg`;
}

function brandName(brandId) {
  return brandNameMap[brandId] || brandId || "";
}

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
    menuButtonTop: menuButton.top,
    menuButtonHeight: menuButton.height,
    navBarHeight: statusBarHeight + (menuButton.top - statusBarHeight) * 2 + menuButton.height,
    menuRightSpace: Math.max(112, windowWidth - menuButton.left + 12)
  };
}

function normalizeOption(option, index, questionType) {
  const brandId = option.brand_id || "";
  return {
    brand_id: brandId,
    text: option.text || option.name || brandName(brandId),
    image: option.image || logoPath(brandId),
    letter: letters[index] || "",
    className: "normal"
  };
}

function isValidQuestion(question) {
  if (!question || !question.id || !question.type || !question.answer_brand_id) {
    console.warn("skip invalid question", question && question.id);
    return false;
  }
  if (!Array.isArray(question.options) || question.options.length < 4) {
    console.warn("skip question with insufficient options", question.id);
    return false;
  }
  return true;
}

function getTypeLabel(type) {
  if (type === "brand_to_logo") return "反向记忆";
  if (type === "logo_to_brand") return "基础识别";
  if (type === "similar_logo_confusion") return "相似混淆";
  if (type === "brand_clue_to_logo") return "线索推理";
  return "识标挑战";
}

function getPrompt(type) {
  if (type === "brand_to_logo") return "请选择对应的 Logo";
  if (type === "logo_to_brand") return "请认出这个品牌";
  return "请选择正确答案";
}

function pickBalancedQuestions(questions, limit, excludedBrandIds) {
  const selected = [];
  const selectedQuestionIds = new Set();
  const selectedBrandIds = new Set(excludedBrandIds ? Array.from(excludedBrandIds) : []);
  const buckets = new Map();

  for (const question of shuffle(questions)) {
    const key = question.industry || question.similar_group || "其他";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(question);
  }

  const bucketKeys = shuffle([...buckets.keys()]);
  let pickedInPass = true;
  while (selected.length < limit && pickedInPass) {
    pickedInPass = false;
    for (const key of bucketKeys) {
      if (selected.length >= limit) break;
      const bucket = buckets.get(key) || [];
      const index = bucket.findIndex((question) => !selectedQuestionIds.has(question.id) && !selectedBrandIds.has(question.answer_brand_id));
      if (index < 0) continue;
      const [question] = bucket.splice(index, 1);
      selected.push(question);
      selectedQuestionIds.add(question.id);
      selectedBrandIds.add(question.answer_brand_id);
      pickedInPass = true;
    }
  }

  if (selected.length < limit) {
    const remaining = shuffle(questions).filter((question) => !selectedQuestionIds.has(question.id) && !selectedBrandIds.has(question.answer_brand_id));
    for (const question of remaining) {
      if (selected.length >= limit) break;
      selected.push(question);
      selectedQuestionIds.add(question.id);
      selectedBrandIds.add(question.answer_brand_id);
    }
  }

  if (selected.length < limit) {
    const remaining = shuffle(questions).filter((question) => !selectedQuestionIds.has(question.id));
    for (const question of remaining) {
      if (selected.length >= limit) break;
      selected.push(question);
      selectedQuestionIds.add(question.id);
    }
  }

  return selected;
}

function pickMixedQuestions(questions, limit) {
  const logoTarget = Math.ceil(limit / 2);
  const reverseTarget = limit - logoTarget;
  const usedBrandIds = new Set();
  const logoQuestions = pickBalancedQuestions(
    questions.filter((item) => item.type === "logo_to_brand"),
    logoTarget,
    usedBrandIds
  );
  logoQuestions.forEach((item) => usedBrandIds.add(item.answer_brand_id));

  const reverseQuestions = pickBalancedQuestions(
    questions.filter((item) => item.type === "brand_to_logo"),
    reverseTarget,
    usedBrandIds
  );

  const logoFirst = Math.random() > 0.5;
  const first = logoFirst ? shuffle(logoQuestions) : shuffle(reverseQuestions);
  const second = logoFirst ? shuffle(reverseQuestions) : shuffle(logoQuestions);
  const mixed = [];
  const maxLength = Math.max(first.length, second.length);
  for (let index = 0; index < maxLength; index += 1) {
    if (first[index]) mixed.push(first[index]);
    if (second[index]) mixed.push(second[index]);
  }
  return mixed.slice(0, limit);
}

Page({
  data: {
    statusBarHeight: 0,
    menuButtonTop: 0,
    menuButtonHeight: 0,
    navBarHeight: 0,
    menuRightSpace: 112,

    mode: "mixed",
    questions: [],
    currentIndex: 0,
    currentQuestion: null,
    totalQuestions: 0,
    options: [],

    selectedBrandId: "",
    selectedIndex: -1,
    answerState: "unselected",
    correctAnswerName: "",
    correctAnswerTip: "",

    score: 0,
    progressPercent: 0,

    questionStartTime: 0,
    elapsedSeconds: 0,
    elapsedText: "0.0s",
    timer: null,

    records: [],
    isEmpty: false,
    isLast: false,
    typeLabel: "",
    stagePrompt: ""
  },

  onLoad(query) {
    this.timer = null;
    this.records = [];
    this.initSystemInfo();
    this.loadQuestions(query && query.mode ? query.mode : "mixed");
  },

  onUnload() {
    this.stopTimer();
  },

  initSystemInfo() {
    this.setData(getSystemMetrics());
  },

  loadQuestions(mode) {
    const questions = this.pickRoundQuestions(sourceQuestions, mode);
    if (!questions.length) {
      console.warn("no available questions for mode", mode);
      this.setData({
        mode,
        questions: [],
        totalQuestions: 0,
        currentQuestion: null,
        options: [],
        isEmpty: true
      });
      return;
    }

    this.records = [];
    this.setData({
      mode,
      questions,
      totalQuestions: questions.length,
      currentIndex: 0,
      score: 0,
      records: [],
      isEmpty: false
    });
    this.setCurrentQuestion(0);
  },

  pickRoundQuestions(questions, mode) {
    if (!Array.isArray(questions)) return [];
    const allowedTypes = ["logo_to_brand", "brand_to_logo", "similar_logo_confusion", "brand_clue_to_logo"];
    const filtered = questions
      .filter(isValidQuestion)
      .filter((item) => allowedTypes.indexOf(item.type) >= 0)
      .filter((item) => !mode || mode === "mixed" || item.type === mode);
    const limit = Math.min(ROUND_QUESTION_COUNT, filtered.length);
    if (!mode || mode === "mixed") return pickMixedQuestions(filtered, limit);
    return pickBalancedQuestions(filtered, limit);
  },

  setCurrentQuestion(index) {
    const rawQuestion = this.data.questions[index];
    if (!rawQuestion) {
      this.goResult();
      return;
    }
    const currentQuestion = {
      ...rawQuestion,
      logo: rawQuestion.logo || logoPath(rawQuestion.answer_brand_id),
      brand_name: rawQuestion.brand_name || brandName(rawQuestion.answer_brand_id),
      prompt: rawQuestion.prompt || getPrompt(rawQuestion.type)
    };

    const options = shuffle(currentQuestion.options || [])
      .slice(0, 4)
      .map((option, optionIndex) => normalizeOption(option, optionIndex, currentQuestion.type));

    this.stopTimer();
    const questionStartTime = Date.now();
    this.setData({
      currentIndex: index,
      currentQuestion,
      options,
      selectedBrandId: "",
      selectedIndex: -1,
      answerState: "unselected",
      correctAnswerName: "",
      correctAnswerTip: "",
      progressPercent: Math.round(((index + 1) / this.data.totalQuestions) * 100),
      questionStartTime,
      elapsedSeconds: 0,
      elapsedText: "0.0s",
      isLast: index === this.data.totalQuestions - 1,
      typeLabel: getTypeLabel(currentQuestion.type),
      stagePrompt: getPrompt(currentQuestion.type)
    });
    this.startTimer();
  },

  startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      const seconds = (Date.now() - this.data.questionStartTime) / 1000;
      this.setData({
        elapsedSeconds: Math.floor(seconds),
        elapsedText: `${seconds.toFixed(1)}s`
      });
    }, 500);
  },

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  handleOptionTap(event) {
    if (this.data.answerState === "correct" || this.data.answerState === "wrong") return;

    const selectedBrandId = event.currentTarget.dataset.id;
    const selectedIndex = Number(event.currentTarget.dataset.index);
    const options = this.data.options.map((option, index) => ({
      ...option,
      className: index === selectedIndex ? "selected" : "normal"
    }));

    this.setData({
      selectedBrandId,
      selectedIndex,
      answerState: "selected",
      options
    });
  },

  handleCheckAnswer() {
    if (this.data.answerState !== "selected" || !this.data.selectedBrandId) return;

    const currentQuestion = this.data.currentQuestion;
    const isCorrect = this.data.selectedBrandId === currentQuestion.answer_brand_id;
    const answerState = isCorrect ? "correct" : "wrong";
    const responseTime = Date.now() - this.data.questionStartTime;
    const correctAnswerName = this.getCorrectAnswerName();
    const correctAnswerTip = this.getCorrectAnswerTip(correctAnswerName);
    const selectedOption = this.data.options.find((option) => option.brand_id === this.data.selectedBrandId) || {};
    const selectedAnswerName = selectedOption.text || selectedOption.brand_id || "";
    const score = this.data.score + (isCorrect ? 1 : 0);
    const options = this.data.options.map((option, index) => ({
      ...option,
      className: this.getOptionClass(option, index, answerState)
    }));
    const record = {
      question_id: currentQuestion.id,
      type: currentQuestion.type,
      answer_brand_id: currentQuestion.answer_brand_id,
      selected_brand_id: this.data.selectedBrandId,
      is_correct: isCorrect,
      response_time_ms: responseTime,
      industry: currentQuestion.industry,
      similar_group: currentQuestion.similar_group,
      correct_answer_name: correctAnswerName,
      selected_answer_name: selectedAnswerName
    };
    const records = this.data.records.concat(record);

    this.records = records;
    this.stopTimer();
    this.setData({
      answerState,
      score,
      options,
      records,
      correctAnswerName,
      correctAnswerTip
    });
  },

  handleContinue() {
    if (this.data.answerState !== "correct" && this.data.answerState !== "wrong") return;
    if (this.data.currentIndex >= this.data.totalQuestions - 1) {
      this.goResult();
      return;
    }
    this.setCurrentQuestion(this.data.currentIndex + 1);
  },

  handleExit() {
    wx.showModal({
      title: "确定退出本次答题吗？",
      content: "退出后本次进度不会保存。",
      cancelText: "继续答题",
      confirmText: "退出",
      confirmColor: "#ff4b4b",
      success: (res) => {
        if (res.confirm) {
          this.stopTimer();
          wx.reLaunch({ url: "/pages/index/index" });
        }
      }
    });
  },

  goResult() {
    this.stopTimer();
    const records = this.data.records || [];
    const total = this.data.totalQuestions || records.length;
    const score = this.data.score || 0;
    const accuracy = total ? Math.round((score / total) * 100) : 0;
    const finishedAt = new Date().toISOString();
    const result = {
      mode: this.data.mode,
      total,
      score,
      accuracy,
      records,
      finishedAt,
      finished_at: finishedAt
    };

    saveLatestResult(result);
    try {
      const finishedCount = (wx.getStorageSync("finished_count") || 0) + 1;
      const bestAccuracy = Math.max(wx.getStorageSync("best_accuracy") || 0, accuracy);
      wx.setStorageSync("finished_count", finishedCount);
      wx.setStorageSync("best_accuracy", bestAccuracy);
    } catch (error) {
      console.warn("save quiz stats failed", error);
    }

    wx.redirectTo({ url: "/packages/quiz/pages/result/result" });
  },

  getOptionClass(option, index, state) {
    const answerState = state || this.data.answerState;
    if (answerState === "correct" || answerState === "wrong") {
      if (option.brand_id === this.data.currentQuestion.answer_brand_id) return "correct";
      if (option.brand_id === this.data.selectedBrandId) return "wrong";
      return "disabled";
    }
    if (index === this.data.selectedIndex) return "selected";
    return "normal";
  },

  getCorrectAnswerName() {
    const currentQuestion = this.data.currentQuestion || {};
    if (currentQuestion.type === "brand_to_logo" && currentQuestion.brand_name) {
      return currentQuestion.brand_name;
    }
    const answerOption = this.data.options.find((option) => option.brand_id === currentQuestion.answer_brand_id);
    return answerOption ? answerOption.text || answerOption.brand_id : currentQuestion.answer_brand_id || "";
  },

  getCorrectAnswerTip(fallbackName) {
    const currentQuestion = this.data.currentQuestion || {};
    const answerOption = this.data.options.find((option) => option.brand_id === currentQuestion.answer_brand_id);
    if (currentQuestion.type === "brand_to_logo" && answerOption && answerOption.letter) {
      return answerOption.letter;
    }
    return fallbackName || this.getCorrectAnswerName();
  },

  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  }
});
