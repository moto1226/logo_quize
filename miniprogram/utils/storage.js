const latestKey = "latest_quiz_result";

function saveLatestResult(result) {
  wx.setStorageSync(latestKey, result);
}

function getLatestResult() {
  return wx.getStorageSync(latestKey) || null;
}

function clearLatestResult() {
  wx.removeStorageSync(latestKey);
}

module.exports = {
  saveLatestResult,
  getLatestResult,
  clearLatestResult
};
