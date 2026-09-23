/**
 * background.js —— Service Worker
 *
 * 只做一件事：把「扩展图标 / 快捷键 / 弹窗」这三个入口翻译成给内容脚本的消息，
 * 并在内容脚本缺失时补注入。
 *
 * ⚠️ 关于「Service Worker 不活动」：
 *   MV3 规定后台空闲约 30 秒后由浏览器停止，所以扩展页里显示「不活动」是正常的。
 *   本文件**不保存任何跨请求状态**（每次调用都重新查 tab、重新 ping），
 *   因此冷启动和被唤醒后行为完全一致；任何消息都会自动唤醒它。
 */
const CONTENT_JS = [
  'src/core.js',
  'src/config.js',
  'src/api.js',
  'src/feed.js',
  'src/icons.js',
  'src/entry.js',
  'src/ui/sheets.js',
  'src/ui/player.js',
  'src/ui/actionbar.js',
  'src/ui/comments.js',
  'src/ui/settings.js',
  'src/ui/overlay.js',
  'src/content.js',
];
const CONTENT_CSS = ['src/styles.css'];

function isBilibili(url) {
  try {
    const u = new URL(url);
    return /(^|\.)bilibili\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

async function ping(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'BB_STATE' });
  } catch {
    return null;
  }
}

async function ensureInjected(tabId) {
  const state = await ping(tabId);
  if (state) return state;
  await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS });
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_JS });
  return { ok: true, injected: true };
}

/** 在页面上飘一条提示（内容脚本没注入时会在下一帧重试一次） */
async function flash(tabId, text) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg) => {
        const show = () => {
          const BBDY = globalThis.BBDY;
          if (!BBDY || !BBDY.sheets || !BBDY.getOverlay) return false;
          const host = BBDY.getOverlay().root?.isConnected ? BBDY.getOverlay().root : document.body;
          BBDY.sheets.toast(host, msg, { bottom: true, ms: 2600 });
          return true;
        };
        if (!show()) {
          const s = document.createElement('div');
          s.textContent = msg;
          s.style.cssText =
            'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483600;' +
            'background:rgba(0,0,0,.82);color:#fff;font:14px/1.6 -apple-system,"Microsoft YaHei",sans-serif;' +
            'padding:12px 20px;border-radius:12px;max-width:70vw;text-align:center;pointer-events:none';
          document.body.append(s);
          setTimeout(() => s.remove(), 2800);
        }
      },
      args: [text],
    });
  } catch (_) {
    /* 注入失败就算了，别因为这个报错 */
  }
}

async function toggleOnTab(tab, open) {
  if (!tab || !tab.id || !isBilibili(tab.url || '')) {
    if (tab && tab.id) {
      await flash(tab.id, '请先在 bilibili.com 页面上使用「刷B站」');
    }
    return { ok: false, reason: 'not-bilibili' };
  }
  try {
    await ensureInjected(tab.id);
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'BB_TOGGLE', open });
    return res || { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

chrome.action?.onClicked?.addListener(async (tab) => {
  await toggleOnTab(tab, undefined);
});

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== 'toggle-feed') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await toggleOnTab(tab, undefined);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg !== 'object') return sendResponse({ ok: false });
    if (msg.type === 'BB_POPUP_TOGGLE') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      sendResponse(await toggleOnTab(tab, msg.open));
      return;
    }
    if (msg.type === 'BB_POPUP_STATE') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const state = tab && tab.id ? await ping(tab.id) : null;
      sendResponse({ ok: true, state, onBilibili: isBilibili(tab?.url || ''), tabId: tab?.id });
      return;
    }
    sendResponse({ ok: false, unknown: msg.type });
  })();
  return true;
});
