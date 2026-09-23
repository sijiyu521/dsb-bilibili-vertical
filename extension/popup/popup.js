/**
 * popup.js —— 扩展弹窗
 *  1. 开关竖滑视频流
 *  2. 对「正在播放的视频」（或当前视频页）直接点赞 / 投币 / 收藏 / 评论
 *  3. 几个最常用的设置
 *
 * 注意：真实的互动请求交给内容脚本执行——弹窗自己既拿不到 csrf cookie，
 * 也拿不到评论接口需要的 aid（oid）。
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

/* ------------------------------ 设置 ------------------------------ */
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

/* ------------------------------ 提示行 ------------------------------ */
let flashTimer = 0;
function flash(text, ms = 1600) {
  const el = $('#status');
  el.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(refreshState, ms);
}

const fmt = (n) => {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
  return String(n);
};

/* ------------------------------ 互动 ------------------------------ */
const ACTS = ['like', 'coin', 'fav', 'comment'];
let currentBvid = '';

function renderActionState(state) {
  const box = $('#actions');
  if (!state || !state.bvid) {
    box.hidden = true;
    return;
  }
  currentBvid = state.bvid;
  box.hidden = false;
  $('#act-title').textContent = state.title || state.bvid;
  $('#act-up').textContent = (state.up ? 'UP：' + state.up + '　' : '') + state.bvid;
  const cover = $('#act-cover');
  cover.src = state.pic || '';
  cover.onerror = () => {
    cover.style.visibility = 'hidden';
  };
  cover.onload = () => {
    cover.style.visibility = 'visible';
  };

  const stat = state.stat || {};
  const it = state.interact || {};
  const nums = { like: stat.like, coin: stat.coin, fav: stat.fav, comment: stat.reply };
  for (const act of ACTS) {
    const btn = box.querySelector(`.act[data-act="${act}"]`);
    const on = !!it[act];
    btn.classList.toggle('on', on);
    btn.disabled = act === 'coin' && on; // B 站不支持撤币
    const numEl = btn.querySelector(`[data-num="${act}"]`);
    if (act === 'coin' && on) numEl.textContent = '已投';
    else if (act === 'fav' && on) numEl.textContent = '已藏';
    else numEl.textContent = fmt(nums[act]);
  }
}

async function loadActions() {
  if (!currentBvid) {
    $('#actions').hidden = true;
    return;
  }
  const res = await chrome.runtime.sendMessage({ type: 'BB_ACTION', action: 'state', bvid: currentBvid });
  if (res && res.ok && res.state) renderActionState(res.state);
  else $('#actions').hidden = true;
}

async function doAction(act) {
  if (!currentBvid) return;
  const btn = $(`.act[data-act="${act}"]`);
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'BB_ACTION', action: act, bvid: currentBvid });
    if (res && res.ok) {
      if (res.state) renderActionState(res.state);
      flash(res.hint || '已完成');
      btn.classList.add('act-flash');
      setTimeout(() => btn.classList.remove('act-flash'), 520);
    } else {
      flash((res && res.hint) || '操作失败');
      // 失败后重新拉一次真实状态，避免按钮卡在错误状态
      setTimeout(loadActions, 400);
    }
  } catch (e) {
    flash('操作失败：' + (e && e.message ? e.message : e));
  } finally {
    btn.disabled = false;
    if (act === 'coin' && currentBvid) setTimeout(loadActions, 600);
  }
}

for (const act of ACTS) {
  const btn = $(`.act[data-act="${act}"]`);
  if (btn) btn.addEventListener('click', () => doAction(act));
}

/* ------------------------------ 状态 ------------------------------ */
async function refreshState() {
  // 注意：MV3 的 service worker 空闲 30 秒就会被浏览器停掉（扩展页里显示「不活动」是正常的）。
  // 这里发消息本身就会把它唤醒，所以只要弹窗能显示内容，就说明后台是活的。
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
    $('#actions').hidden = true;
    return;
  }

  if (!res.onBilibili) {
    el.textContent = '当前不是 B 站页面';
    btn.disabled = true;
    btn.style.opacity = '0.55';
    label.textContent = '请先打开 bilibili.com';
    hint.textContent = '打开任意 B 站页面后回到这里点击即可开启';
    $('#actions').hidden = true;
    return;
  }

  btn.disabled = false;
  btn.style.opacity = '1';
  const open = !!(res.state && res.state.visible);
  label.textContent = open ? '关闭竖滑视频流' : '打开竖滑视频流';
  btn.dataset.open = open ? '1' : '0';

  // 入口状态
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

  // 互动目标
  currentBvid = res.bvid || '';
  await loadActions();
  if (!currentBvid) {
    $('#act-title').textContent = '当前页面没有可互动的视频';
  }
}

$('#toggle').addEventListener('click', async () => {
  const open = $('#toggle').dataset.open === '1';
  const res = await chrome.runtime.sendMessage({ type: 'BB_POPUP_TOGGLE', open: !open });
  if (!res || !res.ok) {
    flash('打开失败：' + ((res && (res.error || res.reason || res.hint)) || '未知原因'));
    return;
  }
  setTimeout(refreshState, 400);
});

for (const id of Object.keys(DEFAULTS)) bindSetting(id);
loadSettings().then(refreshState);
