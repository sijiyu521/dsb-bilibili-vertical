/**
 * background.js —— Service Worker
 * 只做两件事：把「点扩展图标 / 按快捷键」翻译成给内容脚本的消息，以及在缺内容脚本时补注入。
 */

const CONTENT_JS = [
  'src/core.js',
  'src/config.js',
  'src/api.js',
  'src/feed.js',
  'src/icons.js',
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

async function toggleOnTab(tab, open) {
  if (!tab || !tab.id || !isBilibili(tab.url || '')) {
    chrome.notifications?.create?.({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '刷B站',
      message: '请在 bilibili.com 页面上使用（先打开 B 站任意页面）',
    });
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
      sendResponse({ ok: true, state, onBilibili: isBilibili(tab?.url || '') });
      return;
    }
    sendResponse({ ok: false, unknown: msg.type });
  })();
  return true;
});
