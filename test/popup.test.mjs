/**
 * popup.test.mjs —— 扩展壳（弹窗 / manifest / 后台）的静态自测
 *
 * 为什么需要：弹窗如果引用了 html 里不存在的 id，会出现「弹窗打开但没反应」这类
 * 只能靠肉眼发现的问题。这里用静态分析把它们在提交前就拦住。
 *
 *   node test/popup.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const extDir = path.join(root, 'extension');
const read = (p) => fs.readFileSync(path.join(extDir, p), 'utf8');

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

const mf = JSON.parse(read('manifest.json'));
const popupHtml = read('popup/popup.html');
const popupJs = read('popup/popup.js');
const bgJs = read('src/background.js');

check('manifest 是合法 JSON 且没有 BOM', () => {
  const buf = fs.readFileSync(path.join(extDir, 'manifest.json'));
  assert.notEqual(buf.subarray(0, 3).toString('hex'), 'efbbbf', 'manifest.json 带 BOM，会导致解析失败');
  assert.equal(mf.manifest_version, 3);
  assert.ok(/^\d+\.\d+\.\d+$/.test(mf.version), `版本号格式不对：${mf.version}`);
});

check('manifest 引用的文件都存在', () => {
  const files = [
    mf.background.service_worker,
    mf.action.default_popup,
    ...Object.values(mf.action.default_icon || {}),
    ...Object.values(mf.icons || {}),
    ...mf.content_scripts.flatMap((cs) => [...cs.js, ...(cs.css || [])]),
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(extDir, f)), `manifest 引用了不存在的文件：${f}`);
  }
});

check('popup.js 里用到的 id 在 popup.html 里都存在', () => {
  const ids = new Set();
  for (const m of popupJs.matchAll(/[\$]\(\s*['"]#([\w-]+)['"]\s*\)/g)) ids.add(m[1]);
  for (const m of popupJs.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) ids.add(m[1]);
  assert.ok(ids.size > 0, '没解析出任何 id，检查正则是否失效');
  const missing = [...ids].filter((id) => !new RegExp(`id=["']${id}["']`).test(popupHtml));
  assert.deepEqual(missing, [], `popup.html 缺少这些 id：${missing.join(', ')}`);
});

check('popup.html 里的设置项与 popup.js 的 DEFAULTS 对齐', () => {
  const defaultsBlock = /\bDEFAULTS\s*=\s*\{([\s\S]*?)\}/.exec(popupJs);
  assert.ok(defaultsBlock, '没有找到 DEFAULTS');
  const keys = [...defaultsBlock[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
  for (const k of keys) {
    assert.ok(new RegExp(`id=["']${k}["']`).test(popupHtml), `popup.html 里没有对应控件：${k}`);
  }
});

check('popup.html 引用的资源存在且脚本顺序正确', () => {
  for (const m of popupHtml.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const f = m[1];
    if (/^https?:/.test(f)) continue;
    assert.ok(fs.existsSync(path.join(extDir, 'popup', f)), `popup 引用了不存在的资源：${f}`);
  }
});

check('background.js 补注入列表与 manifest 的 content_scripts 完全一致', () => {
  const block = /CONTENT_JS\s*=\s*\[([\s\S]*?)\]/.exec(bgJs);
  assert.ok(block, '没找到 CONTENT_JS');
  const bgList = [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const mfList = mf.content_scripts[0].js;
  assert.deepEqual(bgList, mfList, '两处脚本列表不一致：后台补注入会漏文件或顺序错乱');

  const cssBlock = /CONTENT_CSS\s*=\s*\[([\s\S]*?)\]/.exec(bgJs);
  const bgCss = [...cssBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(bgCss, mf.content_scripts[0].css, '两处样式列表不一致');
  for (const f of bgList) assert.ok(fs.existsSync(path.join(extDir, f)), `background 引用了不存在的文件：${f}`);
});

check('manifest 的入口配置指向存在的弹窗与快捷键', () => {
  assert.equal(mf.action.default_popup, 'popup/popup.html', '默认弹窗没配好，点图标会没有菜单');
  assert.ok(mf.commands && mf.commands['toggle-feed'], '缺少 toggle-feed 快捷键定义');
  assert.ok(mf.commands['toggle-feed'].suggested_key.default, '快捷键没设默认值');
});

check('运行时代码里没有遗留的 showLauncher 引用', () => {
  const files = mf.content_scripts[0].js.concat(['popup/popup.js', 'src/background.js']);
  for (const f of files) {
    const text = read(f);
    // config.js 里的迁移逻辑是允许的，其它地方不该再出现
    if (f.endsWith('config.js')) continue;
    assert.ok(!/showLauncher/.test(text), `${f} 里还在用已废弃的 showLauncher`);
  }
});

check('所有源码文件都不带 BOM', () => {
  const walk = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(abs));
      else if (/\.(js|json|html|css|md)$/.test(e.name)) out.push(abs);
    }
    return out;
  };
  const bad = walk(extDir).filter((f) => fs.readFileSync(f).subarray(0, 3).toString('hex') === 'efbbbf');
  assert.deepEqual(bad.map((f) => path.relative(extDir, f)), [], '这些文件带 BOM，会导致解析失败');
});

console.log(`\ntests ${pass + fail}  pass ${pass}  fail ${fail}`);
if (fail) process.exitCode = 1;
