const getQuizSummary = require("./apis/getQuizSummary.js");
const startQuiz = require("./apis/startQuiz.js");
const getLatestResult = require("./apis/getLatestResult.js");

const skill = wx.modelContext.createSkill("skills/quiz-skill");

skill.registerAPI("getQuizSummary", getQuizSummary);
skill.registerAPI("startQuiz", startQuiz);
skill.registerAPI("getLatestResult", getLatestResult);

console.log("[quiz-skill] APIs registered");
