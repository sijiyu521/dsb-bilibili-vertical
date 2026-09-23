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
  // 注意：MV3 的 service worker 空闲 30 秒就会被浏览器停掉（扩展页里显示「不活动」是正常的）。
  // 这里发消息本身就会把它唤醒，所以只要这个弹窗能显示内容，就说明后台是活的。
  let res = null;
  try {
    res = await chrome.runtime.sendMessage({ type: 'BB_POPUP_STATE' });
  } catch (e) {
    res = null;
  }
  const el = $('#status');
  const label = $('#toggle-label');
  const btn = $('#toggle');
  const hint = $('#hint');

  if (!res || !res.ok) {
    el.textContent = '后台没响应，点一下按钮试试（会自动唤醒）';
    btn.disabled = true;
    btn.style.opacity = '0.55';
    return;
  }

  if (!res.onBilibili) {
    el.innerHTML = '当前不是 B 站页面';
    btn.disabled = true;
    btn.style.opacity = '0.55';
    label.textContent = '请先打开 bilibili.com';
    hint.textContent = '打开任意 B 站页面后回到这里点击即可开启';
    return;
  }

  btn.disabled = false;
  btn.style.opacity = '1';
  const open = !!(res.state && res.state.visible);
  label.textContent = open ? '关闭竖滑视频流' : '打开竖滑视频流';
  btn.dataset.open = open ? '1' : '0';

  // 把入口状态显示出来：能直接看出顶栏药丸有没有插上
  const e = (res.state && res.state.entry) || {};
  const marks = [
    e.nav ? '<b class="ok">顶栏入口 ✓</b>' : '<b class="bad">顶栏入口 ✗</b>',
    e.toolbar ? '<b class="ok">视频页入口 ✓</b>' : '<b class="bad">视频页入口 ✗</b>',
    e.floating ? '<b class="warn">悬浮兜底 ✓</b>' : '',
  ].filter(Boolean);
  const ver = (res.state && res.state.version) || '?';
  el.innerHTML = `v${ver}　${marks.join('　')}`;
  hint.innerHTML = open
    ? '视频流正在运行 · <kbd>Esc</kbd> 退出'
    : '顶栏那颗粉色「竖滑刷」也是入口 · <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>';
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
