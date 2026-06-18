function modeName(mode) {
  if (mode === "logo_to_brand") return "基础识别";
  if (mode === "brand_to_logo") return "反向记忆";
  return "快速开始";
}

function formatSeconds(ms) {
  const seconds = Math.round((ms || 0) / 1000);
  return seconds > 0 ? `${seconds} 秒` : "暂无用时";
}

async function getLatestResult() {
  const latest = wx.getStorageSync("latest_quiz_result");

  if (!latest || !latest.records || !latest.records.length) {
    return {
      isError: false,
      content: [
        {
          type: "text",
          text: "还没有最近练习成绩。可以先调用 startQuiz，带用户完成一轮 20 题练习。"
        }
      ],
      structuredContent: {
        has_result: false
      }
    };
  }

  const total = latest.total || latest.records.length;
  const score = latest.score || latest.records.filter((item) => item.is_correct).length;
  const accuracy = total ? Math.round((score / total) * 100) : 0;
  const totalTimeMs = latest.records.reduce((sum, item) => sum + (item.response_time_ms || 0), 0);
  const typeStats = latest.records.reduce((map, item) => {
    const key = item.type || "unknown";
    if (!map[key]) map[key] = { type: key, total: 0, correct: 0 };
    map[key].total += 1;
    if (item.is_correct) map[key].correct += 1;
    return map;
  }, {});

  return {
    isError: false,
    content: [
      {
        type: "text",
        text: `最近一次${modeName(latest.mode)}练习答对 ${score}/${total} 题，正确率 ${accuracy}%，总用时 ${formatSeconds(totalTimeMs)}。可以简短鼓励用户继续练习，或调用 startQuiz 再来一组。`
      }
    ],
    structuredContent: {
      has_result: true,
      mode: latest.mode || "mixed",
      mode_name: modeName(latest.mode),
      total,
      score,
      accuracy,
      total_time_ms: totalTimeMs,
      type_stats: Object.values(typeStats)
    }
  };
}

module.exports = getLatestResult;
