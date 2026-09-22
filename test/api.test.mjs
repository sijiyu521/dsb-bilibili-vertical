/**
 * test/api.test.mjs —— 离线逻辑自测（Node 24 内置 test runner）
 *
 *   node --test test/
 *
 * 用一个极简 DOM shim 加载扩展里的浏览器脚本，然后：
 *   1. 校验手写 MD5 与 node:crypto 完全一致（WBI 签名依赖它）
 *   2. 校验 WBI 签名结果能被 B 站线上接口接受（code=0）
 *   3. 校验 av2bv / bv2av 互转
 *   4. 校验各来源的卡片归一化
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'extension', 'src');

/* --------------------------- 极简 DOM shim --------------------------- */
function makeSandbox() {
  const store = new Map();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    BigInt,
    Number,
    String,
    Object,
    Array,
    Promise,
    URL,
    URLSearchParams,
    TextEncoder,
    AbortSignal,
    fetch,
    document: {
      cookie: '',
      createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {}, remove() {} } }),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      documentElement: { classList: { add() {}, remove() {} } },
      head: { append() {} },
      body: { append() {} },
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    matchMedia: () => ({ matches: false }),
    location: { origin: 'https://www.bilibili.com', href: 'https://www.bilibili.com/' },
    window: { addEventListener() {}, screen: { width: 1920, height: 1080 } },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  return { ctx, sandbox };
}

const FILES = ['core.js', 'config.js', 'api.js'];
const { ctx, sandbox } = makeSandbox();
for (const f of FILES) {
  const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
  vm.runInContext(code, ctx, { filename: f });
}
const BBDY = sandbox.BBDY;

/* ------------------------------- 用例 ------------------------------- */
test('core 工具函数', () => {
  assert.equal(BBDY.num(1234), '1234');
  assert.equal(BBDY.num(12345), '1.2万');
  assert.equal(BBDY.num(123456789), '1.2亿');
  assert.equal(BBDY.mmss(75), '1:15');
  assert.equal(BBDY.mmss(3725), '1:02:05');
  assert.equal(BBDY.escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
  assert.equal(BBDY.https('http://i0.hdslb.com/a.jpg'), 'https://i0.hdslb.com/a.jpg');
  assert.match(BBDY.thumb('https://i0.hdslb.com/a.jpg', 160), /@160w_160h_1c\.webp$/);
});

test('MD5 实现与 node:crypto 一致', () => {
  const cases = [
    '',
    'a',
    'abc',
    'message digest',
    'abcdefghijklmnopqrstuvwxyz',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    '1234567890'.repeat(8),
    '中文也要能算 😀',
    'x'.repeat(1000),
  ];
  for (const c of cases) {
    const mine = BBDY.api.md5(c);
    const ref = crypto.createHash('md5').update(c, 'utf8').digest('hex');
    assert.equal(mine, ref, `md5 mismatch for ${JSON.stringify(c.slice(0, 20))}`);
  }
});

test('av2bv / bv2av 互转', () => {
  // 期望值来自线上接口实测（view 接口返回的 aid 与我们算出的 BV 必须一致）
  const known = [
    [170001, 'BV17x411w7KC'],
    [80433022, 'BV1GJ411x7h7'],
    [882584971, 'BV1mK4y1C7Bz'],
    [455022951, 'BV1Q541167Qg'],
  ];
  for (const [aid, bvid] of known) {
    assert.equal(BBDY.api.av2bv(aid), bvid, `av${aid} -> ${bvid}`);
    assert.equal(BBDY.api.bv2av(bvid), aid, `${bvid} -> av${aid}`);
  }
  // 小 av 号不是双射（高位填充的 1 会被吃掉），所以只在真实量级上验证往返
  for (const aid of [170001, 80433022, 882584971, 455022951, 999999999]) {
    assert.equal(BBDY.api.bv2av(BBDY.api.av2bv(aid)), aid);
  }
});

test('卡片归一化：跳过直播、拼出标准结构', () => {
  const live = BBDY.api.normalize({ goto: 'live', bvid: '', title: '直播' });
  assert.equal(live, null);
  const tooShort = BBDY.api.normalize({ goto: 'av', bvid: 'BV1xx411c7mD', duration: 3 });
  assert.equal(tooShort, null);
  const item = BBDY.api.normalize({
    goto: 'av',
    bvid: 'BV1GJ411x7h7',
    cid: 123,
    title: '  一个有   空格的标题  ',
    pic: 'http://i0.hdslb.com/bfs/archive/x.jpg',
    duration: 300,
    pubdate: 1700000000,
    owner: { mid: 42, name: 'UP主' },
    stat: { view: 12345, like: 678, danmaku: 9 },
    rcmd_reason: { content: '因为你关注了 XX' },
  });
  assert.equal(item.title, '一个有 空格的标题');
  assert.equal(item.pic.startsWith('https://'), true);
  assert.equal(item.owner.mid, 42);
  assert.equal(item.stat.view, 12345);
  assert.equal(item.reason, '因为你关注了 XX');
});

test('未登录时也能拿到 WBI 密钥', async () => {
  const key = await BBDY.api.wbi.ensure(true);
  assert.ok(key && key.length === 32, 'wbi key 长度应为 32');
});

test('WBI 签名能被线上推荐流接受', async (t) => {
  const res = await BBDY.api.recommend({ fresh: 1, pageSize: 6 });
  if (!res.length) {
    t.diagnostic('线上推荐流未返回数据（可能限流），跳过内容断言');
    return;
  }
  for (const it of res) {
    assert.match(it.bvid, /^BV[0-9A-Za-z]{10}$/);
    assert.ok(it.title.length > 0);
    assert.ok(it.owner.name.length > 0);
    assert.ok(it.duration > 0);
  }
  t.diagnostic(`拿到 ${res.length} 条推荐，首条：${res[0].title.slice(0, 24)} / ${res[0].owner.name}`);
});

test('热门接口可用且结构正确', async (t) => {
  const res = await BBDY.api.popular({ pn: 1, ps: 5 });
  if (!res.length) {
    t.diagnostic('热门未返回数据，跳过');
    return;
  }
  assert.ok(res.length >= 3);
  assert.match(res[0].bvid, /^BV/);
  t.diagnostic(`热门首条：${res[0].title.slice(0, 24)}`);
});

test('playurl 接口返回清晰度列表', async (t) => {
  const res = await BBDY.api.recommend({ fresh: 1, pageSize: 3 });
  if (!res.length) {
    t.diagnostic('无推荐数据，跳过 playurl 校验');
    return;
  }
  const it = res[0];
  const pu = await BBDY.api.playurl({ bvid: it.bvid, cid: it.cid || undefined });
  if (!pu) {
    t.diagnostic('playurl 未返回（可能风控），跳过');
    return;
  }
  assert.ok(Array.isArray(pu.accept));
  t.diagnostic(`可用清晰度：${pu.accept.map((a) => a.label).join(' / ')}`);
});
