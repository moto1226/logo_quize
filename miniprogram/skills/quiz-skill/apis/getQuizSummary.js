const summary = require("../data/summary.js");

async function getQuizSummary() {
  return {
    isError: false,
    content: [
      {
        type: "text",
        text: `识标挑战当前有 ${summary.brand_count} 个品牌、${summary.question_count} 道可生成题目，支持快速开始、基础识别和反向记忆。用户想开始练习时应调用 startQuiz。`
      }
    ],
    structuredContent: summary
  };
}

module.exports = getQuizSummary;
