/**
 * test/entry.test.mjs —— 入口注入的静态 + 行为自测（纯离线，自带极简 DOM）
 *
 * 覆盖：
 *   - BV 号解析
 *   - 顶栏药丸插在头像左边；视频页药丸插在互动栏末尾
 *   - 视频页「更多」菜单：并入 B 站原生菜单 / 兜底同款菜单 / 点击后的动作分发
 *   - 选择器链降级、重复注入、顶栏重建后重插、锚点全缺失时退回悬浮按钮
 *   - manifest 与 demo 页面的一致性
 *
 *   node test/entry.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const srcDir = path.join(root, 'extension', 'src');

/* ============================ 极简 DOM ============================ */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attrs = {};
    this.style = {};
    this.dataset = {};
    this._classes = new Set();
    this._listeners = {};
    this._html = '';
    this.isConnected = false;
  }
  get classList() {
    const self = this;
    return {
      add: (...c) => c.forEach((x) => x && self._classes.add(x)),
      remove: (...c) => c.forEach((x) => self._classes.delete(x)),
      contains: (c) => self._classes.has(c),
      toggle: (c, on) =>
        on === undefined
          ? self._classes.has(c)
            ? self._classes.delete(c)
            : self._classes.add(c)
          : on
          ? self._classes.add(c)
          : self._classes.delete(c),
    };
  }
  get className() {
    return [...this._classes].join(' ');
  }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  set innerHTML(v) {
    this._html = String(v);
    this.children = [];
  }
  get innerHTML() {
    return this._html;
  }
  set textContent(v) {
    this._text = String(v);
  }
  get textContent() {
    return this._text ?? '';
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') this.className = v;
  }
  getAttribute(k) {
    return this.attrs[k];
  }
  get id() {
    return this.attrs.id || '';
  }
  set id(v) {
    this.attrs.id = String(v);
  }
  append(...nodes) {
    for (const n of nodes) {
      if (n == null) continue;
      if (n.parentElement) n.parentElement.children = n.parentElement.children.filter((x) => x !== n);
      n.parentElement = this;
      n.isConnected = true;
      this.children.push(n);
    }
  }
  appendChild(n) {
    this.append(n);
    return n;
  }
  before(node) {
    const p = this.parentElement;
    if (!p) return;
    if (node.parentElement) node.parentElement.children = node.parentElement.children.filter((x) => x !== node);
    node.parentElement = p;
    node.isConnected = true;
    const i = p.children.indexOf(this);
    p.children.splice(i < 0 ? p.children.length : i, 0, node);
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this);
    this.parentElement = null;
    this.isConnected = false;
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  removeEventListener() {}
  setPointerCapture() {}
  click() {
    for (const fn of this._listeners?.click || []) {
      fn({ preventDefault() {}, stopPropagation() {}, target: this, type: 'click' });
    }
  }
  dispatchEvent() {
    return true;
  }
  matches() {
    return false;
  }
  contains(node) {
    for (let n = node; n; n = n.parentElement) if (n === this) return true;
    return false;
  }
  get offsetParent() {
    return this.isConnected ? this.parentElement : null;
  }
  getBoundingClientRect() {
    return { left: 120, top: 300, bottom: 340, width: 100, height: 40 };
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (matches(n, sel)) return n;
      n = n.parentElement;
    }
    return null;
  }
  querySelector(sel) {
    return query(this, sel, true);
  }
  querySelectorAll(sel) {
    return query(this, sel, false);
  }
}

function matchesSimple(el, sel) {
  sel = sel.trim();
  if (!sel) return true;
  const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
  if (attr) {
    const v = el.attrs[attr[1]];
    if (v === undefined) return false;
    return attr[2] === undefined || v === attr[2];
  }
  if (sel.startsWith('.')) return sel.slice(1).split('.').every((c) => el._classes.has(c));
  if (sel.startsWith('#')) return el.attrs.id === sel.slice(1);
  return el.tagName === sel.toUpperCase();
}

function matches(el, sel) {
  const parts = sel.trim().split(/\s+/);
  if (!matchesSimple(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  let n = el.parentElement;
  while (i >= 0 && n) {
    if (matchesSimple(n, parts[i])) i--;
    n = n.parentElement;
  }
  return i < 0;
}

function walk(node, out = []) {
  for (const c of node.children) {
    out.push(c);
    walk(c, out);
  }
  return out;
}
function query(root, sel, first) {
  const nodes = Array.isArray(root) ? root : walk(root);
  const all = nodes.filter((n) => matches(n, sel));
  return first ? all[0] || null : all;
}

/** 触发元素的 click 监听（shim 只记录，不会自动触发） */
function clickEl(el) {
  const fire = (node) => {
    for (const fn of node._listeners?.click || []) {
      fn({ preventDefault() {}, stopPropagation() {}, target: el, key: 'click' });
    }
  };
  fire(el);
  for (let p = el.parentElement; p; p = p.parentElement) fire(p);
}

/* ============================ 组装环境 ============================ */
const documentRoot = new El('html');
const body = new El('body');
documentRoot.append(body);

const sandbox = {
  console: { log() {}, warn() {}, error() {}, info() {} },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Date,
  Math,
  JSON,
  Number,
  String,
  Object,
  Array,
  Promise,
  URL,
  URLSearchParams,
  performance: { now: () => Date.now() },
  document: {
    documentElement: documentRoot,
    body,
    createElement: (t) => new El(t),
    querySelector: (s) => query(documentRoot, s, true),
    querySelectorAll: (s) => query(documentRoot, s, false),
    addEventListener() {},
    removeEventListener() {},
    cookie: 'bili_jct=testtoken',
  },
  location: {
    href: 'https://www.bilibili.com/video/BV1GJ411x7h7/',
    pathname: '/video/BV1GJ411x7h7/',
    search: '',
    hash: '',
  },
  history: { pushState() {}, replaceState() {} },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  matchMedia: () => ({ matches: false }),
  navigator: { userAgent: 'Mozilla/5.0 test' },
  localStorage: { getItem: () => null, setItem() {} },
  chrome: undefined,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const { createContext, runInContext } = await import('node:vm');
const ctx = createContext(sandbox);
for (const f of ['core.js', 'config.js', 'api.js', 'feed.js', 'icons.js', 'entry.js']) {
  runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx, { filename: f });
}
const BBDY = sandbox.BBDY;
// 测试代码里直接写 document 更顺手（指的就是 shim 的那个）
const document = sandbox.document;
const MARK = BBDY.entry.MARK;
const MENU_MARK = BBDY.entry.MENU_MARK;

/** entry.js 会通过 BBDY.getOverlay() 拿覆盖层，这里放一个行为可观察的替身 */
const overlayStub = {
  visible: false,
  item: null,
  calls: [],
  shown: [],
  show(opts) {
    this.visible = true;
    this.shown.push(opts || {});
    this.calls.push(['show', opts?.seed]);
  },
  menuAction(key) {
    this.calls.push([key]);
    return true;
  },
  commentsFor(bvid) {
    this.calls.push(['comments', bvid]);
  },
};
BBDY.getOverlay = () => overlayStub;
BBDY.openFromUi = (bvid) => overlayStub.show({ seed: bvid });

/* ============================ 用例 ============================ */
let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`✔ ${name}`);
  } catch (e) {
    fail++;
    console.log(`✖ ${name}`);
    console.log('   ' + String(e.message).split('\n')[0]);
  }
}

function resetBody() {
  const kill = (n) => {
    for (const c of n.children) kill(c);
    n.parentElement = null;
    n.isConnected = false;
  };
  for (const c of body.children) kill(c);
  body.children = [];
  overlayStub.visible = false;
  overlayStub.item = null;
  overlayStub.calls = [];
  overlayStub.shown = [];
}

/* ---------------------------- 基础 ---------------------------- */
check('BV 号解析：视频页取路径里的 BV', () => {
  assert.equal(BBDY.entry.currentBvid(), 'BV1GJ411x7h7');
  assert.equal(BBDY.entry.isVideoPage(), true);
});

check('BV 号解析：非视频页返回空', () => {
  const oldPath = sandbox.location.pathname;
  sandbox.location.pathname = '/';
  assert.equal(BBDY.entry.currentBvid(), '');
  assert.equal(BBDY.entry.isVideoPage(), false);
  sandbox.location.pathname = oldPath;
});

/* ---------------------------- 页面骨架 ---------------------------- */
function buildFakeBilibili() {
  resetBody();
  const bar = new El('div');
  bar.className = 'bili-header__bar';
  const left = new El('div');
  left.className = 'left-entry';
  const right = new El('div');
  right.className = 'right-entry right-entry__main';
  const vip = new El('a');
  vip.className = 'right-entry__item right-entry__item-trigger';
  const msg = new El('a');
  msg.className = 'right-entry__item right-entry__item-trigger';
  const avatarWrap = new El('div');
  avatarWrap.className = 'header-avatar-wrap right-entry__item';
  const avatar = new El('div');
  avatar.className = 'header-avatar';
  avatarWrap.append(avatar);
  right.append(vip, msg, avatarWrap);
  bar.append(left, right);

  const toolbar = new El('div');
  toolbar.id = 'arc_toolbar_report';
  const tleft = new El('div');
  tleft.className = 'video-toolbar-left';
  const tmain = new El('div');
  tmain.className = 'video-toolbar-left-main';
  const like = new El('div');
  like.className = 'video-like video-toolbar-left-item';
  tmain.append(like);
  tleft.append(tmain);
  toolbar.append(tleft);

  body.append(bar, toolbar);
  return { bar, right, avatarWrap, tmain, like, toolbar };
}

/** 视频页：互动栏 + B 站自己的「更多」菜单容器 */
function buildFakeVideoPage({ withNativeMenu = true } = {}) {
  const ui = buildFakeBilibili();
  const more = new El('div');
  more.className = 'video-tool-more video-toolbar-left-item';
  ui.tmain.append(more);

  let dropdown = null;
  if (withNativeMenu) {
    const popover = new El('div');
    popover.className = 'video-tool-more-popover';
    dropdown = new El('div');
    dropdown.className = 'video-tool-more-dropdown';
    const nativeItem = new El('div');
    nativeItem.className = 'dropdown-item';
    nativeItem.innerHTML = '<span class="bbdy-vmenu-text">举报</span>';
    dropdown.append(nativeItem);
    popover.append(dropdown);
    body.append(popover);
  }
  return { ...ui, more, dropdown };
}

/* ---------------------------- 药丸位置 ---------------------------- */
check('顶栏入口插在头像左边，而不是整栏末尾', () => {
  const ui = buildFakeBilibili();
  BBDY.entry.placePill('nav', [{ sel: '.right-entry__main', pos: 'beforeAvatar' }]);
  const pill = document.querySelector(`[${MARK}="nav"]`);
  assert.ok(pill, '药丸没有插进去');
  const idx = ui.right.children.indexOf(pill);
  const avatarIdx = ui.right.children.indexOf(ui.avatarWrap);
  assert.equal(idx, avatarIdx - 1, `药丸应紧挨在头像左侧（实际 ${idx} / 头像 ${avatarIdx}）`);
  assert.ok(pill.innerHTML.includes('竖滑刷'), '药丸应该有文案');
});

check('视频页入口插在互动栏最后', () => {
  const ui = buildFakeBilibili();
  BBDY.entry.placePill('toolbar', [{ sel: '#arc_toolbar_report .video-toolbar-left-main', pos: 'append' }]);
  const pill = document.querySelector(`[${MARK}="toolbar"]`);
  assert.ok(pill, '互动栏入口没有插进去');
  assert.equal(ui.tmain.children[ui.tmain.children.length - 1], pill);
});

check('重复注入不会产生第二个药丸', () => {
  buildFakeBilibili();
  BBDY.entry.placePill('nav', [{ sel: '.right-entry__main', pos: 'beforeAvatar' }]);
  BBDY.entry.placePill('nav', [{ sel: '.right-entry__main', pos: 'beforeAvatar' }]);
  BBDY.entry.placePill('nav', [{ sel: '.right-entry__main', pos: 'beforeAvatar' }]);
  const pills = query(documentRoot, `[${MARK}="nav"]`, false).filter((n) => n.isConnected);
  assert.equal(pills.length, 1, `应该只有一个存活，实际 ${pills.length} 个`);
});

check('旧节点脱离文档后，重新注入的是新节点', () => {
  buildFakeBilibili();
  BBDY.entry.placePill('nav', [{ sel: '.right-entry__main', pos: 'beforeAvatar' }]);
  const first = query(documentRoot, `[${MARK}="nav"]`, false).find((n) => n.isConnected);
  assert.ok(first, '第一次注入失败');
  buildFakeBilibili(); // 模拟 B 站重建顶栏，旧节点被丢弃
  BBDY.entry.placePill('nav', [{ sel: '.right-entry__main', pos: 'beforeAvatar' }]);
  const alive = query(documentRoot, `[${MARK}="nav"]`, false).filter((n) => n.isConnected);
  assert.equal(alive.length, 1, `存活药丸数量应为 1，实际 ${alive.length}`);
  assert.notEqual(alive[0], first, '应该是新节点，而不是复用了脱离文档的旧节点');
});

check('选择器链：首选锚点缺失时退到下一个', () => {
  const ui = buildFakeBilibili();
  ui.right.className = 'right-entry';
  BBDY.entry.placePill('nav', [
    { sel: '.right-entry__main', pos: 'beforeAvatar' },
    { sel: '.right-entry', pos: 'beforeAvatar' },
  ]);
  const pill = document.querySelector(`[${MARK}="nav"]`);
  assert.ok(pill, '兜底选择器没生效');
  assert.equal(pill.parentElement, ui.right);
});

check('锚点全都不存在时安静失败，不抛错', () => {
  resetBody();
  const ok = BBDY.entry.placePill('nav', [{ sel: '.right-entry__main', pos: 'beforeAvatar' }]);
  assert.equal(ok, false);
  assert.equal(document.querySelector(`[${MARK}="nav"]`), null);
});

/* ---------------------------- 悬浮兜底 ---------------------------- */
check('悬浮按钮在顶栏入口成功时不出现', () => {
  buildFakeBilibili();
  BBDY.entry.placePill('nav', [{ sel: '.right-entry__main', pos: 'beforeAvatar' }]);
  BBDY.config.state.settings = { ...BBDY.config.DEFAULTS, entryMode: 'native' };
  BBDY.entry.paintLauncher();
  assert.equal(document.querySelector('.bbdy-launcher'), null, '顶栏成功了就不该再有悬浮按钮');
});

check('顶栏结构改版（锚点找不到）时自动退回悬浮按钮', () => {
  resetBody();
  BBDY.config.state.settings = { ...BBDY.config.DEFAULTS, entryMode: 'native' };
  BBDY.entry.paintLauncher();
  const floating = document.querySelector('.bbdy-launcher');
  assert.ok(floating, '应该出现悬浮按钮兜底');
  assert.equal(floating.parentElement, body);
});

check('entryMode=hidden 时既不注入也不留悬浮按钮', () => {
  buildFakeBilibili();
  BBDY.config.state.settings = { ...BBDY.config.DEFAULTS, entryMode: 'hidden' };
  BBDY.entry.paintLauncher();
  assert.equal(document.querySelector('.bbdy-launcher'), null);
});

/* ---------------------------- 视频页菜单 ---------------------------- */
check('菜单项齐全且顺序正确', () => {
  const keys = Array.from(BBDY.entry.menuItems(), (i) => i.key);
  assert.deepEqual(keys, ['feed', 'comment', 'uponly', 'dislike', 'copy']);
  for (const item of BBDY.entry.menuItems()) {
    assert.ok(item.icon && item.text, `菜单项 ${item.key} 缺少图标或文案`);
    assert.ok(BBDY.icons.get(item.icon), `菜单项 ${item.key} 用了不存在的图标：${item.icon}`);
  }
});

check('并入 B 站原生「更多」菜单：追加在原生项之后', () => {
  const ui = buildFakeVideoPage();
  assert.equal(BBDY.entry.injectNativeMenu(), true);
  const group = ui.dropdown.querySelector(`[${MENU_MARK}="native"]`);
  assert.ok(group, '没有注入到原生菜单里');
  assert.equal(group.parentElement, ui.dropdown, '应该挂在原生 dropdown 容器里');
  assert.equal(ui.dropdown.children[ui.dropdown.children.length - 1], group, '应该排在原生项之后');
  assert.equal(group.children.length, 5, `应该有 5 个菜单项，实际 ${group.children.length}`);
  assert.ok(group.children[0].className.includes('dropdown-item'), '应该复用 B 站的 dropdown-item 类');
  for (const row of group.children) {
    assert.ok(!/undefined/.test(row.innerHTML), '菜单项文案里不该出现 undefined');
  }
});

check('重复注入只会有一组菜单项', () => {
  const ui = buildFakeVideoPage();
  BBDY.entry.injectNativeMenu();
  BBDY.entry.injectNativeMenu();
  BBDY.entry.injectNativeMenu();
  const groups = ui.dropdown.querySelectorAll(`[${MENU_MARK}="native"]`).filter((n) => n.isConnected);
  assert.equal(groups.length, 1, `应该只有一组，实际 ${groups.length}`);
});

check('原生菜单不存在时不报错，返回 false', () => {
  buildFakeVideoPage({ withNativeMenu: false });
  assert.equal(BBDY.entry.injectNativeMenu(), false);
});

check('兜底菜单：参数与项数正确，且能关闭', () => {
  buildFakeVideoPage({ withNativeMenu: false });
  const pill = BBDY.entry.buildPill('toolbar');
  body.append(pill);
  const menu = BBDY.entry.openFallbackMenu(pill);
  assert.ok(menu, '没有弹出兜底菜单');
  assert.equal(menu.className, 'bbdy-vmenu');
  assert.equal(menu.children.length, 5, '兜底菜单也应该是 5 项');
  assert.equal(document.querySelector('.bbdy-vmenu'), menu);
  BBDY.entry.closeFallbackMenu();
  assert.equal(document.querySelector('.bbdy-vmenu'), null, '应该能关掉');
});

check('点「竖滑模式刷视频」→ 打开视频流并带上当前 BV 号', () => {
  buildFakeVideoPage();
  const pill = BBDY.entry.buildPill('toolbar');
  body.append(pill);
  const menu = BBDY.entry.openFallbackMenu(pill);
  clickEl(menu.children[0]);
  assert.equal(overlayStub.shown.length, 1, '应该调用了打开视频流');
  assert.equal(overlayStub.shown[0].seed, 'BV1GJ411x7h7', '应该把当前视频作为种子');
  assert.equal(document.querySelector('.bbdy-vmenu'), null, '点完应该自动收起菜单');
});

check('菜单项点击后：评论/UP/不感兴趣/复制 落到对应动作', () => {
  buildFakeVideoPage();
  overlayStub.visible = true;
  overlayStub.item = { bvid: 'BV1GJ411x7h7' };
  const pill = BBDY.entry.buildPill('toolbar');
  body.append(pill);
  for (const [idx, expect] of [
    [1, 'comments'],
    [2, 'uponly'],
    [3, 'dislike'],
    [4, 'copy'],
  ]) {
    const menu = BBDY.entry.openFallbackMenu(pill);
    const row = menu.children[idx];
    assert.ok(row, `兜底菜单第 ${idx} 项不存在`);
    clickEl(row);
    assert.equal(overlayStub.calls.at(-1)[0], expect, `第 ${idx} 项应该触发 ${expect}`);
  }
});

check('原生菜单里的项点击后同样能触发动作', () => {
  const ui = buildFakeVideoPage();
  overlayStub.visible = true;
  overlayStub.item = { bvid: 'BV1GJ411x7h7' };
  BBDY.entry.injectNativeMenu();
  const group = ui.dropdown.querySelector(`[${MENU_MARK}="native"]`);
  clickEl(group.children[3]); // 不感兴趣
  assert.equal(overlayStub.calls.at(-1)[0], 'dislike');
});

/* ---------------------------- 一致性 ---------------------------- */
check('manifest 里 entry.js 在 content.js 之前、且引用文件都存在', () => {
  const mf = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  const js = mf.content_scripts[0].js;
  const iEntry = js.indexOf('src/entry.js');
  const iContent = js.indexOf('src/content.js');
  assert.ok(iEntry >= 0, 'manifest 没加载 entry.js');
  assert.ok(iEntry < iContent, 'entry.js 必须在 content.js 之前加载');
  for (const f of js) {
    assert.ok(fs.existsSync(path.join(root, 'extension', f)), `manifest 引用了不存在的文件：${f}`);
  }
  for (const f of mf.content_scripts[0].css) {
    assert.ok(fs.existsSync(path.join(root, 'extension', f)), `manifest 引用了不存在的样式：${f}`);
  }
});

check('demo 页面保留了配套的假顶栏 / 假互动栏 / 假菜单结构', () => {
  const html = fs.readFileSync(path.join(root, 'demo', 'index.html'), 'utf8');
  for (const token of [
    'right-entry__main',
    'header-avatar-wrap',
    'video-toolbar-left-main',
    'video-tool-more-popover',
    'video-tool-more-dropdown',
    '/src/entry.js',
  ]) {
    assert.ok(html.includes(token), `demo 页面缺少 ${token}`);
  }
  assert.ok(html.indexOf('/src/entry.js') < html.indexOf('/src/content.js'), 'demo 加载顺序应与 manifest 一致');
});

check('菜单样式：兜底菜单用了 B 站同款参数（最小宽/圆角/内边距）', () => {
  const css = fs.readFileSync(path.join(srcDir, 'styles.css'), 'utf8');
  const block = /\.bbdy-vmenu\s*\{([\s\S]*?)\}/.exec(css);
  assert.ok(block, '没有找到 .bbdy-vmenu 样式');
  const body = block[1];
  assert.match(body, /min-width:\s*17[0-9]px/, '最小宽度应该和 B 站的 142px 量级一致（留给长文案）');
  assert.match(body, /padding:\s*12px 0/, '内边距应该照抄 B 站的 12px 0');
  assert.match(body, /border-radius:\s*8px/, '圆角应该照抄 B 站的 8px');
  assert.match(css, /\.bbdy-vmenu-native\s*\{/, '缺少原生菜单注入组的样式');
});

console.log(`\ntests ${pass + fail}  pass ${pass}  fail ${fail}`);
if (fail) process.exitCode = 1;
