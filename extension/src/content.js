/**
 * content.js —— 内容脚本入口
 *
 * 负责：设置引导、开关消息通道、快捷键，以及把「界面入口的注入」交给 entry.js。
 * 三个入口位置（顶栏药丸 / 视频页互动栏按钮 / 悬浮兜底）都在 entry.js 里维护。
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;

  /** 防止同页面被注入两次 */
  if (window.__BBDY_CONTENT_LOADED__) return;
  window.__BBDY_CONTENT_LOADED__ = true;

  let overlay = null;
  const getOverlay = () => overlay || (overlay = new BBDY.Overlay());

  /**
   * 开关视频流
   * @param {boolean} [force] true 打开 / false 关闭 / undefined 切换
   * @param {{seed?:string}} [opts] seed：要优先播放的 BV 号（从视频页进入时带上当前视频）
   */
  async function toggle(force, opts = {}) {
    const o = getOverlay();
    const want = force === undefined ? !o.visible : force;
    if (want) await o.show(opts);
    else o.hide();
    BBDY.entry.paintLauncher();
    return o.visible;
  }

  /** 界面上任何入口点击后都走这里：记下用户意图 + 带上当前视频 */
  function openFromUi() {
    BBDY.userInvoked = true;
    return toggle(true, { seed: BBDY.entry.currentBvid() });
  }

  /* ------------------------------ 消息通道 ------------------------------ */
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'BB_TOGGLE') {
        const force = msg.open === undefined ? undefined : msg.open;
        toggle(force, { seed: BBDY.entry.currentBvid() }).then((visible) =>
          sendResponse({ ok: true, visible })
        );
        return true;
      }
      if (msg.type === 'BB_STATE') {
        sendResponse({
          ok: true,
          visible: !!(overlay && overlay.visible),
          version: BBDY.version,
          entry: {
            nav: !!document.querySelector(`[${BBDY.entry.MARK}="nav"]`),
            toolbar: !!document.querySelector(`[${BBDY.entry.MARK}="toolbar"]`),
            floating: !!document.querySelector('.bbdy-launcher'),
          },
        });
        return true;
      }
      sendResponse({ ok: false, unknown: msg.type });
      return false;
    });
  }

  /* --------------------------- 地址栏 / 快捷键 --------------------------- */
  function wantsAutoOpen() {
    try {
      const q = new URLSearchParams(location.search);
      return q.get('bbdy') === '1' || location.hash === '#bbdy';
    } catch (_) {
      return false;
    }
  }

  window.addEventListener(
    'keydown',
    (e) => {
      const t = e.target;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (typing) return;
      // Alt+Shift+B：扩展快捷键没生效时的兜底
      if (e.altKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault();
        openFromUi();
        return;
      }
      // 反斜杠键
      if (e.key === '\\' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        openFromUi();
      }
    },
    true
  );

  /* ------------------------------ 启动 ------------------------------ */
  BBDY.toggleOverlay = toggle;
  BBDY.openFromUi = openFromUi;
  BBDY.getOverlay = getOverlay;

  BBDY.config.load().then(() => {
    BBDY.entry.watch();
    BBDY.entry.ensure();
    BBDY.config.on('settings', () => BBDY.entry.ensure());
    if (wantsAutoOpen()) setTimeout(() => toggle(true, { seed: BBDY.entry.currentBvid() }), 300);
    BBDY.log('content script ready v' + BBDY.version);
  });
})();
