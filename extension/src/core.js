/**
 * core.js —— 全局命名空间与通用工具
 * 内容脚本按 manifest 顺序注入，各模块挂到同一个命名空间上，避免模块系统带来的限制。
 */
(function () {
  'use strict';
  if (globalThis.BBDY) return;

  const BBDY = (globalThis.BBDY = {
    version: '1.0.0',
    /** 运行环境：'extension' | 'demo'。demo 下 apiBase 指向本地 mock 服务。 */
    runtime: 'extension',
    apiBase: '',
    /** 由 content.js 在启动时覆盖，用于 demo 环境替换官方播放器 */
    playerUrl: null,
    log(...args) {
      if (BBDY.debug) console.log('%c[刷B站]', 'color:#fb7299', ...args);
    },
    warn(...args) {
      console.warn('[刷B站]', ...args);
    },
  });

  /* ------------------------------------------------------------------ *
   * DOM helpers
   * ------------------------------------------------------------------ */
  const el = (tag, props, children) => {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'attrs' && typeof v === 'object') {
          for (const [ak, av] of Object.entries(v)) if (av !== null && av !== undefined) node.setAttribute(ak, av);
        } else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c);
    }
    return node;
  };
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ------------------------------------------------------------------ *
   * 格式化
   * ------------------------------------------------------------------ */
  const num = (n) => {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  };
  const numFull = (n) => (Number(n) || 0).toLocaleString('zh-CN');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mmss = (sec) => {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  };
  const since = (ts) => {
    const d = Math.max(0, Date.now() / 1000 - Number(ts || 0));
    if (d < 3600) return Math.max(1, Math.floor(d / 60)) + '分钟前';
    if (d < 86400) return Math.floor(d / 3600) + '小时前';
    if (d < 86400 * 30) return Math.floor(d / 86400) + '天前';
    const date = new Date(Number(ts) * 1000);
    return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const escapeHtml = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  /** 站内图片统一走 https，避免混合内容被拦 */
  const https = (u) => (!u ? '' : String(u).replace(/^http:\/\//i, 'https://'));
  /** 头像/封面小图：hdslb 支持 @ 后缀裁剪，省流量 */
  const thumb = (u, w) => {
    const url = https(u);
    if (!url) return '';
    if (!/hdslb\.com/.test(url) || /@/.test(url)) return url;
    return `${url}@${w || 160}w_${w || 160}h_1c.webp`;
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = (() => {
    let i = 0;
    return (p) => `${p || 'bbdy'}-${++i}-${Math.random().toString(36).slice(2, 7)}`;
  })();
  const isTouch = () => matchMedia('(hover: none), (pointer: coarse)').matches;

  /* ------------------------------------------------------------------ *
   * 存储：扩展内用 chrome.storage.sync，demo 下用 localStorage
   * ------------------------------------------------------------------ */
  const store = {
    _mem: {},
    available() {
      return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
    },
    async get(key, fallback) {
      try {
        if (store.available()) {
          const got = await chrome.storage.sync.get(key);
          return got[key] === undefined ? fallback : got[key];
        }
        const raw = localStorage.getItem('bbdy:' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        BBDY.warn('storage.get failed', e);
        return store._mem[key] === undefined ? fallback : store._mem[key];
      }
    },
    async set(key, value) {
      store._mem[key] = value;
      try {
        if (store.available()) await chrome.storage.sync.set({ [key]: value });
        else localStorage.setItem('bbdy:' + key, JSON.stringify(value));
      } catch (e) {
        BBDY.warn('storage.set failed', e);
      }
    },
    subscribe(cb) {
      if (store.available() && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'sync') return;
          for (const [k, v] of Object.entries(changes)) cb(k, v.newValue);
        });
      } else {
        window.addEventListener('storage', (e) => {
          if (!e.key || !e.key.startsWith('bbdy:')) return;
          try {
            cb(e.key.slice(5), JSON.parse(e.newValue));
          } catch (_) {}
        });
      }
    },
  };

  /* ------------------------------------------------------------------ *
   * 小工具：计时器、单例 toast 容器等
   * ------------------------------------------------------------------ */
  const debounce = (fn, ms) => {
    let t = 0;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };
  const throttle = (fn, ms) => {
    let last = 0;
    let timer = 0;
    return (...a) => {
      const now = Date.now();
      const rest = ms - (now - last);
      if (rest <= 0) {
        last = now;
        fn(...a);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = 0;
          last = Date.now();
          fn(...a);
        }, rest);
      }
    };
  };

  Object.assign(BBDY, {
    el, $, $$, num, numFull, clamp, mmss, since, escapeHtml, https, thumb, wait, uid, isTouch,
    store, debounce, throttle,
  });
})();
