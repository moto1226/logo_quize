function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function pickQuestions(questions, mode, limit) {
  const filtered = mode && mode !== "mixed" ? questions.filter((item) => item.type === mode) : questions;
  return shuffle(filtered).slice(0, Math.min(limit || 20, filtered.length));
}

function buildOptions(question) {
  return shuffle(question.options || []);
}

function formatQuestionType(type) {
  return type === "brand_to_logo" ? "反向记忆" : "基础识别";
}

module.exports = {
  shuffle,
  pickQuestions,
  buildOptions,
  formatQuestionType
};
