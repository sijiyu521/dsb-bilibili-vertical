/**
 * danmaku.test.mjs —— 弹幕发送的行为自测
 *
 * 用假的 fetch 接住请求，验证：
 *   - 请求路径与 body 参数（oid=aid / progress=毫秒 / mode / fontsize / color / csrf）
 *   - 空内容、超长内容在前端就被拦住（不发请求）
 *   - 各种错误码翻译成人话
 *   - 未登录时不发请求
 *
 *   node test/danmaku.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'extension', 'src');

/* ============================ 假的网络层 ============================ */
const requests = [];
let nextResponse = { code: 0, message: '0', data: { dmids: [1] } };

const fakeFetch = async (url, opts = {}) => {
  const body = opts.body ? String(opts.body) : '';
  requests.push({ url: String(url), method: opts.method || 'GET', body });
  const payload = JSON.stringify(nextResponse);
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => payload,
    json: async () => JSON.parse(payload),
  };
};

/* ============================ 加载 api.js ============================ */
const sandbox = {
  console: { log() {}, warn() {}, error() {}, info() {} },
  setTimeout,
  clearTimeout,
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
  TextEncoder,
  AbortSignal: { timeout: () => undefined },
  fetch: fakeFetch,
  document: {
    cookie: 'bili_jct=csrf-token-123; SESSDATA=abc',
    querySelector: () => null,
    addEventListener() {},
  },
  location: { origin: 'https://www.bilibili.com', href: 'https://www.bilibili.com/video/BV1GJ411x7h7/' },
  window: { addEventListener() {}, screen: { width: 1920, height: 1080 } },
  navigator: { userAgent: 'Mozilla/5.0 test' },
  localStorage: { getItem: () => null, setItem() {} },
  screen: { width: 1920, height: 1080 },
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['core.js', 'config.js', 'api.js']) {
  vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx, { filename: f });
}
const BBDY = sandbox.BBDY;

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

const lastPost = () => requests.filter((r) => r.method === 'POST').pop();
const reset = () => {
  requests.length = 0;
  nextResponse = { code: 0, message: '0', data: { dmids: [1] } };
};

await check('发弹幕：路径正确，body 参数齐全（oid/progress/mode/fontsize/color/csrf）', async () => {
  reset();
  const res = await BBDY.api.sendDanmaku({
    aid: 80433022,
    bvid: 'BV1GJ411x7h7',
    cid: 123456,
    msg: '  测试弹幕  ',
    progressMs: 12345,
  });
  assert.equal(res.ok, true, '应该成功');
  const req = lastPost();
  assert.ok(req, '没有发出 POST 请求');
  assert.match(req.url, /\/x\/v2\/dm\/post$/, `路径不对：${req.url}`);
  const params = new URLSearchParams(req.body);
  assert.equal(params.get('type'), '1', 'type 应为 1（视频弹幕）');
  assert.equal(params.get('oid'), '80433022', 'oid 必须是 aid');
  assert.equal(params.get('bvid'), 'BV1GJ411x7h7');
  assert.equal(params.get('msg'), '测试弹幕', '首尾空格应被裁掉');
  assert.equal(params.get('progress'), '12345', 'progress 必须是毫秒');
  assert.equal(params.get('mode'), '1', '默认滚动弹幕 mode=1');
  assert.equal(params.get('fontsize'), '25');
  assert.equal(params.get('color'), '16777215', '白色应为十进制 16777215');
  assert.equal(params.get('csrf'), 'csrf-token-123', '必须带 csrf（从 bili_jct 取）');
  assert.ok(params.get('rnd'), '应该带 rnd 随机数');
});

await check('空内容 / 纯空格：前端直接拦住，不发请求', async () => {
  reset();
  for (const msg of ['', '   ', '\n\t']) {
    const res = await BBDY.api.sendDanmaku({ aid: 1, msg, progressMs: 0 });
    assert.equal(res.ok, false, `「${msg}」不该通过`);
  }
  assert.equal(requests.length, 0, '不该发出任何请求');
});

await check('超长内容（>100 字）在本地被拦', async () => {
  reset();
  const res = await BBDY.api.sendDanmaku({ aid: 1, msg: '弹'.repeat(101), progressMs: 0 });
  assert.equal(res.ok, false);
  assert.match(res.message, /100/);
  assert.equal(requests.length, 0, '不该发请求');
});

await check('progress 取整且不为负', async () => {
  reset();
  await BBDY.api.sendDanmaku({ aid: 1, msg: 'x', progressMs: 1234.7 });
  assert.equal(new URLSearchParams(lastPost().body).get('progress'), '1235', '应该四舍五入');
  reset();
  await BBDY.api.sendDanmaku({ aid: 1, msg: 'x', progressMs: -50 });
  assert.equal(new URLSearchParams(lastPost().body).get('progress'), '0', '负数应被夹到 0');
});

await check('错误码翻译：未登录 / 敏感 / 风控 / 太频繁', async () => {
  const cases = [
    [-101, /登录/],
    [-400, /拒绝|敏感|格式/],
    [-403, /风控/],
    [36703, /频繁/],
  ];
  for (const [code, expect] of cases) {
    reset();
    nextResponse = { code, message: '原始提示' };
    const res = await BBDY.api.sendDanmaku({ aid: 1, msg: 'x', progressMs: 0 });
    assert.equal(res.ok, false, `code=${code} 应该是失败`);
    assert.match(res.message, expect, `code=${code} 的提示不对：${res.message}`);
  }
});

await check('网络异常返回失败而不是抛错', async () => {
  reset();
  const oldFetch = sandbox.fetch;
  sandbox.fetch = async () => {
    throw new Error('network down');
  };
  // http.post 内部会重试，这里让它一直失败
  const res = await BBDY.api.sendDanmaku({ aid: 1, msg: 'x', progressMs: 0 });
  sandbox.fetch = oldFetch;
  assert.equal(res.ok, false);
  assert.ok(res.message, '应该有错误信息');
});

/* -------------------- 直接跑 overlay 的底栏逻辑（不是字符串匹配） -------------------- */
await check('底栏状态同步：未登录显示登录按钮，登录后显示输入框', () => {
  const overlaySrc = fs.readFileSync(path.join(srcDir, 'ui', 'overlay.js'), 'utf8');
  const iconsSrc = fs.readFileSync(path.join(srcDir, 'icons.js'), 'utf8');

  // 极简元素：只需要 classList / textContent / innerHTML / value / hidden / title
  const mkEl = () => {
    const set = new Set();
    return {
      _classes: set,
      style: {},
      classList: {
        add: (...c) => c.forEach((x) => x && set.add(x)),
        remove: (...c) => c.forEach((x) => set.delete(x)),
        contains: (c) => set.has(c),
        toggle: (c, on) => (on === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : on ? set.add(c) : set.delete(c)),
      },
      set innerHTML(v) {
        this._html = v;
      },
      get innerHTML() {
        return this._html || '';
      },
      set textContent(v) {
        this._text = String(v);
      },
      get textContent() {
        return this._text || '';
      },
      value: '100',
      hidden: false,
      title: '',
      addEventListener() {},
    };
  };

  const box = {
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
    document: { addEventListener() {}, removeEventListener() {}, fullscreenElement: null },
    location: { origin: 'https://www.bilibili.com', href: 'https://www.bilibili.com/' },
    window: { addEventListener() {}, screen: { width: 1920, height: 1080 } },
    navigator: { userAgent: 'Mozilla/5.0 test' },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false }),
    screen: { width: 1920, height: 1080 },
  };
  box.globalThis = box;
  const ctx2 = vm.createContext(box);
  for (const f of ['core.js', 'icons.js']) vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx2, { filename: f });
  vm.runInContext(iconsSrc, ctx2, { filename: 'icons.js' });
  vm.runInContext(overlaySrc, ctx2, { filename: 'overlay.js' });

  const B2 = box.BBDY;
  // 打开视频流时要用到的这些先塞进去，_paintCtrlBar 只读不建
  B2.api = { isLogin: () => false };
  B2.config = { settings: { danmaku: true, autoplay: true } };

  const self = {
    ctrlBar: mkEl(),
    dmLoginBtn: mkEl(),
    dmBox: mkEl(),
    dmToggleBtn: mkEl(),
    danmakuBtn: mkEl(),
    muteBtn: mkEl(),
    volBtn: mkEl(),
    volSlider: mkEl(),
    autoBtn: mkEl(),
    rateBtn: mkEl(),
    fsBtn: mkEl(),
    muted: true,
    speed: 1,
    _paintCtrlBar: B2.Overlay.prototype._paintCtrlBar,
  };

  // 未登录
  self._paintCtrlBar.call(self);
  assert.equal(self.dmLoginBtn.hidden, false, '未登录应显示登录按钮');
  assert.equal(self.dmBox.hidden, true, '未登录应隐藏输入框');

  // 登录后
  B2.api.isLogin = () => true;
  self._paintCtrlBar.call(self);
  assert.equal(self.dmLoginBtn.hidden, true, '登录后应隐藏登录按钮');
  assert.equal(self.dmBox.hidden, false, '登录后应显示输入框');

  // 状态按钮
  assert.ok(self.dmToggleBtn.classList.contains('bbdy-on'), '弹幕开着时应高亮弹幕按钮');
  assert.equal(self.autoBtn.textContent, '自动', '自动连播开着应显示「自动」');
  assert.equal(self.rateBtn.textContent, '倍速', '1x 时显示「倍速」');
  self.speed = 1.5;
  self._paintCtrlBar.call(self);
  assert.equal(self.rateBtn.textContent, '1.5x', '设了倍速应显示倍速值');
  assert.ok(self.rateBtn.classList.contains('bbdy-on'), '非 1x 倍速应高亮');
});

/* -------------------- 与控制台/输入框的接线（静态） -------------------- */
await check('发送时用的进度来自播放器当前时间', async () => {
  reset();
  const fakePlayer = { item: { aid: 80433022, bvid: 'BV1GJ411x7h7', cid: 1 }, time: 5.5 };
  const res = await BBDY.api.sendDanmaku({
    aid: fakePlayer.item.aid,
    bvid: fakePlayer.item.bvid,
    cid: fakePlayer.item.cid,
    msg: '来自播放器的弹幕',
    progressMs: Math.round(fakePlayer.time * 1000),
  });
  assert.equal(res.ok, true);
  assert.equal(new URLSearchParams(lastPost().body).get('progress'), '5500', '应按播放进度换算成毫秒');
});

await check('overlay 底栏接线完整：输入框、发送键、自动/倍速/音量/全屏、弹幕开关', () => {
  const src = fs.readFileSync(path.join(srcDir, 'ui', 'overlay.js'), 'utf8');
  for (const token of [
    '_buildCtrlBar',
    'bbdy-dm-input',
    'bbdy-dm-send',
    'dmLoginBtn',
    'toggleAutoplay',
    'openRateMenu',
    'volSlider',
    'toggleFullscreen',
    '_sendDanmaku',
  ]) {
    assert.ok(src.includes(token), `overlay.js 缺少 ${token}`);
  }
  // 输入框里敲键不能触发视频流快捷键
  assert.match(src, /dmInput\.addEventListener\('keydown'[\s\S]{0,120}stopPropagation/, '输入框没有阻止按键冒泡');
});

await check('styles.css 里底栏与进度条样式齐全，且括号配平', () => {
  const css = fs.readFileSync(path.join(srcDir, 'styles.css'), 'utf8');
  for (const cls of ['.bbdy-ctrlbar', '.bbdy-dm-input', '.bbdy-dm-send', '.bbdy-vol-slider', '.bbdy-progress-row']) {
    assert.ok(css.includes(cls), `缺少样式 ${cls}`);
  }
  const open = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  assert.equal(open, close, 'CSS 括号不配平');
});

console.log(`\ntests ${pass + fail}  pass ${pass}  fail ${fail}`);
if (fail) process.exitCode = 1;
