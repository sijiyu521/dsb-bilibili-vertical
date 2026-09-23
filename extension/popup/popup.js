/**
 * popup.js —— 扩展弹窗：开关视频流 + 几个最常用的设置
 */
const DEFAULTS = {
  entryMode: 'native',
  openOnVideoPage: false,
  hideRelated: true,
  muteOnStart: true,
  danmaku: true,
  autoplay: true,
  source: 'recommend',
};

const $ = (sel) => document.querySelector(sel);

async function loadSettings() {
  const got = await chrome.storage.sync.get('settings');
  const s = { ...DEFAULTS, ...(got.settings || {}) };
  for (const key of Object.keys(DEFAULTS)) {
    const node = document.getElementById(key);
    if (!node) continue;
    if (node.type === 'checkbox') node.checked = !!s[key];
    else node.value = s[key];
  }
}

async function savePatch(patch) {
  const got = await chrome.storage.sync.get('settings');
  const next = { ...DEFAULTS, ...(got.settings || {}), ...patch };
  await chrome.storage.sync.set({ settings: next });
}

function bindSetting(id) {
  const node = document.getElementById(id);
  if (!node) return;
  node.addEventListener('change', () => {
    const value = node.type === 'checkbox' ? node.checked : node.value;
    savePatch({ [id]: value });
    flash('已保存：' + id);
  });
}

let flashTimer = 0;
function flash(text) {
  const el = $('#status');
  el.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(refreshState, 1400);
}

async function refreshState() {
  const res = await chrome.runtime.sendMessage({ type: 'BB_POPUP_STATE' });
  const el = $('#status');
  const label = $('#toggle-label');
  const btn = $('#toggle');
  if (!res || !res.ok) {
    el.textContent = '无法读取状态';
    return;
  }
  if (!res.onBilibili) {
    el.textContent = '当前不是 B 站页面';
    btn.disabled = true;
    btn.style.opacity = '0.55';
    label.textContent = '请先打开 bilibili.com';
    $('#hint').textContent = '打开任意 B 站页面后回到这里点击即可开启';
    return;
  }
  btn.disabled = false;
  btn.style.opacity = '1';
  const open = !!(res.state && res.state.visible);
  label.textContent = open ? '关闭竖滑视频流' : '打开竖滑视频流';
  el.textContent = open ? '视频流正在运行' : '准备就绪';
  btn.dataset.open = open ? '1' : '0';
}

$('#toggle').addEventListener('click', async () => {
  const open = $('#toggle').dataset.open === '1';
  const res = await chrome.runtime.sendMessage({ type: 'BB_POPUP_TOGGLE', open: !open });
  if (!res || !res.ok) {
    flash('打开失败：' + ((res && (res.error || res.reason)) || '未知原因'));
    return;
  }
  setTimeout(refreshState, 250);
});

for (const id of Object.keys(DEFAULTS)) bindSetting(id);
loadSettings().then(refreshState);
