/**
 * test-entry.mjs —— 入口注入的静态一致性自测
 *
 * 做的事：
 *   1. 把 entry.js 放进一个极简 DOM shim 里跑起来（不依赖浏览器）
 *   2. 用「从 B 站真实页面结构里抽出来的 class 名」搭一个假顶栏 / 假互动栏，验证注入位置对不对
 *   3. 顺手校验 manifest 的脚本加载顺序，以及 demo 页面里有没有配套的假结构
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

/* ============================ 极简 DOM 实现 ============================ */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attrs = {};
    this.style = {};
    this.dataset = {};
    this._classes = new Set();
    this._html = '';
    this.isConnected = false;
  }
  get classList() {
    const self = this;
    return {
      add: (...c) => c.forEach((x) => x && self._classes.add(x)),
      remove: (...c) => c.forEach((x) => self._classes.delete(x)),
      contains: (c) => self._classes.has(c),
      toggle: (c, on) => (on === undefined ? (self._classes.has(c) ? self._classes.delete(c) : self._classes.add(c)) : on ? self._classes.add(c) : self._classes.delete(c)),
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
  // 真实 DOM 里 el.id = 'x' 会反映到 #id 选择器上，这里保持一致
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
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((x) => x !== this);
    }
    this.parentElement = null;
    this.isConnected = false;
  }
  addEventListener() {}
  removeEventListener() {}
  setPointerCapture() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 100 };
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (matches(n, sel)) return n;
      n = n.parentElement;
    }
    return null;
  }
  get ownerDocument() {
    let n = this;
    while (n.parentElement) n = n.parentElement;
    return n;
  }
  querySelector(sel) {
    return query(this, sel, true);
  }
  querySelectorAll(sel) {
    return query(this, sel, false);
  }
}

/** 支持：.a  .a.b  [attr="v"]  tag，以及空格分隔的后代选择器（如 "#id .cls"） */
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
  // 剩下的部分必须能在祖先里按顺序找到
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

/* ============================ 组装测试环境 ============================ */
const documentRoot = new El('html');
const body = new El('body');
documentRoot.append(body);

const sandbox = {
  console,
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
  },
  location: { href: 'https://www.bilibili.com/video/BV1GJ411x7h7/', pathname: '/video/BV1GJ411x7h7/', search: '', hash: '' },
  history: { pushState() {}, replaceState() {} },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  matchMedia: () => ({ matches: false }),
  chrome: undefined,
  localStorage: { getItem: () => null, setItem() {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.navigator = { userAgent: 'Mozilla/5.0 test' };

const { createContext, runInContext } = await import('node:vm');
const ctx = createContext(sandbox);
for (const f of ['core.js', 'config.js', 'api.js', 'feed.js', 'icons.js', 'entry.js']) {
  runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx, { filename: f });
}
const BBDY = sandbox.BBDY;
// 测试代码里直接写 document 更顺手（指的就是 shim 的那个）
const document = sandbox.document;

/* ============================ 造一个像 B 站那样的页面 ============================ */
function buildFakeBilibili() {
  // 彻底清空（连 parentElement 也要断开，模拟真实页面的组件卸载）
  const kill = (n) => {
    for (const c of n.children) kill(c);
    n.parentElement = null;
    n.isConnected = false;
  };
  for (const c of body.children) kill(c);
  body.children = [];
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
  toolbar.className = 'video-toolbar-container';
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
  return { bar, right, avatarWrap, tmain, like };
}

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

const MARK = BBDY.entry.MARK;

check('BV 号解析：视频页取路径里的 BV', () => {
  assert.equal(BBDY.entry.currentBvid(), 'BV1GJ411x7h7');
  assert.equal(BBDY.entry.isVideoPage(), true);
});

check('BV 号解析：非视频页返回空', () => {
  const old = sandbox.location.href;
  sandbox.location.href = 'https://www.bilibili.com/';
  sandbox.location.pathname = '/';
  assert.equal(BBDY.entry.currentBvid(), '');
  assert.equal(BBDY.entry.isVideoPage(), false);
  sandbox.location.href = old;
  sandbox.location.pathname = '/video/BV1GJ411x7h7/';
});

check('顶栏入口插在头像左边，而不是整栏末尾', () => {
  const ui = buildFakeBilibili();
  BBDY.entry.placePill('nav', [{ sel: '.right-entry__main', pos: 'beforeAvatar' }]);
  const pill = document.querySelector(`[${MARK}="nav"]`);
  assert.ok(pill, '药丸没有插进去');
  const idx = ui.right.children.indexOf(pill);
  const avatarIdx = ui.right.children.indexOf(ui.avatarWrap);
  assert.equal(idx, avatarIdx - 1, `药丸应紧挨在头像左侧（实际 ${idx} / 头像 ${avatarIdx}）`);
  assert.equal(pill.className.includes('bbdy-pill'), true);
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
  // 把首选锚点去掉，只留 .right-entry
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
  body.children = [];
  const ok = BBDY.entry.placePill('nav', [{ sel: '.right-entry__main', pos: 'beforeAvatar' }]);
  assert.equal(ok, false);
  assert.equal(document.querySelector(`[${MARK}="nav"]`), null);
});

check('悬浮按钮在顶栏入口成功时不出现', () => {
  buildFakeBilibili();
  BBDY.entry.placePill('nav', [{ sel: '.right-entry__main', pos: 'beforeAvatar' }]);
  BBDY.config.state.settings = { ...BBDY.config.DEFAULTS, entryMode: 'native' };
  BBDY.entry.paintLauncher();
  assert.equal(document.querySelector('.bbdy-launcher'), null, '顶栏成功了就不该再有悬浮按钮');
});

check('顶栏结构改版（锚点找不到）时自动退回悬浮按钮', () => {
  body.children = [];
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

check('manifest 里 entry.js 在 content.js 之前、且存在', () => {
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

check('demo 页面保留了配套的假顶栏 / 假互动栏结构与脚本顺序', () => {
  const html = fs.readFileSync(path.join(root, 'demo', 'index.html'), 'utf8');
  for (const token of ['right-entry__main', 'header-avatar-wrap', 'video-toolbar-left-main', '/src/entry.js']) {
    assert.ok(html.includes(token), `demo 页面缺少 ${token}`);
  }
  assert.ok(html.indexOf('/src/entry.js') < html.indexOf('/src/content.js'), 'demo 加载顺序应与 manifest 一致');
});

console.log(`\ntests ${pass + fail}  pass ${pass}  fail ${fail}`);
if (fail) process.exitCode = 1;
