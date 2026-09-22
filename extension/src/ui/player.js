/**
 * ui/player.js —— 播放层（双引擎）
 *
 * 引擎 A：原生 <video>（默认，体验最好）
 *   - 用 playurl(fnval=1) 拿到「带声音的整段 MP4」直链，url 不校验 Referer，可直接播
 *   - 于是单击暂停、长按倍速、拖拽 seek、进度条、静音、循环全都是我们自己的，手感才像短视频
 *   - 弹幕也自己渲染（XML 接口 + CSS 轨道动画）
 *
 * 引擎 B：官方 iframe 播放器（兜底）
 *   - 番剧/付费/接口异常/直链 403 时自动切换，保证「永远有画面能看」
 *   - 受外链播放器限制，只开放 URL 参数（autoplay/muted/danmaku/t/poster），
 *     所以这个引擎下用透明层接管手势，点击交给官方控件
 *
 * 两个引擎对外暴露同一套接口：load / play / pause / toggle / seek / setMuted / setLoop / …
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;

  /* ============================ 直链解析（带缓存） ============================ */
  const mediaCache = new Map(); // bvid -> { at, play }
  const CACHE_TTL = 8 * 60 * 1000; // 直链有时效，8 分钟后重新取

  const media = {
    async resolve(item, { quality = 0, wantAudio = true } = {}) {
      const hit = mediaCache.get(item.bvid);
      if (hit && Date.now() - hit.at < CACHE_TTL) return hit.play;
      const qn = quality || 64;
      const res = await BBDY.api.playurl({ bvid: item.bvid, cid: item.cid || undefined, qn, fnval: 1 });
      if (!res || !res.durl?.length || !res.durl[0].url) throw new Error('没有拿到可直连的播放地址');
      const play = {
        url: res.durl[0].url,
        url2: res.durl[1]?.url || '',
        duration: res.duration || item.duration || 0,
        quality: res.quality || qn,
        accept: res.accept || [],
      };
      mediaCache.set(item.bvid, { at: Date.now(), play });
      return play;
    },
    invalidate(bvid) {
      mediaCache.delete(bvid);
    },
  };

  /* ============================ 弹幕渲染 ============================ */
  class Danmaku {
    constructor(layer, video) {
      this.layer = layer;
      this.video = video;
      this.list = [];
      this.cid = null;
      this.on = true;
      this.cursor = 0;
      this.visible = new Set();
      this._last = 0;
      this.tracks = 6;
      this._trackFree = new Array(this.tracks).fill(0);
      this.timer = setInterval(() => this.tick(), 150);
    }
    async load(cid) {
      this.clear();
      this.cid = cid;
      if (!cid || !this.on) return;
      this.list = await BBDY.api.danmaku({ cid });
      this.list.sort((a, b) => a.time - b.time);
      this.cursor = 0;
    }
    clear() {
      this.list = [];
      this.cursor = 0;
      this.visible.clear();
      this.layer.textContent = '';
    }
    setEnabled(on) {
      this.on = !!on;
      this.layer.style.display = this.on ? '' : 'none';
      if (!this.on) this.clear();
      else if (this.cid && !this.list.length) this.load(this.cid);
    }
    tick() {
      const v = this.video;
      if (!this.on || !v || v.paused || !this.list.length) return;
      const t = v.currentTime;
      if (t < this._last - 1.5) this.cursor = 0; // seek 往回拨
      this._last = t;
      while (this.cursor < this.list.length && this.list[this.cursor].time <= t + 0.35) {
        const dm = this.list[this.cursor++];
        if (dm.time < t - 1) continue;
        this.spawn(dm);
      }
      // 清理已经飘完的节点
      if (this.visible.size > 40) {
        const arr = [...this.visible].slice(0, this.visible.size - 30);
        for (const node of arr) {
          node.remove();
          this.visible.delete(node);
        }
      }
    }
    spawn(dm) {
      if (this.visible.size > 34) return;
      const node = document.createElement('div');
      node.className = 'bbdy-dm';
      node.textContent = dm.text;
      const top = (Math.floor(Math.random() * this.tracks) * 100) / this.tracks;
      node.style.top = `${top + 2}%`;
      const dur = Math.max(6, 9 * (1 + dm.text.length / 40));
      node.style.animationDuration = `${dur}s`;
      this.layer.append(node);
      this.visible.add(node);
      setTimeout(() => {
        node.remove();
        this.visible.delete(node);
      }, dur * 1000 + 200);
    }
    destroy() {
      clearInterval(this.timer);
      this.clear();
    }
  }

  /* ============================ 双引擎播放器 ============================ */
  class Player {
    /**
     * @param {HTMLElement} host .bbdy-player 容器
     * @param {{session?:string, onTime?:Function, onState?:Function}} opts
     */
    constructor(host, opts = {}) {
      this.host = host;
      this.session = opts.session || '0';
      this.onTime = opts.onTime || (() => {});
      this.onState = opts.onState || (() => {});
      this.item = null;
      this.engine = null; // 'video' | 'iframe'
      this.state = 'idle';
      this.muted = true;
      this.loop = true;
      this.rate = 1;
      this.time = 0;
      this.duration = 0;
      this.destroyed = false;
      this._ticker = 0;
      this._wallStart = 0;
      this._wallBase = 0;
      this._onMessage = (e) => this._handleMessage(e);
      window.addEventListener('message', this._onMessage);
      this._onFullscreen = () => this._syncFullscreen();
      document.addEventListener('fullscreenchange', this._onFullscreen);
      this._onFullscreenWebkit = () => this._syncFullscreen();
      document.addEventListener('webkitfullscreenchange', this._onFullscreenWebkit);
    }

    /* ------------------------------ 公开接口 ------------------------------ */
    async load(item, { muted, autoplay = true } = {}) {
      this.item = item;
      this.muted = muted !== undefined ? muted : this.muted;
      this.time = 0;
      this.duration = Number(item.duration) || 0;
      this._setState('loading');
      this.onTime({ time: 0, duration: this.duration });

      // 先把封面糊上去，避免白屏
      try {
        const play = await media.resolve(item, { quality: BBDY.config.settings.quality });
        if (this.destroyed || this.item !== item) return this;
        this._mountVideo(play, { autoplay });
      } catch (e) {
        BBDY.log('原生播放不可用，回退官方 iframe：', e.message);
        if (this.destroyed || this.item !== item) return this;
        this._mountIframe({ autoplay });
      }
      return this;
    }

    play() {
      if (this.engine === 'video' && this.video) {
        const p = this.video.play();
        if (p && p.catch) p.catch((e) => BBDY.log('play() 被拒', e.message));
      } else if (this.engine === 'iframe') {
        this.post('play', null);
      }
      this._setState('playing');
      this._wallStart = performance.now();
      this._wallBase = this.time;
    }
    pause() {
      if (this.engine === 'video' && this.video) this.video.pause();
      else if (this.engine === 'iframe') this.post('pause', null);
      this._setState('paused');
      this._wallBase = this.time;
      this._wallStart = 0;
    }
    toggle() {
      if (this.state === 'playing') {
        this.pause();
        return false;
      }
      this.play();
      return true;
    }
    seek(sec) {
      const t = BBDY.clamp(Number(sec) || 0, 0, this.duration || 1e9);
      if (this.engine === 'video' && this.video) {
        try {
          this.video.currentTime = t;
        } catch (_) {}
      } else {
        this.post('seek', t);
      }
      this.time = t;
      this._wallBase = t;
      this._wallStart = this.state === 'playing' ? performance.now() : 0;
      this.onTime({ time: t, duration: this.duration, seeked: true });
    }
    setMuted(muted) {
      this.muted = !!muted;
      if (this.engine === 'video' && this.video) this.video.muted = this.muted;
      else {
        this.post('volume', this.muted ? 0 : 1);
        this.post(this.muted ? 'mute' : 'unmute', null);
      }
      this.host.classList.toggle('bbdy-unmuted', !this.muted);
    }
    setLoop(loop) {
      this.loop = !!loop;
      if (this.video) this.video.loop = this.loop;
    }
    setRate(rate) {
      this.rate = Number(rate) || 1;
      if (this.video) this.video.playbackRate = this.rate;
      else this.post('playbackRate', this.rate);
    }
    setDanmaku(on) {
      if (this.danmaku) this.danmaku.setEnabled(on);
    }
    setQuality(qn) {
      if (this.engine === 'video' && this.item && qn) {
        media.invalidate(this.item.bvid);
        this.load(this.item, { muted: this.muted, autoplay: this.state === 'playing' });
      } else if (this.engine === 'iframe') {
        this.post('quality', qn);
      }
    }
    post(command, value) {
      if (this.engine !== 'iframe' || !this.frame || !this.frame.contentWindow) return false;
      try {
        this.frame.contentWindow.postMessage({ command, value }, '*');
        return true;
      } catch (_) {
        return false;
      }
    }
    requestFullscreen() {
      const target = this.engine === 'video' ? this.video : this.frame;
      if (!target) return Promise.resolve();
      const fn = target.requestFullscreen || target.webkitRequestFullscreen || target.webkitEnterFullscreen;
      try {
        return Promise.resolve(fn ? fn.call(target) : null);
      } catch (e) {
        return Promise.reject(e);
      }
    }
    get isNative() {
      return this.engine === 'video';
    }

    /* ------------------------------ 原生引擎 ------------------------------ */
    _mountVideo(play, { autoplay }) {
      this._teardownEngine();
      this.engine = 'video';
      const video = document.createElement('video');
      video.className = 'bbdy-video';
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.preload = 'auto';
      video.muted = this.muted;
      video.loop = this.loop;
      video.volume = this.muted ? 0 : 1;
      video.disablePictureInPicture = false;
      video.src = play.url;
      video.poster = this.item.pic || '';
      // 直链失效时自动重新解析一次
      video.addEventListener('error', () => this._onVideoError());
      video.addEventListener('loadedmetadata', () => {
        if (video.duration && isFinite(video.duration)) {
          this.duration = video.duration;
          this.onTime({ time: this.time, duration: this.duration });
        }
      });
      video.addEventListener('playing', () => {
        this._setState('playing');
        this._wallStart = performance.now();
        this._wallBase = video.currentTime;
        this.host.classList.add('bbdy-has-video');
      });
      video.addEventListener('pause', () => {
        if (this.state !== 'ended') this._setState('paused');
      });
      video.addEventListener('waiting', () => this.host.classList.add('bbdy-buffering'));
      video.addEventListener('canplay', () => this.host.classList.remove('bbdy-buffering'));
      video.addEventListener('timeupdate', () => {
        this.time = video.currentTime;
        this._wallBase = this.time;
        this._wallStart = this.state === 'playing' ? performance.now() : 0;
        this.onTime({ time: this.time, duration: this.duration });
      });
      video.addEventListener('ended', () => {
        this._setState('ended');
        this.onTime({ time: this.duration, duration: this.duration });
      });
      // 双击全屏（桌面习惯），单击留给外层手势
      video.addEventListener('dblclick', (e) => {
        e.preventDefault();
        this.requestFullscreen();
      });
      this.video = video;

      const danmakuLayer = document.createElement('div');
      danmakuLayer.className = 'bbdy-danmaku';
      this.danmakuLayer = danmakuLayer;
      this.danmaku = new Danmaku(danmakuLayer, video);

      const tapLayer = document.createElement('div');
      tapLayer.className = 'bbdy-taplock';
      this.tapLayer = tapLayer;

      this.host.append(video, danmakuLayer, tapLayer);
      this._startTicker();
      this._syncFullscreen();
      if (autoplay) this.play();
      if (this.item.cid) this.danmaku.load(this.item.cid);
      this.danmaku.setEnabled(!!BBDY.config.settings.danmaku);
      this.onTime({ time: 0, duration: this.duration });
    }

    _onVideoError() {
      const err = this.video?.error;
      BBDY.warn('原生播放出错，改用官方 iframe', err && err.code, err && err.message);
      media.invalidate(this.item.bvid);
      // 再试一次重新签名，仍失败就换 iframe
      if (!this._retriedNative) {
        this._retriedNative = true;
        this.host.classList.remove('bbdy-has-video');
        this.load(this.item, { muted: this.muted, autoplay: true });
      } else {
        this._mountIframe({ autoplay: true });
      }
    }

    /* ------------------------------ iframe 兜底 ------------------------------ */
    _mountIframe({ autoplay }) {
      this._teardownEngine();
      this.engine = 'iframe';
      const url = BBDY.buildPlayerUrl(this.item, {
        muted: this.muted,
        autoplay: autoplay !== false && BBDY.config.settings.autoplay,
        session: this.session,
      });
      const f = document.createElement('iframe');
      f.className = 'bbdy-frame';
      f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
      f.setAttribute('allowfullscreen', '');
      f.setAttribute('scrolling', 'no');
      f.setAttribute('frameborder', '0');
      f.addEventListener('load', () => {
        this._startHeartbeat();
        if (autoplay) this.play();
      });
      f.src = url;
      this.frame = f;
      this.host.append(f);
      this._startTicker();
      this.onTime({ time: 0, duration: this.duration });
      BBDY.log('已启用官方播放器兜底', this.item.bvid);
    }

    /* ------------------------------ 内部工具 ------------------------------ */
    _teardownEngine() {
      clearInterval(this._ticker);
      clearInterval(this._heartbeat);
      if (this.danmaku) {
        this.danmaku.destroy();
        this.danmaku = null;
      }
      for (const node of [this.video, this.frame, this.danmakuLayer, this.tapLayer]) {
        if (!node) continue;
        if (node === this.video) {
          try {
            node.pause();
            node.removeAttribute('src');
            node.load();
          } catch (_) {}
        }
        if (node === this.frame) {
          try {
            node.src = 'about:blank';
          } catch (_) {}
        }
        node.remove();
      }
      this.video = null;
      this.frame = null;
      this.danmakuLayer = null;
      this.tapLayer = null;
      this.host.classList.remove('bbdy-has-video', 'bbdy-buffering');
    }

    destroy() {
      this.destroyed = true;
      this._teardownEngine();
      window.removeEventListener('message', this._onMessage);
      document.removeEventListener('fullscreenchange', this._onFullscreen);
      document.removeEventListener('webkitfullscreenchange', this._onFullscreenWebkit);
    }

    _setState(state) {
      if (this.state === state) return;
      this.state = state;
      this.onState(state);
    }

    _syncFullscreen() {
      const el = document.fullscreenElement || document.webkitFullscreenElement;
      this.host.classList.toggle('bbdy-fullscreen', !!el && this.host.contains(el));
    }

    _startTicker() {
      const est = () => {
        if (this.engine === 'video' && this.video) return; // 原生引擎有真实 timeupdate
        if (this.state !== 'playing' || !this._wallStart) return;
        const t = this._wallBase + (performance.now() - this._wallStart) / 1000;
        if (this.duration && t >= this.duration) {
          this.time = this.duration;
          this._setState('ended');
          if (this.loop) {
            this.seek(0);
            this.play();
          }
        } else {
          const prev = this.time;
          this.time = t;
          if (Math.abs(t - prev) > 0.1) this.onTime({ time: t, duration: this.duration, estimated: true });
        }
      };
      clearInterval(this._ticker);
      this._ticker = setInterval(est, 250);
    }

    _startHeartbeat() {
      clearInterval(this._heartbeat);
      this._heartbeat = setInterval(() => {
        if (this.destroyed || this.engine !== 'iframe') return;
        this.post('getTime', null);
        this.post('getDuration', null);
      }, 1500);
    }

    _handleMessage(e) {
      if (this.engine !== 'iframe' || !this.frame || e.source !== this.frame.contentWindow) return;
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      const nums = digNumbers(msg);
      if (typeof nums.time === 'number') {
        this.time = nums.time;
        this._wallBase = nums.time;
        this._wallStart = this.state === 'playing' ? performance.now() : 0;
      }
      if (typeof nums.duration === 'number' && nums.duration > 1) this.duration = nums.duration;
      const status = msg.state || msg.event || msg.type || msg.command;
      if (typeof status === 'string') {
        if (/play|playing|resume/i.test(status)) this._setState('playing');
        else if (/pause|paused/i.test(status)) this._setState('paused');
        else if (/end|finish/i.test(status)) this._setState('ended');
      }
      this.onTime({ time: this.time, duration: this.duration });
    }
  }

  /* ============================ 工具 ============================ */
  const NUM_KEYS = ['currentTime', 'currenttime', 'time', 'position', 'seconds'];
  const DUR_KEYS = ['duration', 'totalTime', 'totaltime', 'total'];
  function digNumbers(msg) {
    const out = {};
    const seen = new Set();
    (function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 4 || seen.has(node)) return;
      seen.add(node);
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'number') {
          if (NUM_KEYS.includes(k) && out.time === undefined) out.time = v;
          else if (DUR_KEYS.includes(k) && out.duration === undefined) out.duration = v;
        } else if (v && typeof v === 'object') walk(v, depth + 1);
      }
    })(msg, 0);
    if (out.duration && out.duration > 100000) out.duration /= 1000;
    return out;
  }

  /** 官方 iframe 播放器地址（只认这些 URL 参数） */
  function buildPlayerUrl(item, opts = {}) {
    if (BBDY.playerUrl) return BBDY.playerUrl(item, opts);
    const q = new URLSearchParams();
    q.set('bvid', item.bvid || '');
    q.set('autoplay', opts.autoplay === false ? '0' : '1');
    q.set('muted', opts.muted ? '1' : '0');
    q.set('danmaku', BBDY.config.settings.danmaku ? '1' : '0');
    q.set('high_quality', '1');
    q.set('as_wide', '1');
    q.set('t', String(opts.session || 0));
    if (item.cid) q.set('cid', String(item.cid));
    if (item.aid) q.set('aid', String(item.aid));
    return '//player.bilibili.com/player.html?' + q.toString();
  }

  BBDY.Player = Player;
  BBDY.buildPlayerUrl = buildPlayerUrl;
  BBDY.media = media;
  BBDY.Danmaku = Danmaku;
})();
