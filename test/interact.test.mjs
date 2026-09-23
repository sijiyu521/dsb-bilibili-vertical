/**
 * interact.test.mjs —— 弹窗互动（点赞/投币/收藏/评论）的行为自测
 *
 * 用一个极简 DOM 把 core/config/api/entry/content 真加载起来，
 * 然后 stub 掉网络调用，直接调用 content.js 暴露出来的 BBDY.interact()：
 * 验证「调用哪个接口、参数对不对、状态有没有落库、未登录会不会拦」。
 *
 *   node test/interact.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'extension', 'src');

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
    this.isConnected = false;
    this._listeners = {};
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
    return this._html || '';
  }
  set textContent(v) {
    this._text = String(v);
  }
  get textContent() {
    return this._text || '';
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
      if (!n) continue;
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

/* ============================ 环境 ============================ */
const documentRoot = new El('html');
const body = new El('body');
documentRoot.append(body);

const calls = [];
const clipboard = { text: '' };
const loginOpens = [];

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
  location: { href: 'https://www.bilibili.com/video/BV1GJ411x7h7/', pathname: '/video/BV1GJ411x7h7/', search: '', hash: '' },
  history: { pushState() {}, replaceState() {} },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  matchMedia: () => ({ matches: false }),
  navigator: { userAgent: 'Mozilla/5.0 test', clipboard: { writeText: async (t) => (clipboard.text = t) } },
  localStorage: { getItem: () => null, setItem() {} },
  CustomEvent: class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  },
  chrome: undefined,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = () => {};
sandbox.window.open = () => null;
sandbox.window.screen = { width: 1920, height: 1080 };

const ctx = vm.createContext(sandbox);
for (const f of ['core.js', 'config.js', 'api.js', 'entry.js', 'content.js']) {
  vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx, { filename: f });
}
const BBDY = sandbox.BBDY;

/* -------------------- stub 掉网络与覆盖层 -------------------- */
const item = {
  bvid: 'BV1GJ411x7h7',
  aid: 80433022,
  cid: 123,
  title: '测试视频',
  pic: 'https://i0.hdslb.com/x.jpg',
  owner: { mid: 42, name: '测试UP' },
  stat: { like: 100, coin: 10, fav: 20, reply: 5, view: 1000 },
  reqUser: { like: false },
};

let loggedIn = true;
const stub = {
  isLogin: () => loggedIn,
  view: async () => JSON.parse(JSON.stringify(item)),
  like: async (a) => (calls.push(['like', a]), { ok: true }),
  coin: async (a) => (calls.push(['coin', a]), { ok: true }),
  fav: async (a) => (calls.push(['fav', a]), { ok: true }),
  favFolders: async () => (calls.push(['favFolders']), [{ id: 999, title: '默认收藏夹' }]),
  nav: async () => ({ mid: 7, isLogin: true }),
  share: (bvid) => calls.push(['share', bvid]),
  openLogin: () => loginOpens.push(Date.now()),
};
Object.assign(BBDY.api, stub);

let commentOpened = null;
const overlayStub = {
  visible: true,
  item: null,
  actionbar: { setItem: () => calls.push(['actionbar.setItem']) },
  _interactState: () => ({}),
  openCommentsFor: async (it) => {
    commentOpened = it?.bvid || null;
    return true;
  },
  openSettings: () => {},
};
// content.js 会 lazy `new BBDY.Overlay()`，这里换成 stub（不加载真实 overlay/sheets/player）
BBDY.Overlay = function OverlayStub() {
  return overlayStub;
};

/* ============================ 用例 ============================ */
let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`✔ ${name}`);
  } catch (e) {
    fail++;
    console.log(`✖ ${name}`);
    console.log('   ' + String(e.message).split('\n')[0]);
  }
}

function reset() {
  calls.length = 0;
  loginOpens.length = 0;
  commentOpened = null;
  BBDY.config.state.interact = {};
  loggedIn = true;
  item.reqUser = { like: false };
  item.stat = { like: 100, coin: 10, fav: 20, reply: 5, view: 1000 };
  overlayStub.visible = true;
  overlayStub.item = null;
}

await check('state：返回当前视频信息与互动状态', async () => {
  reset();
  const r = await BBDY.interact('state', item.bvid);
  assert.equal(r.ok, true);
  assert.equal(r.state.bvid, item.bvid);
  assert.equal(r.state.title, '测试视频');
  assert.equal(r.state.up, '测试UP');
});

await check('点赞：调用 like(on=true) 并写入状态', async () => {
  reset();
  const r = await BBDY.interact('like', item.bvid);
  assert.equal(r.ok, true);
  const call = calls.find((c) => c[0] === 'like');
  assert.ok(call, '没有调用 like 接口');
  assert.equal(call[1].on, true, '首次点赞应该是 on=true');
  assert.equal(BBDY.config.getInteract(item.bvid).like, true, '状态没落库');
  assert.match(r.hint, /已点赞/);
});

await check('点赞：已赞再点变成取消（on=false）', async () => {
  reset();
  await BBDY.interact('like', item.bvid);
  calls.length = 0;
  const r = await BBDY.interact('like', item.bvid);
  const call = calls.find((c) => c[0] === 'like');
  assert.equal(call[1].on, false, '第二次应该取消点赞');
  assert.equal(BBDY.config.getInteract(item.bvid).like, false);
  assert.match(r.hint, /取消/);
});

await check('点赞：接口返回的 reqUser.like=true 时视为已赞（续上一状态）', async () => {
  reset();
  item.reqUser = { like: true };
  const r = await BBDY.interact('like', item.bvid);
  const call = calls.find((c) => c[0] === 'like');
  assert.equal(call[1].on, false, '服务端说已赞，点击应该是取消');
  assert.equal(r.ok, true);
});

await check('投币：调用 coin(count=2)，重复投币会被拦住', async () => {
  reset();
  const r1 = await BBDY.interact('coin', item.bvid);
  const call = calls.find((c) => c[0] === 'coin');
  assert.equal(call[1].count, 2, '应该投 2 个币');
  assert.equal(r1.ok, true);
  assert.equal(r1.state.stat.coin, 12, '币数应该 +2 后返回');

  calls.length = 0;
  const r2 = await BBDY.interact('coin', item.bvid);
  assert.equal(r2.ok, false);
  assert.equal(calls.filter((c) => c[0] === 'coin').length, 0, '已投过就不该再请求接口');
  assert.match(r2.hint, /已经投过/);
});

await check('收藏：使用默认收藏夹 id，并且可再次点击取消', async () => {
  reset();
  const r1 = await BBDY.interact('fav', item.bvid);
  const call = calls.find((c) => c[0] === 'fav');
  assert.equal(call[1].on, true);
  assert.equal(call[1].addIds, 999, '应该用默认收藏夹 id');
  assert.match(r1.hint, /默认收藏夹/);

  calls.length = 0;
  const r2 = await BBDY.interact('fav', item.bvid);
  const call2 = calls.find((c) => c[0] === 'fav');
  assert.equal(call2[1].on, false);
  assert.equal(call2[1].delIds, 999);
  assert.match(r2.hint, /取消收藏/);
});

await check('评论：优先打开覆盖层里的评论抽屉', async () => {
  reset();
  const r = await BBDY.interact('comment', item.bvid);
  assert.equal(r.ok, true);
  assert.equal(commentOpened, item.bvid, '应该调用 openCommentsFor');
  assert.match(clipboard.text, /bilibili\.com\/video\/BV1GJ411x7h7/, '应该顺手复制了链接');
});

await check('未登录：拦截点赞并唤起登录，不发请求', async () => {
  reset();
  loggedIn = false;
  const r = await BBDY.interact('like', item.bvid);
  assert.equal(r.ok, false);
  assert.equal(calls.filter((c) => c[0] === 'like').length, 0, '未登录不该调接口');
  assert.equal(loginOpens.length, 1, '应该唤起登录');
  assert.equal(BBDY.config.getInteract(item.bvid).like, undefined, '未登录不该写状态');
});

await check('没有 bvid：直接返回失败提示，不抛异常', async () => {
  reset();
  const r = await BBDY.interact('like', '');
  assert.equal(r.ok, false);
  assert.ok(r.hint);
});

await check('未知动作：返回失败而不是崩溃', async () => {
  reset();
  const r = await BBDY.interact('unknown-action', item.bvid);
  assert.equal(r.ok, false);
  assert.match(r.hint, /未知操作/);
});

/* -------------------- 消息通道的静态一致性 -------------------- */
await check('弹窗发的消息类型，后台与内容脚本都有对应处理', async () => {
  const popup = fs.readFileSync(path.join(here, '..', 'extension', 'popup', 'popup.js'), 'utf8');
  const bg = fs.readFileSync(path.join(srcDir, 'background.js'), 'utf8');
  const content = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');
  const sent = [...new Set([...popup.matchAll(/type:\s*'([A-Z_]+)'/g)].map((m) => m[1]))];
  assert.ok(sent.length >= 3, '没解析到弹窗发送的消息类型');
  for (const t of sent) {
    const inBg = bg.includes(`'${t}'`);
    const inContent = content.includes(`'${t}'`);
    assert.ok(inBg || inContent, `没有任何地方处理消息类型 ${t}`);
  }
  // 后台转发给内容脚本的 BB_ACTION 必须被内容脚本处理
  assert.ok(bg.includes("'BB_ACTION'"), '后台没有处理/转发 BB_ACTION');
  assert.ok(content.includes("'BB_ACTION'"), '内容脚本没有处理 BB_ACTION');
});

console.log(`\ntests ${pass + fail}  pass ${pass}  fail ${fail}`);
if (fail) process.exitCode = 1;
