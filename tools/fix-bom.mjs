/**
 * fix-bom.mjs —— 去掉文本文件开头的 UTF-8 BOM
 *
 * 为什么需要它：PowerShell 的 Set-Content -Encoding UTF8 会写入 BOM（EF BB BF），
 * 而带 BOM 的 manifest.json / JSON / JS 会导致浏览器或 JSON.parse 直接报错。
 * 这个脚本把所有发布相关文本文件的 BOM 清掉，并打印处理结果。
 *
 *   node tools/fix-bom.mjs            # 检查并修复
 *   node tools/fix-bom.mjs --check    # 只检查，不改（有 BOM 时退出码 1，可用于 CI）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const checkOnly = process.argv.includes('--check');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const SKIP_DIRS = new Set(['.git', 'node_modules', '.npm-cache', '.tools', 'release']);
const TEXT_EXT = new Set(['.json', '.js', '.mjs', '.cjs', '.css', '.html', '.md', '.txt', '.yml', '.yaml']);

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(abs, rel));
    else out.push({ rel, abs });
  }
  return out;
}

const files = walk(root).filter((f) => {
  const ext = path.extname(f.rel).toLowerCase();
  return TEXT_EXT.has(ext) || path.basename(f.rel).startsWith('.');
});

let fixed = 0;
let bad = 0;
for (const f of files) {
  const buf = fs.readFileSync(f.abs);
  if (!buf.subarray(0, 3).equals(BOM)) continue;
  bad++;
  if (checkOnly) {
    console.log(`  BOM  ${f.rel}`);
    continue;
  }
  fs.writeFileSync(f.abs, buf.subarray(3));
  console.log(`  已去除 BOM  ${f.rel}`);
  fixed++;
}

if (!bad) {
  console.log(`检查了 ${files.length} 个文本文件，没有发现 BOM`);
} else if (checkOnly) {
  console.log(`\n发现 ${bad} 个文件带 BOM（会导致 manifest.json / JSON 解析失败）`);
  process.exitCode = 1;
} else {
  console.log(`\n共修复 ${fixed} 个文件`);
}
