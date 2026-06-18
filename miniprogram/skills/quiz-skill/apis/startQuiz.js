const modeMap = {
  mixed: {
    mode: "mixed",
    name: "快速开始",
    url: "/packages/quiz/pages/quiz/quiz?mode=mixed"
  },
  logo_to_brand: {
    mode: "logo_to_brand",
    name: "基础识别",
    url: "/packages/quiz/pages/quiz/quiz?mode=logo_to_brand"
  },
  brand_to_logo: {
    mode: "brand_to_logo",
    name: "反向记忆",
    url: "/packages/quiz/pages/quiz/quiz?mode=brand_to_logo"
  }
};

async function startQuiz({ mode = "mixed" } = {}) {
  const target = modeMap[mode] || modeMap.mixed;

  try {
    wx.navigateTo({ url: target.url });
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `无法进入${target.name}：${error && error.message ? error.message : "跳转失败"}。请引导用户点击首页对应练习入口。`
        }
      ],
      structuredContent: target
    };
  }

  return {
    isError: false,
    content: [
      {
        type: "text",
        text: `已进入${target.name}练习。接下来由小程序答题页展示题目和选项，Agent 禁止替用户作答或透露答案。`
      }
    ],
    structuredContent: target
  };
}

module.exports = startQuiz;
