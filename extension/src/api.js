/**
 * api.js —— B 站 Web 接口封装
 *
 * 设计要点：
 *  1. 运行在 bilibili.com 页面上下文，fetch 直接带站点 Cookie（credentials: include），
 *     所以「复用已登录账号」是天然的，不需要任何额外授权。
 *  2. 新接口（推荐流 / playurl / 排行榜）需要 WBI 签名，这里按官方算法实现，密钥来自 nav 接口。
 *  3. 任何接口挂了都不致命：feed.js 会回退到热门／相关推荐，播放层用官方 iframe。
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;

  /* ============================ WBI 签名 ============================ */
  const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12,
    38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62,
    11, 36, 20, 34, 44, 52,
  ];

  /** 精简版 MD5（RFC 1321），浏览器里没有 node:crypto，WBI 签名只能自己实现 */
  const md5 = (str) => {
    const add32 = (a, b) => (a + b) & 0xffffffff;
    const cmn = (q, a, b, x, s, t) =>
      add32((add32(add32(a, q), add32(x, t)) << s) | (add32(add32(a, q), add32(x, t)) >>> (32 - s)), b);
    const ff = (a, b, c, d, x, s, t) => cmn((b & c) | (~b & d), a, b, x, s, t);
    const gg = (a, b, c, d, x, s, t) => cmn((b & d) | (c & ~d), a, b, x, s, t);
    const hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t);
    const ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t);
    const utf8 = unescape(encodeURIComponent(str));
    const bytes = [];
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 0; i < 8; i++) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    const X = [];
    for (let i = 0; i < bytes.length; i += 64) {
      for (let j = 0; j < 16; j++) {
        X[j] = bytes[i + j * 4] | (bytes[i + j * 4 + 1] << 8) | (bytes[i + j * 4 + 2] << 16) | (bytes[i + j * 4 + 3] << 24);
      }
      let [A, B, C, D] = [a, b, c, d];
      A = ff(A, B, C, D, X[0], 7, -680876936); D = ff(D, A, B, C, X[1], 12, -389564586);
      C = ff(C, D, A, B, X[2], 17, 606105819); B = ff(B, C, D, A, X[3], 22, -1044525330);
      A = ff(A, B, C, D, X[4], 7, -176418897); D = ff(D, A, B, C, X[5], 12, 1200080426);
      C = ff(C, D, A, B, X[6], 17, -1473231341); B = ff(B, C, D, A, X[7], 22, -45705983);
      A = ff(A, B, C, D, X[8], 7, 1770035416); D = ff(D, A, B, C, X[9], 12, -1958414417);
      C = ff(C, D, A, B, X[10], 17, -42063); B = ff(B, C, D, A, X[11], 22, -1990404162);
      A = ff(A, B, C, D, X[12], 7, 1804603682); D = ff(D, A, B, C, X[13], 12, -40341101);
      C = ff(C, D, A, B, X[14], 17, -1502002290); B = ff(B, C, D, A, X[15], 22, 1236535329);
      A = gg(A, B, C, D, X[1], 5, -165796510); D = gg(D, A, B, C, X[6], 9, -1069501632);
      C = gg(C, D, A, B, X[11], 14, 643717713); B = gg(B, C, D, A, X[0], 20, -373897302);
      A = gg(A, B, C, D, X[5], 5, -701558691); D = gg(D, A, B, C, X[10], 9, 38016083);
      C = gg(C, D, A, B, X[15], 14, -660478335); B = gg(B, C, D, A, X[4], 20, -405537848);
      A = gg(A, B, C, D, X[9], 5, 568446438); D = gg(D, A, B, C, X[14], 9, -1019803690);
      C = gg(C, D, A, B, X[3], 14, -187363961); B = gg(B, C, D, A, X[8], 20, 1163531501);
      A = gg(A, B, C, D, X[13], 5, -1444681467); D = gg(D, A, B, C, X[2], 9, -51403784);
      C = gg(C, D, A, B, X[7], 14, 1735328473); B = gg(B, C, D, A, X[12], 20, -1926607734);
      A = hh(A, B, C, D, X[5], 4, -378558); D = hh(D, A, B, C, X[8], 11, -2022574463);
      C = hh(C, D, A, B, X[11], 16, 1839030562); B = hh(B, C, D, A, X[14], 23, -35309556);
      A = hh(A, B, C, D, X[1], 4, -1530992060); D = hh(D, A, B, C, X[4], 11, 1272893353);
      C = hh(C, D, A, B, X[7], 16, -155497632); B = hh(B, C, D, A, X[10], 23, -1094730640);
      A = hh(A, B, C, D, X[13], 4, 681279174); D = hh(D, A, B, C, X[0], 11, -358537222);
      C = hh(C, D, A, B, X[3], 16, -722521979); B = hh(B, C, D, A, X[6], 23, 76029189);
      A = hh(A, B, C, D, X[9], 4, -640364487); D = hh(D, A, B, C, X[12], 11, -421815835);
      C = hh(C, D, A, B, X[15], 16, 530742520); B = hh(B, C, D, A, X[2], 23, -995338651);
      A = ii(A, B, C, D, X[0], 6, -198630844); D = ii(D, A, B, C, X[7], 10, 1126891415);
      C = ii(C, D, A, B, X[14], 15, -1416354905); B = ii(B, C, D, A, X[5], 21, -57434055);
      A = ii(A, B, C, D, X[12], 6, 1700485571); D = ii(D, A, B, C, X[3], 10, -1894986606);
      C = ii(C, D, A, B, X[10], 15, -1051523); B = ii(B, C, D, A, X[1], 21, -2054922799);
      A = ii(A, B, C, D, X[8], 6, 1873313359); D = ii(D, A, B, C, X[15], 10, -30611744);
      C = ii(C, D, A, B, X[6], 15, -1560198380); B = ii(B, C, D, A, X[13], 21, 1309151649);
      A = ii(A, B, C, D, X[4], 6, -145523070); D = ii(D, A, B, C, X[11], 10, -1120210379);
      C = ii(C, D, A, B, X[2], 15, 718787259); B = ii(B, C, D, A, X[9], 21, -343485551);
      a = add32(a, A); b = add32(b, B); c = add32(c, C); d = add32(d, D);
    }
    const hex = (n) => {
      let s = '';
      for (let i = 0; i < 4; i++) s += ('0' + ((n >> (i * 8)) & 0xff).toString(16)).slice(-2);
      return s;
    };
    return hex(a) + hex(b) + hex(c) + hex(d);
  };

  const wbi = {
    key: null,
    ts: 0,
    async ensure(force) {
      if (!force && this.key && Date.now() - this.ts < 6 * 3600 * 1000) return this.key;
      try {
        const res = await http.json('/x/web-interface/nav', {}, { retry: 2, absolute: true });
        const img = res?.data?.wbi_img?.img_url || '';
        const sub = res?.data?.wbi_img?.sub_url || '';
        const raw = img.split('/').pop().split('.')[0] + sub.split('/').pop().split('.')[0];
        if (raw.length < 64) throw new Error('bad wbi keys');
        this.key = MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join('').slice(0, 32);
        this.ts = Date.now();
        BBDY.log('wbi key ready');
      } catch (e) {
        BBDY.warn('WBI 密钥获取失败，降级为无签名请求', e);
      }
      return this.key;
    },
    async sign(params) {
      const key = await this.ensure();
      const wts = Math.round(Date.now() / 1000);
      const p = { ...params, wts };
      const clean = (s) => String(s).replace(/[!'()*]/g, '');
      const q = Object.keys(p)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(key ? clean(p[k]) : p[k])}`)
        .join('&');
      if (!key) return q;
      return q + '&w_rid=' + md5(q + key);
    },
  };

  /* ============================ HTTP ============================ */
  const csrf = () => {
    const m = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  };

  /** 页面上浏览器会自己带 UA，Node 自测时需要伪装，否则会被风控页拦成 HTML。 */
  const BASE_HEADERS = (() => {
    const h = { Accept: 'application/json, text/plain, */*' };
    if (typeof navigator === 'undefined' || !/Mozilla/.test(navigator.userAgent || '')) {
      h['User-Agent'] =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
      h.Referer = 'https://www.bilibili.com/';
    }
    return h;
  })();

  const http = {
    csrf,
    origin: 'https://api.bilibili.com',
    /** 接口一律打 api.bilibili.com（apiBase 可在自测/demo 时覆盖成 mock 服务） */
    url(path) {
      const base = BBDY.apiBase || http.origin;
      return base.replace(/\/$/, '') + path;
    },
    /** GET JSON，带重试与 WBI 签名过期自动重签 */
    async json(path, params, opts = {}) {
      const url = new URL(http.url(path), location.origin);
      for (const [k, v] of Object.entries(params || {})) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, v);
      }
      if (opts.signed) {
        const qs = await wbi.sign(Object.fromEntries(url.searchParams.entries()));
        for (const kv of qs.split('&')) {
          const i = kv.indexOf('=');
          url.searchParams.set(kv.slice(0, i), kv.slice(i + 1));
        }
      }
      let lastErr;
      const tries = (opts.retry ?? 1) + 1;
      for (let i = 0; i < tries; i++) {
        try {
          const res = await fetch(url.toString(), {
            credentials: 'include',
            signal: AbortSignal.timeout(opts.timeout || 12000),
            headers: { ...BASE_HEADERS },
          });
          const text = await res.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            throw Object.assign(new Error('接口返回非 JSON（可能被风控，code -412）'), {
              code: -999,
              raw: text.slice(0, 160),
            });
          }
          if (data.code === -352 && opts.signed) {
            await wbi.ensure(true); // 签名过期 → 刷密钥重签一次
            return http.json(path, params, { ...opts, retry: 0 });
          }
          return data;
        } catch (e) {
          lastErr = e;
          if (i < tries - 1) await BBDY.wait(400 + i * 600);
        }
      }
      throw lastErr;
    },
    /** POST 表单（自动带 csrf） */
    async post(path, body, opts = {}) {
      const payload = new URLSearchParams({ ...(body || {}), csrf: csrf(), csrf_token: csrf() });
      let lastErr;
      const tries = (opts.retry ?? 1) + 1;
      for (let i = 0; i < tries; i++) {
        try {
          const res = await fetch(http.url(path), {
            method: 'POST',
            credentials: 'include',
            signal: AbortSignal.timeout(opts.timeout || 12000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...BASE_HEADERS },
            body: payload.toString(),
          });
          const text = await res.text();
          try {
            return JSON.parse(text);
          } catch {
            throw Object.assign(new Error('接口返回非 JSON（可能被风控）'), { code: -999 });
          }
        } catch (e) {
          lastErr = e;
          if (i < tries - 1) await BBDY.wait(400 + i * 600);
        }
      }
      throw lastErr;
    },
  };

  /* ============================ 数据规整 ============================ */
  const pickStat = (stat) => ({
    view: Number(stat?.view || 0),
    like: Number(stat?.like || 0),
    coin: Number(stat?.coin || 0),
    fav: Number(stat?.favorite ?? stat?.fav ?? 0),
    reply: Number(stat?.reply ?? stat?.reply_count ?? 0),
    danmaku: Number(stat?.danmaku ?? 0),
    share: Number(stat?.share ?? 0),
  });

  /**
   * 把各种卡片（推荐流/热门/排行/空间投稿/related/动态）统一成同一种结构。
   * 返回 null 表示这条不能当单集视频播（直播、番剧、图文等）。
   */
  function normalize(raw, source) {
    if (!raw || typeof raw !== 'object') return null;
    const goto = raw.goto || raw.type || 'av';
    if (goto && !['av', 'video'].includes(goto)) return null;
    let bvid = raw.bvid || '';
    let aid = Number(raw.aid || (typeof raw.id === 'number' ? raw.id : 0)) || 0;
    if (!bvid && raw.uri && /^bilibili:\/\/av\d+/.test(raw.uri)) aid = Number(raw.uri.replace(/\D/g, '')) || aid;
    if (!bvid && aid) bvid = av2bv(aid);
    if (!bvid) return null;
    const dur = Number(raw.duration || raw.dur || 0);
    if (dur > 0 && dur < 8) return null; // 太短的碎片不推
    const owner = raw.owner || raw.author || {};
    return {
      bvid,
      aid,
      cid: Number(raw.cid || 0) || null,
      title: String(raw.title || raw.name || '未知标题')
        .replace(/\s+/g, ' ')
        .trim(),
      pic: BBDY.https(raw.pic || raw.cover || raw.first_frame || ''),
      duration: dur,
      pubdate: Number(raw.pubdate || raw.ctime || 0),
      tname: raw.tname || raw.type_name || '',
      desc: String(raw.desc || raw.dynamic || '').slice(0, 300),
      owner: {
        mid: Number(owner.mid || raw.mid || 0),
        name: owner.name || raw.author || '',
        face: BBDY.thumb(owner.face || raw.up_face || '', 160),
        vip: !!(owner.vip && owner.vip.status),
      },
      stat: pickStat(raw.stat || raw.cnt_info || {}),
      reason: (raw.rcmd_reason && (raw.rcmd_reason.content || raw.rcmd_reason.reason)) || '',
      followed: !!raw.is_followed,
      source: source || raw.__source || 'recommend',
    };
  }

  /* ---------------------- BV <-> av 互转（官方算法） ---------------------- */
  const XOR_CODE = 23442827791579n;
  const MASK_CODE = 2251799813685247n;
  const MAX_AID = 1n << 51n;
  const BASE = 58n;
  const BV_ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUDdzQ';

  function av2bv(aid) {
    aid = Number(aid);
    if (!aid) return '';
    try {
      const bytes = ['B', 'V', '1', '', '', '', '', '', '', '', '', ''];
      let idx = bytes.length - 1;
      let tmp = (MAX_AID | BigInt(aid)) ^ XOR_CODE;
      while (tmp > 0n) {
        bytes[idx--] = BV_ALPHABET[Number(tmp % BASE)];
        tmp /= BASE;
      }
      [bytes[3], bytes[9]] = [bytes[9], bytes[3]];
      [bytes[4], bytes[7]] = [bytes[7], bytes[4]];
      return bytes.join('');
    } catch (e) {
      BBDY.warn('av2bv failed', aid, e);
      return '';
    }
  }

  function bv2av(bvid) {
    if (!bvid) return 0;
    try {
      const bytes = bvid.split('');
      [bytes[3], bytes[9]] = [bytes[9], bytes[3]];
      [bytes[4], bytes[7]] = [bytes[7], bytes[4]];
      let tmp = 0n;
      for (let i = 3; i < bytes.length; i++) {
        const idx = BV_ALPHABET.indexOf(bytes[i]);
        if (idx < 0) return 0; // 个别新版 BV 号字符不在旧字母表内，交给接口自己解析
        tmp = tmp * BASE + BigInt(idx);
      }
      return Number((tmp & MASK_CODE) ^ XOR_CODE);
    } catch (e) {
      return 0;
    }
  }

  /* ============================ 业务接口 ============================ */
  const api = {
    md5, wbi, http, normalize, av2bv, bv2av,
    _nav: null,

    /** 登录态 */
    async nav(force) {
      if (!force && api._nav && Date.now() - api._nav.at < 60000) return api._nav.data;
      const res = await http.json('/x/web-interface/nav', {}, { retry: 1, absolute: true });
      const data = {
        isLogin: !!res?.data?.isLogin,
        mid: Number(res?.data?.mid || 0),
        uname: res?.data?.uname || '',
        face: BBDY.thumb(res?.data?.face || '', 160),
        money: res?.data?.money ?? 0,
        level: res?.data?.level_info?.current_level ?? 0,
        vip: !!res?.data?.vipStatus,
        code: res?.code,
      };
      api._nav = { at: Date.now(), data };
      return data;
    },
    isLogin() {
      return !!csrf();
    },
    loginUrl() {
      return 'https://passport.bilibili.com/login';
    },
    /** 尽量用站内自带的登录弹窗，找不到就新开登录页 */
    openLogin() {
      const btn = document.querySelector('.header-login-entry, .go-login-btn, [class*="login-entry"]');
      if (btn) {
        btn.click();
        return true;
      }
      window.open(api.loginUrl(), '_blank', 'noopener');
      return false;
    },

    /** 首页推荐流（WBI 签名；未登录也能拿到通用推荐） */
    async recommend({ fresh = 1, pageSize = 12, brush = 0 } = {}) {
      const res = await http.json(
        '/x/web-interface/wbi/index/top/feed/rcmd',
        {
          web_location: 1430650,
          y_num: 5,
          fresh_type: 3,
          feed_version: 'V8',
          fresh_idx: fresh,
          fresh_idx_1h: fresh,
          fetch_row: pageSize,
          brush,
          homepage_ver: 1,
          screen: `${(typeof screen !== 'undefined' && screen.width) || 1920}-${(typeof screen !== 'undefined' && screen.height) || 1080}`,
          platform: 'web',
        },
        { signed: true, retry: 1, absolute: true }
      );
      if (res.code !== 0) throw Object.assign(new Error(res.message || '推荐流获取失败'), { code: res.code });
      return (res.data?.item || []).map((x) => normalize(x, 'recommend')).filter(Boolean);
    },

    /** 热门 */
    async popular({ pn = 1, ps = 20 } = {}) {
      const res = await http.json('/x/web-interface/popular', { pn, ps }, { absolute: true });
      if (res.code !== 0) throw Object.assign(new Error(res.message || '热门获取失败'), { code: res.code });
      return (res.data?.list || []).map((x) => normalize(x, 'popular')).filter(Boolean);
    },

    /** 排行榜 */
    async ranking({ rid = 0, type = 'all' } = {}) {
      const res = await http.json('/x/web-interface/ranking/v2', { rid, type }, { signed: true, absolute: true });
      if (res.code !== 0) throw Object.assign(new Error(res.message || '排行榜获取失败'), { code: res.code });
      return (res.data?.list || []).map((x) => normalize(x, 'ranking')).filter(Boolean);
    },

    /** 关注动态（需要登录） */
    async followFeed({ page = 1, type = 'all' } = {}) {
      const res = await http.json(
        '/x/polymer/web-dynamic/v1/feed/all',
        { type, page, offset: '', update_baseline: 0, web_location: 333.1365 },
        { absolute: true }
      );
      if (res.code !== 0) throw Object.assign(new Error(res.message || '关注动态获取失败'), { code: res.code });
      const out = [];
      for (const dyn of res.data?.items || []) {
        const archive = dyn.modules?.module_dynamic?.major?.archive;
        if (!archive) continue; // 图文/转发动态跳过，只刷视频
        const it = normalize({ ...archive, goto: 'av', stat: archive.stat }, 'follow');
        if (it) {
          it.dynId = dyn.id_str;
          out.push(it);
        }
      }
      return out;
    },

    /** 某 UP 的投稿 */
    async spaceArc({ mid, pn = 1, ps = 20 }) {
      const res = await http.json(
        '/x/space/wbi/arc/search',
        { mid, pn, ps, order: 'pubdate', tid: 0 },
        { signed: true, absolute: true }
      );
      if (res.code !== 0) throw Object.assign(new Error(res.message || 'UP 投稿获取失败'), { code: res.code });
      return (res.data?.list?.vlist || []).map((x) => normalize(x, 'space')).filter(Boolean);
    },

    /** 相关推荐（作为「刷不完」的补给池） */
    async related(bvid) {
      const res = await http.json('/x/web-interface/archive/related', { bvid }, { absolute: true });
      if (res.code !== 0) return [];
      return (res.data || []).map((x) => normalize(x, 'related')).filter(Boolean);
    },

    /** 视频详情：补 cid / 分P / 是否已赞已关注 */
    async view(bvid) {
      const res = await http.json('/x/web-interface/view', { bvid }, { absolute: true });
      if (res.code !== 0) return null;
      const d = res.data || {};
      const item = normalize({ ...d, goto: 'av' }, 'view');
      if (item) {
        item.cid = d.cid;
        item.pages = (d.pages || []).map((p) => ({ cid: p.cid, page: p.page, part: p.part, duration: p.duration }));
        if (d.req_user) item.reqUser = { like: !!d.req_user.like, attention: !!d.req_user.attention };
        item.tags = (d.tag || []).map((t) => t.tag_name).filter(Boolean);
      }
      return item;
    },

    /** 标签：做话题行，比 view 接口稳 */
    async tags(bvid) {
      try {
        const res = await http.json('/x/tag/archive/tags', { bvid }, { absolute: true });
        if (res.code !== 0) return [];
        return (res.data || []).map((t) => t.tag_name).filter(Boolean).slice(0, 6);
      } catch {
        return [];
      }
    },

    /** 评论 */
    async comments({ aid, pn = 1, ps = 20, sort = 2 }) {
      const res = await http.json(
        '/x/v2/reply',
        { type: 1, oid: aid, sort, pn, ps, web_location: 1315875 },
        { absolute: true }
      );
      if (res.code !== 0) return { list: [], total: 0, code: res.code, message: res.message };
      const list = (res.data?.replies || []).map((r) => ({
        rpid: r.rpid_str || String(r.rpid),
        user: {
          mid: r.member?.mid,
          name: r.member?.uname || '',
          face: BBDY.thumb(r.member?.face || '', 72),
          level: r.member?.level_info?.current_level ?? 0,
          vip: !!(r.member?.vip?.vipStatus),
        },
        message: r.content?.message || '',
        like: r.like || 0,
        ctime: r.ctime,
        ip: (r.reply_control?.location || '').replace(/^IP属地：/, ''),
        replies: (r.replies || []).map((s) => ({
          rpid: s.rpid_str || String(s.rpid),
          user: { name: s.member?.uname || '', face: BBDY.thumb(s.member?.face || '', 48) },
          message: s.content?.message || '',
          like: s.like || 0,
        })),
        replyCount: r.rcount || 0,
      }));
      return { list, total: res.data?.page?.count || 0, code: 0 };
    },

    /** 弹幕列表（XML 接口，返回按时间排序的弹幕） */
    async danmaku({ cid }) {
      try {
        const res = await fetch(http.url('/x/v1/dm/list.so?oid=' + encodeURIComponent(cid)), {
          credentials: 'include',
          headers: { ...BASE_HEADERS },
        });
        const text = await res.text();
        const list = [];
        const re = /<d p="([^"]+)"[^>]*>([\s\S]*?)<\/d>/g;
        let m;
        while ((m = re.exec(text)) && list.length < 3000) {
          const p = m[1].split(',');
          list.push({
            time: Number(p[0]),
            mode: Number(p[1]),
            color: Number(p[3]),
            text: m[2]
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"'),
          });
        }
        return list;
      } catch {
        return [];
      }
    },

    /**
     * 发弹幕：POST /x/v2/dm/post
     * 参数来自接口约定：oid=aid、progress=毫秒、mode=1(滚动)、fontsize、color(十进制)。
     * 需要登录（bili_jct cookie 由 http.post 自动带上）。
     */
    async sendDanmaku({ aid, bvid, cid, msg, progressMs = 0, mode = 1, fontSize = 25, color = 16777215 }) {
      const text = String(msg || '').trim();
      if (!text) return { ok: false, code: -1, message: '弹幕内容不能为空' };
      if (text.length > 100) return { ok: false, code: -1, message: '弹幕最多 100 字' };
      try {
        const res = await http.post('/x/v2/dm/post', {
          type: 1,
          oid: aid,
          bvid: bvid || '',
          ...(cid ? { cid } : {}),
          msg: text,
          progress: Math.max(0, Math.round(progressMs)),
          mode,
          fontsize: fontSize,
          color,
          pool: 0,
          plat: 1,
          rnd: Math.floor(Date.now() / 1000),
        });
        const hint =
          res.code === 0
            ? ''
            : res.code === -101
            ? '请先登录 B 站账号'
            : res.code === -400
            ? '弹幕内容被拒绝（可能是敏感词或格式问题）'
            : res.code === -403
            ? '发送被风控拦截，稍后再试'
            : res.code === 36703
            ? '弹幕发送太频繁，歇一下'
            : res.message || String(res.code);
        return { ok: res.code === 0, code: res.code, message: hint, data: res.data };
      } catch (e) {
        return { ok: false, code: -999, message: String(e?.message || e) };
      }
    },

    /** 发弹幕前建议先拿一次配置（限制长度、是否允许发送等） */
    async danmakuConfig({ aid, cid }) {
      try {
        const res = await http.post('/x/v2/dm/web/config', { type: 1, oid: aid, pid: cid || 0 });
        if (res.code !== 0) return null;
        return {
          length: res.data?.dm_length ?? 100,
          closed: !!res.data?.closed,
          subtitle: res.data?.subtitle || '',
        };
      } catch {
        return null;
      }
    },

    /** 播放地址：主要用来取清晰度列表与时长，播放本身交给官方 iframe */
    async playurl({ bvid, cid, qn = 80 }) {
      try {
        const res = await http.json(
          '/x/player/wbi/playurl',
          { bvid, cid, qn, fnval: 4048, fourk: 1, platform: 'html5' },
          { signed: true, absolute: true }
        );
        if (res.code !== 0) return null;
        return {
          accept: (res.data?.accept_quality || []).map((q, i) => ({
            qn: q,
            label: (res.data?.accept_description || [])[i] || String(q),
          })),
          duration: res.data?.dash?.duration || res.data?.timelength / 1000 || 0,
          durl: (res.data?.durl || []).map((d) => ({ url: d.url, length: d.length })),
        };
      } catch {
        return null;
      }
    },

    /* ------------------------------ 互动 ------------------------------ */
    async like({ bvid, on }) {
      const res = await http.post('/x/web-interface/archive/like', { bvid, like: on ? 1 : 2 });
      return { ok: res.code === 0, code: res.code, message: res.message };
    },
    async coin({ bvid, count = 2, alsoLike = false }) {
      const res = await http.post('/x/web-interface/coin/add', {
        bvid,
        multiply: count,
        select_like: alsoLike ? 1 : 0,
      });
      const data = res.data || {};
      const hint =
        res.code === 34005 ? '投币数已达上限' : res.code === -101 ? '请先登录' : res.code === 0 ? '' : res.message;
      return { ok: res.code === 0, code: res.code, message: hint, likeAlso: !!data.like, coin: !!data.coin };
    },
    async favFolders(mid) {
      try {
        const res = await http.json('/x/v3/fav/folder/created/list-all', { up_mid: mid }, { absolute: true });
        if (res.code !== 0) return [];
        return (res.data?.list || []).map((f, i) => ({
          id: f.id,
          title: f.title,
          mediaCount: f.media_count,
          isDefault: i === 0,
        }));
      } catch {
        return [];
      }
    },

    /**
     * 这个视频当前在哪些收藏夹里（用于决定 deal 的方向）。
     * 注意：/x/v3/fav/resource/ids 实测无论传 aid 还是 bvid 都返回 -400，不能用；
     * 这里改用收藏夹内容列表来判断（第一页够用，够不到的返回 null 表示"不知道"）。
     * @returns {Promise<{folderId:number, title:string, has:boolean}|null>}
     */
    async favState({ bvid, folderId }) {
      if (!bvid) return null;
      try {
        let fid = folderId;
        let title = '';
        if (!fid) {
          const nav = await api.nav();
          const folders = await api.favFolders(nav.mid);
          if (!folders.length) return null;
          fid = folders[0].id;
          title = folders[0].title;
        }
        const res = await http.json(
          '/x/v3/fav/resource/list',
          { media_id: fid, pn: 1, ps: 40, platform: 'web', order: 'mtime' },
          { absolute: true }
        );
        if (res.code !== 0) return { folderId: fid, title, has: false, unknown: true };
        const medias = res.data?.medias || [];
        // 列表里带 bvid 字段；个别情况下只有 id(aid)，两种都比一遍
        const aid = api.bv2av(bvid);
        const has = medias.some((m) => m.bvid === bvid || Number(m.id) === aid);
        return { folderId: fid, title: res.data?.info?.title || title, has };
      } catch {
        return null;
      }
    },

    /**
     * 收藏 / 取消收藏。
     * B 站要求：加收藏走 add_media_ids，取消走 del_media_ids，且**方向必须和实际状态相反**，
     * 否则请求无效会报错。这里默认按「取反」发送（on 表示目标状态）。
     */
    async fav({ bvid, on, addIds, delIds }) {
      const res = await http.post('/x/v3/fav/resource/deal', {
        rid: api.bv2av(bvid),
        type: 2,
        add_media_ids: on ? addIds : '',
        del_media_ids: on ? '' : delIds || addIds,
      });
      const hint =
        res.code === 0
          ? ''
          : res.code === -101
          ? '请先登录 B 站账号'
          : res.code === -111
          ? '收藏夹不存在或已失效'
          : res.code === 11010
          ? '该视频已不存在'
          : res.code === 11011
          ? '收藏失败：稿件已被删除'
          : res.code === 11012
          ? '收藏夹里已经有这个视频了'
          : res.code === 11013
          ? '收藏夹里的这个视频已经不存在'
          : res.code === 11014
          ? '收藏夹已满'
          : res.code === -400
          ? '收藏状态对不上（试试先刷新再点）'
          : res.message || String(res.code);
      return { ok: res.code === 0, code: res.code, message: hint };
    },
    async follow({ mid, on }) {
      const res = await http.post('/x/relation/modify', { fid: mid, act: on ? 1 : 2, re_src: 11 });
      return { ok: res.code === 0, code: res.code, message: res.message };
    },
    async dislike({ bvid, aid, reason = 0 }) {
      try {
        const res = await http.post('/x/feed/dislike', { goto: 'av', id: aid || api.bv2av(bvid), reason });
        return { ok: res.code === 0, code: res.code, message: res.message };
      } catch (e) {
        return { ok: false, code: -1, message: String(e.message || e) };
      }
    },
    async share(bvid) {
      try {
        await http.post('/x/web-interface/share/add', { bvid });
      } catch (_) {}
    },
  };

  BBDY.api = api;
})();
