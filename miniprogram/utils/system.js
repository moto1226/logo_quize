function getLayoutMetrics() {
  let system = {};
  try {
    system = wx.getSystemInfoSync();
  } catch (error) {
    system = {};
  }

  const statusBarHeight = system.statusBarHeight || 24;
  const windowWidth = system.windowWidth || 375;
  let menuButton = null;

  try {
    menuButton = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuButton = null;
  }

  if (!menuButton || !menuButton.height || !menuButton.top || !menuButton.left) {
    menuButton = {
      top: statusBarHeight + 6,
      height: 32,
      left: windowWidth - 95,
      right: windowWidth - 8,
      width: 87
    };
  }

  const menuButtonTop = menuButton.top;
  const menuButtonHeight = menuButton.height;
  const navBarHeight = statusBarHeight + (menuButtonTop - statusBarHeight) * 2 + menuButtonHeight;
  const menuButtonRightSafe = Math.max(110, windowWidth - menuButton.left + 12);

  return {
    statusBarHeight,
    menuButtonTop,
    menuButtonHeight,
    navBarHeight,
    menuButtonRightSafe,
    windowWidth
  };
}

module.exports = {
  getLayoutMetrics
};
