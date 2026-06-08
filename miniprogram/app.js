const { getLayoutMetrics } = require("./utils/system.js");

App({
  onLaunch() {
    this.globalData.layoutMetrics = getLayoutMetrics();
  },

  getLayoutMetrics() {
    if (!this.globalData.layoutMetrics) {
      this.globalData.layoutMetrics = getLayoutMetrics();
    }
    return this.globalData.layoutMetrics;
  },

  globalData: {
    layoutMetrics: null
  }
});
