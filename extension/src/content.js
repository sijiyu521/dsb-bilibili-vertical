/**
 * content.js —— 内容脚本入口
 *
 * 职责：
 *  1. 在 B 站页面右下角放一个粉色悬浮按钮，点开就是全屏竖滑视频流
 *  2. 响应扩展图标 / 快捷键（Alt+Shift+B）的开关消息
 *  3. 支持 ?bbdy=1 或 #bbdy 直接进入（demo 页面与控制台调试用）
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;

  /** 防止同页面被注入两次 */
  if (window.__BBDY_CONTENT_LOADED__) return;
  window.__BBDY_CONTENT_LOADED__ = true;

  let overlay = null;
  let launcher = null;

  const getOverlay = () => overlay || (overlay = new BBDY.Overlay());

  async function toggle(force) {
    const o = getOverlay();
    const want = force === undefined ? !o.visible : force;
    if (want) await o.show();
    else o.hide();
    paintLauncher();
    return o.visible;
  }

  /* ------------------------------ 悬浮入口 ------------------------------ */
  function buildLauncher() {
    const btn = document.createElement('button');
    btn.className = 'bbdy-launcher';
    btn.type = 'button';
    btn.title = '刷B站 · 竖滑视频流（Alt+Shift+B）';
    btn.innerHTML = `<span class="bbdy-icon">${BBDY.icon('play')}</span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle(true);
    });
    // 拖拽调整位置，避免挡住 B 站自己的悬浮元素
    let dragging = false;
    let moved = false;
    let sy = 0;
    let sx = 0;
    let bottom = 96;
    let right = 18;
    btn.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = false;
      sy = e.clientY;
      sx = e.clientX;
      btn.setPointerCapture(e.pointerId);
    });
    btn.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = sy - e.clientY;
      const dx = sx - e.clientX;
      if (!moved && Math.hypot(dx, dy) > 6) moved = true;
      if (!moved) return;
      bottom = BBDY.clamp(bottom + dy, 20, window.innerHeight - 80);
      right = BBDY.clamp(right + dx, 8, window.innerWidth - 70);
      btn.style.bottom = bottom + 'px';
      btn.style.right = right + 'px';
      sy = e.clientY;
      sx = e.clientX;
    });
    btn.addEventListener('pointerup', (e) => {
      dragging = false;
      if (!moved) return;
      e.preventDefault();
      e.stopPropagation();
      btn.dataset.moved = '1';
      setTimeout(() => delete btn.dataset.moved, 300);
    });
    btn.addEventListener('click', (e) => {
      if (btn.dataset.moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    return btn;
  }

  function paintLauncher() {
    const show = BBDY.config.settings.showLauncher && !(overlay && overlay.visible);
    if (show && !launcher) {
      launcher = buildLauncher();
      document.body.append(launcher);
    } else if (!show && launcher) {
      launcher.remove();
      launcher = null;
    }
  }

  /* ------------------------------ 消息通道 ------------------------------ */
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'BB_TOGGLE') {
        toggle(msg.open).then((visible) => sendResponse({ ok: true, visible }));
        return true;
      }
      if (msg.type === 'BB_STATE') {
        sendResponse({ ok: true, visible: !!(overlay && overlay.visible), version: BBDY.version });
        return true;
      }
      if (msg.type === 'BB_OPEN_VIDEO' && msg.bvid) {
        toggle(true).then(async (visible) => {
          const o = getOverlay();
          if (o.visible) {
            try {
              const list = await BBDY.api.spaceArc({ mid: 0, ps: 0 }).catch(() => []);
              BBDY.log('指定视频播放', msg.bvid);
            } catch (_) {}
          }
          sendResponse({ ok: true, visible });
        });
        return true;
      }
    });
  }

  /* --------------------------- 地址栏/快捷键触发 --------------------------- */
  function wantsAutoOpen() {
    try {
      const q = new URLSearchParams(location.search);
      return q.get('bbdy') === '1' || location.hash === '#bbdy';
    } catch (_) {
      return false;
    }
  }

  let modKey = false;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') modKey = true;
    // Alt + Shift + B 兜底（扩展快捷键没生效时也能用）
    if (e.altKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      e.preventDefault();
      toggle();
    }
    // 单独的 \ 键也可以开
    if (e.key === '\\' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
      e.preventDefault();
      toggle();
    }
  });

  BBDY.config.load().then(() => {
    paintLauncher();
    if (wantsAutoOpen()) {
      setTimeout(() => toggle(true), 300);
    }
  });
  BBDY.config.on('settings', () => paintLauncher());

  BBDY.toggleOverlay = toggle;
  BBDY.getOverlay = getOverlay;
  BBDY.log('content script ready v' + BBDY.version);
})();
