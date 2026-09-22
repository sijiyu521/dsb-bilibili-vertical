/**
 * demo-boot.js —— 演示环境的接线
 *
 * 关键点：不改任何业务代码，只把 BBDY 上的两个「插座」换成假的：
 *   - BBDY.runtime / BBDY.apiBase  → 接口打到本地 /mock
 *   - BBDY.playerUrl               → 播放器地址指向本地假 MP4
 * 这样 demo 页面加载的就是扩展本体会跑的同一份代码。
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;

  BBDY.runtime = 'demo';
  BBDY.apiBase = location.origin + '/mock';
  BBDY.debug = true;

  // 演示环境直接给一段本地 MP4，模拟真实情况下 playurl 返回的直链
  BBDY.demoMediaUrl = location.origin + '/mock/media.mp4';
  BBDY.playerUrl = () => BBDY.demoMediaUrl;
})();
