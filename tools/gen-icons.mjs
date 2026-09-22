/**
 * gen-icons.mjs —— 生成扩展图标（纯 Node，无需任何依赖）
 * 画一个 B 站粉圆角方块 + 白色播放三角 + 底部上滑箭头，输出 16/32/48/128 PNG。
 *
 *   node tools/gen-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'extension', 'icons');
fs.mkdirSync(outDir, { recursive: true });

/* ------------------------------- 绘图基元 ------------------------------- */
function makeCanvas(size) {
  const px = new Float64Array(size * size * 4); // RGBA 0..1，预乘 alpha 由合成时计算
  return { size, px };
}

function over(canvas, x, y, r, g, b, a) {
  if (a <= 0) return;
  const { size, px } = canvas;
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  const dr = px[i], dg = px[i + 1], db = px[i + 2], da = px[i + 3];
  const na = a + da * (1 - a);
  if (na <= 0) return;
  px[i] = (r * a + dr * da * (1 - a)) / na;
  px[i + 1] = (g * a + dg * da * (1 - a)) / na;
  px[i + 2] = (b * a + db * da * (1 - a)) / na;
  px[i + 3] = na;
}

/** 4x 超采样画形状，得到平滑边缘；color 为 null 时使用 canvas.tint（用于渐变） */
const SS = 4;
function drawShape(canvas, color, sdf) {
  const { size } = canvas;
  const step = 1 / SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;
          if (sdf(px, py) <= 0) acc++;
        }
      }
      const a = acc / (SS * SS);
      const col = color || canvas.tint || [1, 0, 1, 1];
      if (a > 0) over(canvas, x, y, col[0], col[1], col[2], a * (col[3] ?? 1));
    }
  }
}

const sdRoundRect = (x0, y0, x1, y1, r) => (x, y) => {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(x - cx) - hx;
  const dy = Math.abs(y - cy) - hy;
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
};

const sdCircle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

/** 三角形（重心符号距离：内部 < 0） */
const sdTriangle = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const cross = (ox, oy, px2, py2, qx, qy) => (px2 - ox) * (qy - oy) - (py2 - oy) * (qx - ox);
  const d1 = cross(ax, ay, bx, by, x, y);
  const d2 = cross(bx, by, cx, cy, x, y);
  const d3 = cross(cx, cy, ax, ay, x, y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  if (!(hasNeg && hasPos)) return -1; // 内部
  // 外部：取到三条边的最小距离
  const segDist = (ox, oy, px2, py2) => {
    const vx = px2 - ox, vy = py2 - oy;
    const t = Math.max(0, Math.min(1, ((x - ox) * vx + (y - oy) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(x - (ox + vx * t), y - (oy + vy * t));
  };
  return Math.min(segDist(ax, ay, bx, by), segDist(bx, by, cx, cy), segDist(cx, cy, ax, ay));
};

/* ------------------------------- PNG 编码 ------------------------------- */
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(canvas) {
  const { size, px } = canvas;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const a = px[i + 3];
      // 输出非预乘
      const un = (v) => Math.max(0, Math.min(255, Math.round((a > 0 ? v : 0) * 255)));
      raw[p++] = un(px[i]);
      raw[p++] = un(px[i + 1]);
      raw[p++] = un(px[i + 2]);
      raw[p++] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------- 画图标 ------------------------------- */
const PINK = [0.984, 0.447, 0.6];
const PINK_DARK = [0.878, 0.353, 0.502];
const WHITE = [1, 1, 1];

function renderIcon(size) {
  const c = makeCanvas(size);
  const S = (v) => (v / 128) * size; // 以 128 为设计基准
  // 底：圆角方块 + 纵向渐变（整块一次画完，避免逐行叠加产生的接缝）
  drawShape(c, null, (x, y) => {
    const t = y / size;
    c.tint = [
      PINK[0] + (PINK_DARK[0] - PINK[0]) * t,
      PINK[1] + (PINK_DARK[1] - PINK[1]) * t,
      PINK[2] + (PINK_DARK[2] - PINK[2]) * t,
      1,
    ];
    return sdRoundRect(S(3), S(3), S(125), S(125), S(30))(x, y);
  });
  // 播放三角
  drawShape(c, WHITE, sdTriangle(S(50), S(34), S(50), S(82), S(88), S(58)));
  // 底部上滑箭头（暗示"刷"）
  drawShape(c, [1, 1, 1, 0.95], sdTriangle(S(52), S(102), S(76), S(102), S(64), S(88)));
  drawShape(c, [1, 1, 1, 0.95], sdRoundRect(S(60.5), S(98), S(67.5), S(114), S(3.5)));
  return c;
}

for (const size of [16, 32, 48, 128]) {
  const png = encodePng(renderIcon(size));
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
