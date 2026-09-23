/**
 * build-release.mjs —— 打出可发布的 zip（零依赖，自己写 ZIP）
 *
 *   node tools/build-release.mjs
 *
 * 产出：
 *   release/dsb-bilibili-vertical-v1.0.0.zip   整包（extension/ + demo/ + tools/ + 文档）
 *   release/extension-v1.0.0.zip               纯扩展包（解压即可"加载已解压的扩展程序"）
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
const version = pkg.version;
const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });

/* --------------------------------- ZIP --------------------------------- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return ((crc ^ -1) >>> 0) >>> 0;
}

/** @param {{name:string, data:Buffer}[]} entries */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    // 压缩后没变小就存原始数据
    const useDeflate = deflated.length < e.data.length;
    const payload = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date（1980-01-01，保证可复现）
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

/* ------------------------------ 收集文件 ------------------------------ */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.npm-cache', '.tools', 'release']);

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(abs, rel));
    else out.push({ rel, abs });
  }
  return out;
}

const everything = walk(root).filter((f) => f.rel !== 'package-lock.json');
const zipName = `dsb-bilibili-vertical-v${version}`;
const fullEntries = everything.map((f) => ({
  name: `${zipName}/${f.rel}`,
  data: fs.readFileSync(f.abs),
}));

const extEntries = everything
  .filter((f) => f.rel.startsWith('extension/'))
  .map((f) => ({ name: f.rel.replace(/^extension\//, ''), data: fs.readFileSync(f.abs) }));

const fullPath = path.join(outDir, `${zipName}.zip`);
const extPath = path.join(outDir, `extension-v${version}.zip`);
fs.writeFileSync(fullPath, makeZip(fullEntries));
fs.writeFileSync(extPath, makeZip(extEntries));

console.log(`版本 ${version}`);
console.log(`  ${path.relative(root, fullPath)}  ${fullEntries.length} 个文件  ${(fs.statSync(fullPath).size / 1024).toFixed(1)} KB`);
console.log(`  ${path.relative(root, extPath)}  ${extEntries.length} 个文件  ${(fs.statSync(extPath).size / 1024).toFixed(1)} KB`);
console.log('校验用的 SHA256：');
for (const p of [fullPath, extPath]) {
  const h = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  console.log(`  ${path.basename(p)}  ${h}`);
}
