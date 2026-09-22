/**
 * config.js —— 用户设置（持久化）+ 本地状态（拉黑、互动缓存）
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;

  const DEFAULTS = {
    source: 'recommend', // recommend | popular | ranking | follow
    autoplay: true, // 自动连播下一条
    loop: true, // 单条循环播放
    muteOnStart: true, // 静音启动（浏览器自动播放策略更友好）
    danmaku: true,
    quality: 0, // 0 = 自动
    screen: 'portrait', // portrait | fit —— 竖屏裁切 or 完整显示
    pageSize: 12, // 每次拉取条数
    preload: 1, // 预加载后面几条
    showLauncher: true, // 在 B 站页面右下角显示悬浮入口
    hideRelated: true, // 打开视频流时隐藏原页面内容
    seenTtlDays: 1.5, // 去重记忆保留天数
  };

  const state = {
    settings: { ...DEFAULTS },
    /** 播放过的 bvid -> 时间戳，避免一直重复推同一条 */
    seen: {},
    /** 本地点踩的 bvid */
    blocked: {},
    /** 本次会话的互动状态：bvid -> {like, coin, fav, followed} */
    interact: {},
  };

  const api = {
    DEFAULTS,
    state,
    get settings() {
      return state.settings;
    },
    blockedList() {
      return Object.keys(state.blocked);
    },
    isBlocked(bvid) {
      return !!state.blocked[bvid];
    },
    block(bvid, title) {
      if (!bvid) return;
      state.blocked[bvid] = { title: title || '', at: Date.now() };
      api.persistBlocked();
    },
    unblock(bvid) {
      delete state.blocked[bvid];
      api.persistBlocked();
    },
    clearBlocked() {
      state.blocked = {};
      api.persistBlocked();
    },
    persistBlocked() {
      BBDY.store.set('blocked', state.blocked);
    },
    markSeen(bvid) {
      if (!bvid) return;
      state.seen[bvid] = Date.now();
      api.scheduleSeenPersist();
    },
    seenRecently(bvid) {
      const t = state.seen[bvid];
      if (!t) return false;
      const ttl = (state.settings.seenTtlDays || 1.5) * 86400 * 1000;
      return Date.now() - t < ttl;
    },
    scheduleSeenPersist: null, // 下面赋值
    async save(patch) {
      state.settings = { ...state.settings, ...patch };
      await BBDY.store.set('settings', state.settings);
      api.emit('settings', state.settings);
    },
    async reset() {
      state.settings = { ...DEFAULTS };
      await BBDY.store.set('settings', state.settings);
      api.emit('settings', state.settings);
    },
    async load() {
      const [settings, blocked, seen] = await Promise.all([
        BBDY.store.get('settings', null),
        BBDY.store.get('blocked', null),
        BBDY.store.get('seen', null),
      ]);
      state.settings = { ...DEFAULTS, ...(settings || {}) };
      state.blocked = blocked || {};
      // 清理过期去重记录
      const ttl = (state.settings.seenTtlDays || 1.5) * 86400 * 1000;
      const now = Date.now();
      const kept = {};
      for (const [k, v] of Object.entries(seen || {})) if (now - v < ttl) kept[k] = v;
      state.seen = kept;
      BBDY.store.subscribe((key, value) => {
        if (key === 'settings' && value) {
          state.settings = { ...DEFAULTS, ...value };
          api.emit('settings', state.settings);
        }
      });
      return state;
    },
    /* 极简事件总线 */
    _handlers: {},
    on(evt, fn) {
      (api._handlers[evt] = api._handlers[evt] || []).push(fn);
      return () => api.off(evt, fn);
    },
    off(evt, fn) {
      api._handlers[evt] = (api._handlers[evt] || []).filter((f) => f !== fn);
    },
    emit(evt, payload) {
      for (const fn of api._handlers[evt] || []) {
        try {
          fn(payload);
        } catch (e) {
          BBDY.warn('config handler error', e);
        }
      }
    },
  };

  api.scheduleSeenPersist = BBDY.debounce(() => BBDY.store.set('seen', state.seen), 4000);

  BBDY.config = api;
})();
