/**
 * demo-server.mjs —— 本地演示/调试服务（零依赖）
 *
 *   node demo/demo-server.mjs            # 默认 http://127.0.0.1:8788
 *   node demo/demo-server.mjs 9000
 *
 * 它做三件事：
 *   1. 把 demo/index.html 和 extension/src/* 原样发出去（demo 页面直接复用扩展源码，
 *      保证「演示看到什么，插件里就是什么」）
 *   2. 在 /mock/* 上假装成 api.bilibili.com，返回结构与真实接口一致的假数据
 *      （含 WBI 签名接口、playurl、弹幕、评论、点赞投币收藏、关注、不感兴趣等）
 *   3. 自己现搓一个 30 秒的 MP4 当作视频直链，并支持 Range 请求
 *
 * 这样不装扩展、不碰真实 B 站账号，也能把「滑动手感 / 播放 / 弹幕 / 评论 / 三连」跑通。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PORT = Number(process.argv[2] || 8788);
const DURATION = 30; // 假视频时长（秒）
const FPS = 2; // 抽帧频率：够小，一帧也能撑满整段时间轴

/* ===================================================================== *
 * 1. 现搓一个可播放的 MP4（单帧 H.264 IDR 循环 + 真实的 stts/stsz/stco 时间轴）
 * ===================================================================== */
const AVCC = Buffer.from('014d401fffe10004674d401f01000468ee3c80', 'hex');
const IDR = Buffer.from(
  '00000003000000010000001e00000001000000040000000100000003000000020000000300000002000000030000000300000002',
  'hex'
);
const SPS_PPS_IDR = Buffer.concat([
  Buffer.from('00000001674d401f', 'hex'),
  Buffer.from('0000000168ee3c80', 'hex'),
  Buffer.from('0000000109658808', 'hex'),
  IDR,
]);

function box(type, ...parts) {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, body]);
}
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff, 0);
  return b;
};
const str = (s) => Buffer.from(s, 'ascii');

function buildMp4(sampleCount, sampleSize, timeScale, width, height) {
  const ftyp = box('ftyp', str('isom'), u32(0x200), str('isomiso2avc1mp41'));
  const mdatPayload = Buffer.alloc(sampleSize * sampleCount);
  for (let i = 0; i < sampleCount; i++) SPS_PPS_IDR.copy(mdatPayload, i * sampleSize);

  const sampleOffsetBase = ftyp.length + 8; // mdat 头之后就是第一个样本
  const stbl = box(
    'stbl',
    box(
      'stsd',
      u32(0),
      u32(1),
      box(
        'avc1',
        Buffer.alloc(6),
        u16(1), // data_reference_index
        Buffer.alloc(16),
        u16(width),
        u16(height),
        u32(0x00480000),
        u32(0x00480000), // 72dpi
        u32(0),
        u16(1),
        Buffer.alloc(32),
        u16(0x0018), // depth
        u16(0xffff), // -1
        box('avcC', AVCC)
      )
    ),
    box('stts', u32(0), u32(1), u32(sampleCount), u32(Math.round(timeScale / FPS))),
    box('stsc', u32(0), u32(1), u32(1), u32(sampleCount), u32(1)),
    box('stsz', u32(0), u32(sampleSize), u32(sampleCount)),
    box('stco', u32(0), u32(1), u32(sampleOffsetBase))
  );
  const minf = box(
    'minf',
    box('vmhd', u32(0), u16(0), u16(0), u16(0), u16(0)),
    box('dinf', box('dref', u32(0), u32(1), box('url ', u32(1)))),
    stbl
  );
  const mdia = box(
    'mdia',
    box(
      'mdhd',
      u32(0),
      u32(0),
      u32(0),
      u32(timeScale),
      u32(Math.round((sampleCount / FPS) * timeScale)),
      u16(0x55c4),
      u16(0)
    ),
    box('hdlr', u32(0), u32(0), str('vide'), Buffer.alloc(12), str('VideoHandler\0')),
    minf
  );
  const trak = box(
    'trak',
    box(
      'tkhd',
      u32(7),
      u32(0),
      u32(0),
      u32(1),
      u32(0),
      u32(Math.round((sampleCount / FPS) * timeScale)),
      u32(0),
      u32(0),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0x00010000),
      u32(0),
      u32(0),
      u32(0),
      u32(0),
      u32(0x00010000),
      u32(0),
      u32(0),
      u32(0),
      u32(0),
      u32(0x40000000),
      u32(width << 16),
      u32(height << 16)
    ),
    mdia
  );
  const mvhd = box(
    'mvhd',
    u32(0),
    u32(0),
    u32(0),
    u32(timeScale),
    u32(Math.round((sampleCount / FPS) * timeScale)),
    u32(0x00010000),
    u16(0x0100),
    u16(0),
    u32(0),
    u32(0),
    u32(0x00010000),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0x00010000),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0x40000000),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(2)
  );
  const moov = box('moov', mvhd, trak);
  const mdat = box('mdat', mdatPayload);
  return Buffer.concat([ftyp, moov, mdat]);
}

const MP4 = buildMp4(Math.round(DURATION * FPS), SPS_PPS_IDR.length, 1000, 640, 360);

/* ===================================================================== *
 * 2. 假封面 / 假头像（BMP 体积小、格式简单）
 * ===================================================================== */
function bmp(hue) {
  const W = 640;
  const H = 360;
  const rowSize = Math.ceil((W * 3) / 4) * 4;
  const data = Buffer.alloc(rowSize * H);
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const hsl = (h, s, l) => {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = (x / W) * 0.25 + (y / H) * 0.12;
      const [r, g, b] = hsl((hue + t) % 1, 0.55, 0.28 + 0.22 * (1 - y / H));
      const off = (H - 1 - y) * rowSize + x * 3;
      data[off] = Math.round(b * 255);
      data[off + 1] = Math.round(g * 255);
      data[off + 2] = Math.round(r * 255);
    }
  }
  // 中间画一条白杠，方便肉眼确认画面有没有在动 / 有没有被裁切
  for (let y = Math.round(H * 0.3); y < Math.round(H * 0.34); y++) {
    for (let x = 0; x < W; x++) {
      const off = (H - 1 - y) * rowSize + x * 3;
      data[off] = data[off + 1] = data[off + 2] = 230;
    }
  }
  const head = Buffer.alloc(54);
  head.write('BM', 0, 'ascii');
  head.writeUInt32LE(54 + data.length, 2);
  head.writeUInt32LE(54, 10);
  head.writeUInt32LE(40, 14);
  head.writeInt32LE(W, 18);
  head.writeInt32LE(H, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(24, 28);
  head.writeUInt32LE(data.length, 34);
  return Buffer.concat([head, data]);
}

const COVERS = new Map();
function coverFor(name) {
  if (!COVERS.has(name)) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 97;
    COVERS.set(name, bmp(h / 97));
  }
  return COVERS.get(name);
}

/* ===================================================================== *
 * 3. 假数据
 * ===================================================================== */
const TITLES = [
  '当你把宿舍改造成赛博朋克风格',
  '用 30 天学会做一碗真正的兰州牛肉面',
  '4K 航拍：凌晨四点的城市天际线',
  '我把老家的院子改成了猫乐园（成本公开）',
  '程序员的深夜食堂：15 分钟快手菜',
  '环球旅行第 47 天：在冰岛追极光翻车实录',
  '2024 年最值得买的三件厨房小工具',
  '手搓一台能跑 AI 的复古电脑',
  '被低估的国产纪录片，一口气看完',
  '花一个月修复了台 1985 年的随身听',
  '机器人帮我写了这一周的代码',
  '在山里住了三天，信号为零',
  '揭秘：一份外卖从下单到送达的 30 分钟',
  '给爸妈装的智能家居，他们说太香了',
];
const UPS = ['影视飓风', '绵羊料理', '动画区老观众', '老滕的院子', '图灵的猫', '阿柴的旅行', '何同学', '山里的阿伟'];
const TAGS = ['影视', '美食', '旅行', '数码', '生活', '科技', '纪录片', '手工'];
const REASONS = ['因为你关注了影视飓风', '与你常看的数码视频相似', '热门推荐', '根据你的观看记录', ''];
const DANMAKU_TEXTS = [
  '前方高能',
  '这一段我看了十遍',
  '好家伙',
  '这也太强了吧',
  '泪目',
  '滑到这里就别走了',
  'BGM 是什么',
  '笑死',
  '终于更新了',
  '演示弹幕',
];
const COMMENT_NAMES = ['路过的观众', '一只小可爱', '键盘侠本侠', '深夜刷B站', '考古学家'];
const COMMENT_TEXTS = [
  '这个演示做得比真 App 还顺，滑动很跟手。',
  '双击点赞真的有飘心动画，细节拉满。',
  '评论抽屉能上滑加载更多，好评。',
  '长按弹出菜单，倍速那里我笑了。',
  '强烈建议加个「只看这个 UP」，没想到已经有了。',
];

const BV_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** 生成一个格式合法的假 BV 号：BV1 + 9 位，用确定性伪随机打散，看起来更像真的 */
function mkBvid(i) {
  let s = (i * 2654435761) >>> 0;
  let tail = '';
  for (let k = 0; k < 9; k++) {
    s = (s * 1103515245 + 12345) >>> 0;
    tail += BV_CHARS[(s >>> 8) % BV_CHARS.length];
  }
  return 'BV1' + tail;
}

function mkItem(i, src = 'recommend') {
  const bvid = mkBvid(i);
  return {
    bvid,
    aid: 80000000 + i,
    cid: 4000000000 + i,
    goto: 'av',
    uri: `bilibili://av/${80000000 + i}`,
    title: `【演示 #${i + 1}】${TITLES[i % TITLES.length]}`,
    pic: `http://127.0.0.1:${PORT}/mock/cover/${bvid}.bmp`,
    duration: DURATION,
    pubdate: Math.floor(Date.now() / 1000) - i * 3600,
    tname: TAGS[i % TAGS.length],
    desc: '这是本地演示数据，用来验证滑动、播放、弹幕、评论与互动逻辑。',
    owner: {
      mid: 100000 + (i % UPS.length),
      name: UPS[i % UPS.length],
      face: `http://127.0.0.1:${PORT}/mock/cover/up${i % UPS.length}.bmp`,
    },
    stat: {
      view: 100000 + i * 34567,
      like: 2000 + i * 137,
      coin: 300 + i * 11,
      favorite: 500 + i * 23,
      reply: 120 + i * 7,
      danmaku: 800 + i * 31,
      share: 60 + i * 3,
    },
    rcmd_reason: { content: REASONS[i % REASONS.length] },
    is_followed: i % 5 === 0,
    show_info: { av_feature: {} },
    __source: src,
  };
}

function rcmdResponse(n, fresh) {
  return {
    code: 0,
    message: '0',
    ttl: 1,
    data: { item: Array.from({ length: n }, (_, k) => mkItem(fresh * 100 + k, 'recommend')) },
  };
}

const danmakuXml = (cid) =>
  `<?xml version="1.0" encoding="UTF-8"?><i><chatserver>chat.bilibili.com</chatserver><chatid>${cid}</chatid>` +
  Array.from({ length: 150 }, (_, i) => {
    const text = DANMAKU_TEXTS[i % DANMAKU_TEXTS.length] + (i > 9 ? ' ' + i : '');
    const t = (i * 0.2).toFixed(2);
    return `<d p="${t},1,25,16777215,${1700000000 + i},0,demo,${i}">${text}</d>`;
  }).join('') +
  '</i>';

const commentsJson = (aid) => ({
  code: 0,
  data: {
    page: { count: 87 },
    replies: Array.from({ length: 20 }, (_, i) => ({
      rpid: 1000 + i,
      rpid_str: String(1000 + i),
      oid: aid,
      like: 30 + i * 3,
      ctime: Math.floor(Date.now() / 1000) - i * 600,
      rcount: i % 3,
      member: {
        mid: 500 + i,
        uname: COMMENT_NAMES[i % COMMENT_NAMES.length] + i,
        face: `http://127.0.0.1:${PORT}/mock/cover/c${i}.bmp`,
        level_info: { current_level: 3 + (i % 3) },
        vip: { vipStatus: 0 },
      },
      content: { message: COMMENT_TEXTS[i % COMMENT_TEXTS.length] },
      reply_control: { location: 'IP属地：上海' },
      replies:
        i % 3
          ? [
              {
                rpid: 2000 + i,
                rpid_str: String(2000 + i),
                member: { uname: '楼主', face: '' },
                content: { message: '同感 +1' },
                like: i,
              },
            ]
          : [],
    })),
  },
});

/* ===================================================================== *
 * 4. 路由
 * ===================================================================== */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
};

function sendJson(res, obj, status = 200) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'content-type': MIME['.json'],
    'content-length': body.length,
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

const state = {
  liked: new Set(),
  coined: new Set(),
  faved: new Set(),
  followed: new Set(),
  hidden: new Set(),
};

function handleMock(req, res, url) {
  const p = url.pathname.replace('/mock', '');
  const q = url.searchParams;

  // 封面 / 头像
  if (p === '/cover' || p.startsWith('/cover/')) {
    const name = decodeURIComponent(p.split('/').pop() || 'x');
    const buf = coverFor(name.replace(/\.bmp$/, ''));
    res.writeHead(200, {
      'content-type': MIME['.bmp'],
      'content-length': buf.length,
      'cache-control': 'public, max-age=60',
    });
    return res.end(buf);
  }

  // 假视频直链：支持 Range，行为跟真实 CDN 一致
  if (p === '/media.mp4') {
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : MP4.length - 1;
      const slice = MP4.subarray(start, end + 1);
      res.writeHead(206, {
        'content-type': MIME['.mp4'],
        'content-range': `bytes ${start}-${end}/${MP4.length}`,
        'accept-ranges': 'bytes',
        'content-length': slice.length,
      });
      return res.end(slice);
    }
    res.writeHead(200, { 'content-type': MIME['.mp4'], 'content-length': MP4.length, 'accept-ranges': 'bytes' });
    return res.end(MP4);
  }

  // 弹幕 XML
  if (p === '/x/v1/dm/list.so') {
    const body = Buffer.from(danmakuXml(q.get('oid') || '1'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8', 'content-length': body.length });
    return res.end(body);
  }

  /* ---------------------------- 内容接口 ---------------------------- */
  if (p === '/x/web-interface/nav') {
    return sendJson(res, {
      code: -101,
      message: '账号未登录',
      data: {
        isLogin: false,
        wbi_img: {
          img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
          sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
        },
      },
    });
  }
  if (p === '/x/web-interface/wbi/index/top/feed/rcmd') {
    return sendJson(res, rcmdResponse(Number(q.get('fetch_row') || 12), Number(q.get('fresh_idx') || 1)));
  }
  if (p === '/x/web-interface/popular') {
    const pn = Number(q.get('pn') || 1);
    const ps = Number(q.get('ps') || 20);
    return sendJson(res, {
      code: 0,
      data: { list: Array.from({ length: ps }, (_, k) => mkItem(5000 + pn * 100 + k, 'popular')), no_mid: true },
    });
  }
  if (p === '/x/web-interface/ranking/v2') {
    return sendJson(res, { code: 0, data: { list: Array.from({ length: 30 }, (_, k) => mkItem(9000 + k, 'ranking')) } });
  }
  if (p === '/x/polymer/web-dynamic/v1/feed/all') {
    return sendJson(res, {
      code: 0,
      data: {
        items: Array.from({ length: 12 }, (_, k) => ({
          id_str: 'dyn' + k,
          type: 'DYNAMIC_TYPE_AV',
          modules: { module_dynamic: { major: { archive: mkItem(7000 + k, 'follow') } } },
        })),
      },
    });
  }
  if (p === '/x/space/wbi/arc/search') {
    const ps = Number(q.get('ps') || 20) || 20;
    return sendJson(res, {
      code: 0,
      data: { list: { vlist: Array.from({ length: ps }, (_, k) => mkItem(3000 + k, 'space')) } },
    });
  }
  if (p === '/x/web-interface/archive/related') {
    return sendJson(res, { code: 0, data: Array.from({ length: 10 }, (_, k) => mkItem(11000 + k, 'related')) });
  }
  if (p === '/x/web-interface/view') {
    const bvid = q.get('bvid') || '';
    // 从 BV 号反推一个尽量稳定的 index，保证同一个视频每次拿到同样的标题/头像
    let idx = 0;
    for (const ch of String(bvid)) idx = (idx * 33 + ch.charCodeAt(0)) % 4999;
    const base = mkItem(idx, 'view');
    return sendJson(res, {
      code: 0,
      data: {
        ...base,
        bvid,
        cid: base.cid,
        pages: [{ cid: base.cid, page: 1, part: 'P1 演示', duration: DURATION }],
        tag: TAGS.slice(0, 4).map((t) => ({ tag_name: t })),
        req_user: {
          like: state.liked.has(bvid) ? 1 : 0,
          attention: state.followed.has(String(base.owner.mid)) ? 1 : 0,
        },
      },
    });
  }
  if (p === '/x/tag/archive/tags') {
    return sendJson(res, { code: 0, data: TAGS.map((t) => ({ tag_name: t })) });
  }
  if (p === '/x/v2/reply') {
    return sendJson(res, commentsJson(Number(q.get('oid') || 1)));
  }
  if (p === '/x/player/playurl' || p === '/x/player/wbi/playurl') {
    return sendJson(res, {
      code: 0,
      data: {
        quality: 64,
        accept_quality: [80, 64, 32, 16],
        accept_description: ['高清 1080P', '清晰 480P', '流畅 360P', '极速 240P'],
        timelength: DURATION * 1000,
        durl: [{ url: `http://127.0.0.1:${PORT}/mock/media.mp4`, length: DURATION * 1000, size: MP4.length }],
      },
    });
  }

  /* ---------------------------- 互动接口 ---------------------------- */
  if (p === '/x/web-interface/archive/like') {
    const bvid = q.get('bvid');
    if (q.get('like') === '1') state.liked.add(bvid);
    else state.liked.delete(bvid);
    return sendJson(res, { code: 0, data: {} });
  }
  if (p === '/x/web-interface/coin/add') {
    state.coined.add(q.get('bvid'));
    return sendJson(res, { code: 0, data: { like: false, coin: true } });
  }
  if (p === '/x/v3/fav/folder/created/list-all') {
    return sendJson(res, { code: 0, data: { count: 1, list: [{ id: 1234, title: '默认收藏夹', media_count: 12 }] } });
  }
  if (p === '/x/v3/fav/resource/deal') {
    const id = q.get('rid');
    if (q.get('add_media_ids')) state.faved.add(id);
    else state.faved.delete(id);
    return sendJson(res, { code: 0, data: {} });
  }
  if (p === '/x/relation/modify') {
    if (q.get('act') === '1') state.followed.add(String(q.get('fid')));
    else state.followed.delete(String(q.get('fid')));
    return sendJson(res, { code: 0, data: {} });
  }
  if (p === '/x/feed/dislike') {
    state.hidden.add(q.get('id'));
    return sendJson(res, { code: 0, data: {} });
  }
  if (p === '/x/v2/history/toview/add') return sendJson(res, { code: 0, data: {} });
  if (p === '/x/web-interface/share/add') return sendJson(res, { code: 0, data: {} });

  return sendJson(res, { code: -404, message: '演示服务没有这个接口: ' + p }, 404);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname.startsWith('/mock/')) return handleMock(req, res, url);

  // 静态文件：demo/ 与 extension/src/
  let rel = url.pathname === '/' ? '/demo/index.html' : url.pathname;
  if (rel.startsWith('/src/')) rel = '/extension' + rel;
  const file = path.join(root, decodeURIComponent(rel));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('404 ' + rel);
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  刷B站 · 本地演示已启动');
  console.log(`  → 打开 http://127.0.0.1:${PORT}/   （会自动进入竖滑视频流）`);
  console.log(`  假视频 ${DURATION}s / ${Math.round(DURATION * FPS)} 帧，MP4 ${(MP4.length / 1024).toFixed(1)} KB`);
  console.log('  Ctrl+C 结束\n');
});
