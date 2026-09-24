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
    // 入口位置：native = 嵌进 B 站界面（顶栏药丸 + 视频页互动栏），floating = 右下角悬浮按钮，hidden = 只留快捷键
    entryMode: 'native',
    hideRelated: true, // 打开视频流时隐藏原页面内容
    openOnVideoPage: false, // 进入视频页自动开刷（默认关，免得打扰）
    seedCurrentVideo: true, // 从视频页打开时先播当前这个视频
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
    /** 会话内的互动状态（弹窗与页面共用，避免两边显示不一致） */
    getInteract(bvid) {
      return state.interact[bvid] || {};
    },
    setInteract(bvid, patch) {
      state.interact[bvid] = { ...(state.interact[bvid] || {}), ...patch };
      return state.interact[bvid];
    },
    /**
     * 收藏 / 取消收藏（**页面与弹窗共用这一份**）。
     *
     * 为什么单独抽出来：B 站的收藏是「带方向的」——加走 add_media_ids、取消走 del_media_ids，
     * 方向必须和收藏夹里的真实状态相反，否则请求无效直接报错。而本地缓存很容易和服务端不一致
     * （之前在网页端收藏过、换过设备、上次请求失败等）。所以这里**每次先查真实状态**再决定方向，
     * 万一还是失败，再用相反方向纠正一次。
     */
    async toggleFav(item, opts = {}) {
      if (!item || !item.bvid) return { ok: false, hint: '没有可操作的视频' };
      if (!BBDY.api.isLogin()) {
        BBDY.api.openLogin();
        return { ok: false, hint: '请先登录 B 站账号', needLogin: true };
      }
      const bvid = item.bvid;
      const folders = await BBDY.api.favFolders((await BBDY.api.nav()).mid);
      if (!folders.length) return { ok: false, hint: '没找到你的收藏夹' };
      const folder = folders[0];

      // 1) 查真实状态；查不到就退回本地缓存
      const remote = await BBDY.api.favState({ bvid, folderId: folder.id });
      const before = remote ? remote.has : !!api.getInteract(bvid).fav;

      // 2) 目标状态默认取反，调用方也可以明确指定
      const want = opts.want === undefined ? !before : !!opts.want;
      if (want === before) {
        api.setInteract(bvid, { fav: before, favFolderId: folder.id });
        return { ok: true, on: before, hint: before ? '本来就已收藏' : '本来就没收藏', unchanged: true };
      }

      // 3) 发送；失败且不是未登录时，反方向再试一次（状态判断可能有偏差）
      const send = (target) => BBDY.api.fav({ bvid, on: target, addIds: folder.id, delIds: folder.id });
      let r = await send(want);
      if (!r.ok && r.code !== -101) {
        const retry = await send(!want);
        if (retry.ok) {
          api.setInteract(bvid, { fav: !want, favFolderId: folder.id });
          BBDY.warn('收藏方向与服务端不一致，已按相反方向纠正');
          return {
            ok: true,
            on: !want,
            corrected: true,
            hint: !want ? `已收藏到「${folder.title}」` : '已取消收藏',
          };
        }
        r = retry.code === -101 ? r : retry;
      }

      if (!r.ok) return { ok: false, hint: r.message || `收藏失败（${r.code}）`, code: r.code };
      api.setInteract(bvid, { fav: want, favFolderId: folder.id });
      return { ok: true, on: want, hint: want ? `已收藏到「${folder.title}」` : '已取消收藏' };
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
      // 旧版本只有 showLauncher 布尔值，平滑迁移到 entryMode
      if (settings && settings.showLauncher !== undefined && settings.entryMode === undefined) {
        state.settings.entryMode = settings.showLauncher ? 'native' : 'hidden';
      }
      delete state.settings.showLauncher;
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
