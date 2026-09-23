/**
 * ui/overlay.js —— 全屏竖滑视频流
 *
 * 结构：
 *   .bbdy-root
 *     .bbdy-viewport            ← 手势识别区（上下拖拽）
 *       .bbdy-track
 *         .bbdy-page × 3        ← 只维护 3 个槽位：上一条 / 当前 / 下一条（循环复用）
 *     .bbdy-topbar              ← 来源切换 / 静音 / 设置 / 退出
 *     .bbdy-actions             ← 右侧互动栏
 *     .bbdy-info                ← UP 主、标题、话题
 *     .bbdy-progress            ← 自绘进度条（可拖拽 seek）
 *     .bbdy-center              ← 加载中 / 大播放键 / 飘心动画
 *
 * 交互：上下滑 / 滚轮 / ↑↓ / 空格 / 单击暂停 / 双击点赞 / 长按菜单 / 键盘全套
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;
  const { el, clamp } = BBDY;

  const PULL_THRESHOLD = 0.18; // 拖过 18% 屏高就翻页
  const FLICK_VELOCITY = 0.45; // 像素/毫秒，甩一下也能翻
  const LONG_PRESS_MS = 480;
  const DOUBLE_TAP_MS = 260;
  const WHEEL_COOLDOWN = 460;

  const SOURCE_LABEL = { recommend: '推荐', popular: '热门', ranking: '排行', follow: '关注' };

  class Overlay {
    constructor() {
      this.visible = false;
      this.queue = null;
      this.item = null;
      this.pending = false; // 正在翻页动画
      this.muted = true;
      this.playing = false;
      this.speed = 1;
      this.upOnly = null; // 只看某 UP
      this.interact = new Map(); // bvid -> {like, coin, fav, followed, coinCount}
      this._wheelAt = 0;
      this._tap = { time: 0, x: 0, y: 0, timer: 0 };
      this._build();
    }

    /* ==================================================================== *
     * 构建 DOM
     * ==================================================================== */
    _build() {
      this.root = el('div', { class: 'bbdy-root', dataset: { screen: BBDY.config.settings.screen } });
      this.viewport = el('div', { class: 'bbdy-viewport' });
      this.track = el('div', { class: 'bbdy-track' });
      this.viewport.append(this.track);
      this.root.append(this.viewport);

      // —— 三个槽位
      this.slots = [-1, 0, 1].map((offset) => this._buildPage(offset));

      // —— 顶栏
      this.tabs = el('div', { class: 'bbdy-tabs' });
      this.tabBtns = {};
      for (const [key, label] of Object.entries(SOURCE_LABEL)) {
        const b = el('button', {
          class: 'bbdy-tab' + (key === BBDY.config.settings.source ? ' bbdy-on' : ''),
          attrs: { type: 'button' },
          text: label,
          onclick: (e) => {
            e.stopPropagation();
            this.switchSource(key);
          },
        });
        this.tabBtns[key] = b;
        this.tabs.append(b);
      }
      this.muteBtn = el('button', {
        class: 'bbdy-iconbtn',
        attrs: { type: 'button', title: '静音切换 (M)' },
        html: BBDY.icon('volumeOff'),
        onclick: (e) => {
          e.stopPropagation();
          this.toggleMute();
        },
      });
      this.danmakuBtn = el('button', {
        class: 'bbdy-iconbtn',
        attrs: { type: 'button', title: '弹幕开关' },
        html: BBDY.icon('danmaku'),
        onclick: (e) => {
          e.stopPropagation();
          this.toggleDanmaku();
        },
      });
      this.setBtn = el('button', {
        class: 'bbdy-iconbtn',
        attrs: { type: 'button', title: '设置 (S)' },
        html: BBDY.icon('settings'),
        onclick: (e) => {
          e.stopPropagation();
          this.openSettings();
        },
      });
      this.closeBtn = el('button', {
        class: 'bbdy-iconbtn',
        attrs: { type: 'button', title: '退出视频流 (Esc)' },
        html: BBDY.icon('close'),
        onclick: (e) => {
          e.stopPropagation();
          this.hide();
        },
      });
      this.meBox = el('div', { class: 'bbdy-me', hidden: true });
      this.topbar = el('div', { class: 'bbdy-topbar' }, [
        this.tabs,
        el('div', { class: 'bbdy-topbar-spacer' }),
        this.meBox,
        this.danmakuBtn,
        this.muteBtn,
        this.setBtn,
        this.closeBtn,
      ]);
      this.root.append(this.topbar);

      // —— 右侧互动栏
      this.actionbar = new BBDY.ActionBar(this.root, {
        onAction: (key, item) => this.onAction(key, item),
      });

      // —— 底部信息
      this.upName = el('span', { class: 'bbdy-upname' });
      this.followBtn = el('button', {
        class: 'bbdy-follow',
        attrs: { type: 'button' },
        text: '+ 关注',
        onclick: (e) => {
          e.stopPropagation();
          this.onAction('follow', this.item);
        },
      });
      this.upRow = el('div', { class: 'bbdy-up' }, [el('span', { text: '@' }), this.upName, this.followBtn]);
      this.titleEl = el('div', {
        class: 'bbdy-title',
        onclick: (e) => {
          e.stopPropagation();
          this.titleEl.classList.toggle('bbdy-open');
        },
      });
      this.tagsEl = el('div', { class: 'bbdy-tags' });
      this.reasonEl = el('span', { class: 'bbdy-reason' });
      this.metaEl = el('div', { class: 'bbdy-meta' }, [
        this.reasonEl,
        el('span', { class: 'bbdy-meta-stat' }),
      ]);
      this.infoEl = el('div', { class: 'bbdy-info' }, [this.upRow, this.titleEl, this.tagsEl, this.metaEl]);
      this.root.append(this.infoEl);

      // —— 进度条
      this.progressFill = el('div', { class: 'bbdy-progress-fill' });
      this.progressTime = el('div', { class: 'bbdy-progress-time', text: '0:00' });
      this.progressBar = el('div', { class: 'bbdy-progress-bar' }, [this.progressFill]);
      this.progress = el('div', { class: 'bbdy-progress' }, [this.progressBar, this.progressTime]);
      this._bindProgress();
      this.root.append(this.progress);

      // —— 中央图层
      this.spinner = el('div', { class: 'bbdy-spinner' });
      this.loadWrap = el('div', { class: 'bbdy-loadwrap' }, [this.spinner, el('div', { class: 'bbdy-tip', text: '加载中…' })]);
      this.bigBtn = el('div', { class: 'bbdy-big', html: BBDY.icon('play') });
      this.center = el('div', { class: 'bbdy-center' }, [this.loadWrap, this.bigBtn]);
      this.root.append(this.center);
      this.bigBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.bigBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._singleTap();
      });

      // —— 提示条 / 评论抽屉 / 设置
      this.hint = null;
      this.comments = new BBDY.CommentDrawer(this.root, { onNotice: (t) => this.toast(t, { bottom: true }) });
      this.settings = new BBDY.SettingsPanel(this.root, {
        onChange: (patch) => this.onSettingsChange(patch),
        onAction: (key, item) => this.onAction(key, item),
        feed: () => this.queue,
      });

      this._bindGestures();
      this._bindKeys();
    }

    _buildPage(offset) {
      const poster = el('div', { class: 'bbdy-poster' });
      const posterImg = el('img', { attrs: { alt: '', loading: 'lazy' } });
      poster.append(posterImg);
      const playerBox = el('div', { class: 'bbdy-player' });
      const page = el('div', { class: 'bbdy-page' + (offset === 0 ? ' bbdy-active' : ' bbdy-adjacent') }, [
        poster,
        playerBox,
        el('div', { class: 'bbdy-shade-top' }),
        el('div', { class: 'bbdy-shade-bottom' }),
      ]);
      page.style.transform = `translateY(${offset * 100}%)`;
      this.track.append(page);

      const player = new BBDY.Player(playerBox, {
        session: `${offset}`,
        onTime: (info) => {
          if (offset === 0 && info && !this.isDragging) this._updateProgress(info);
        },
        onState: (state) => {
          if (offset !== 0) return;
          this.playing = state === 'playing';
          this.actionbar.setPlaying(this.playing);
          this.bigBtn.innerHTML = BBDY.icon(state === 'playing' ? 'pause' : 'play');
          if (state === 'playing' || state === 'paused') this._hideLoad();
          if (state === 'playing') {
            // 已经响应用户手势了，这时候再取消静音是允许的
            if (this.pendingUnmute) {
              this.pendingUnmute = false;
              this.setMuted(false, { silent: true });
            }
          }
          if (state === 'paused' && this.item && !this.isDragging) this._showBig('play', 900);
        },
      });

      return { offset, page, poster, posterImg, playerBox, player, item: null, ready: false };
    }

    /* ==================================================================== *
     * 生命周期
     * ==================================================================== */
    async show(opts = {}) {
      if (this.visible) return;
      this.visible = true;
      document.documentElement.classList.add('bbdy-active');
      if (BBDY.config.settings.hideRelated) document.documentElement.classList.add('bbdy-hide-host');
      (document.body || document.documentElement).append(this.root);

      this.queue = this.queue || new BBDY.FeedQueue({
        source: BBDY.config.settings.source,
        onnotice: (msg, kind) => this.toast(msg, { bottom: true, ms: kind === 'warn' ? 3200 : 1600 }),
      });
      this._syncSourceTabs();
      this._paintSettings();

      await this._bootstrapAuth();

      // 从视频页打开时，把当前这个视频插到队首，先播它
      const seeded = await this._seedFrom(opts.seed);

      if (!this.item) {
        this._showLoad('正在挑视频…');
        try {
          this.item = await this.queue.next();
          this._renderAll();
        } catch (e) {
          this._showError(e);
          return;
        }
      } else if (seeded) {
        this._renderAll();
      } else {
        this.slots.find((s) => s.offset === 0).player.play();
      }
    }

    /** 把指定 BV 号（通常是当前正在看的视频）放到队列最前面 */
    async _seedFrom(bvid) {
      if (!bvid || !BBDY.config.settings.seedCurrentVideo) return false;
      if (this.item && this.item.bvid === bvid) return false;
      this._showLoad('正在打开当前视频…');
      try {
        const item = await BBDY.api.view(bvid);
        if (!item) return false;
        item.source = 'seed';
        // 已经刷过/拉黑过就跳过
        this.queue.queue = this.queue.queue.slice(this.queue.cursor).filter((x) => x.bvid !== bvid);
        this.queue.cursor = 0;
        this.queue.queue.unshift(item);
        this.queue.detailCache.set(bvid, item);
        this.item = item;
        BBDY.config.markSeen(bvid);
        this.queue.schedulePrefetch();
        BBDY.log('已把当前视频插到队首', bvid);
        return true;
      } catch (e) {
        BBDY.warn('读取当前视频失败，退回普通推荐', e);
        return false;
      }
    }

    hide() {
      if (!this.visible) return;
      this.visible = false;
      this.comments.close();
      this.settings.close();
      for (const slot of this.slots) {
        try {
          slot.player.pause();
        } catch (_) {}
      }
      this.root.remove();
      document.documentElement.classList.remove('bbdy-active', 'bbdy-hide-host');
    }

    toggle() {
      return this.visible ? this.hide() : this.show();
    }

    /* ==================================================================== *
     * 渲染
     * ==================================================================== */
    _slot(offset) {
      return this.slots.find((s) => s.offset === offset);
    }

    _paintSlot(slot, item) {
      slot.item = item;
      if (!item) {
        slot.page.style.visibility = 'hidden';
        slot.player.pause();
        return;
      }
      slot.page.style.visibility = 'visible';
      slot.posterImg.src = item.pic || '';
      slot.poster.style.opacity = '1';
    }

    /** 把队列里的 item 铺到三个槽位 */
    async _renderAll() {
      const cur = this.item;
      if (!cur) return;
      const prev = this.queue.queue[this.queue.cursor - 1] || null;
      const next = this.queue.queue[this.queue.cursor + 1] || null;
      // 队列首尾时要把空槽清掉，否则会残留上一条的画面
      this._paintSlot(this._slot(-1), prev);
      this._paintSlot(this._slot(0), cur);
      this._paintSlot(this._slot(1), next);

      this._renderInfo(cur);
      this.actionbar.setItem(cur, this._interactState(cur));
      this._updateProgress({ time: 0, duration: cur.duration || 0 });

      // 当前页优先播放，相邻页后台预热（不阻塞 UI）
      this._loadInto(this._slot(0), cur, { play: true });
      if (next) this._loadInto(this._slot(1), next, { play: false });
      if (prev) this._loadInto(this._slot(-1), prev, { play: false });

      this.queue.schedulePrefetch();
    }

    /** 预热：把下一条的详情（cid）和相邻页面准备好 */
    async _warmNeighbors() {
      const next = await this.queue.ensure(1).catch(() => null);
      if (next && this._slot(1).item !== next) {
        this._paintSlot(this._slot(1), next);
        this._loadInto(this._slot(1), next, { play: false });
      }
      const prev = this.queue.queue[this.queue.cursor - 1] || null;
      if (prev && this._slot(-1).item !== prev) {
        this._paintSlot(this._slot(-1), prev);
        this._loadInto(this._slot(-1), prev, { play: false });
      }
    }

    async _loadInto(slot, item, { play }) {
      await this.queue.detail(item);
      // 预加载阶段静音，避免三条视频声音叠在一起
      const shouldMute = play ? this.muted : true;
      slot.player.setLoop(BBDY.config.settings.loop);
      slot.player.load(item, { muted: shouldMute, autoplay: play ? BBDY.config.settings.autoplay : false });
      if (!play) {
        // 非当前页：加载完立刻暂停，只当作预缓冲
        setTimeout(() => {
          if (slot.item?.bvid !== this.item?.bvid) slot.player.post('pause', null);
        }, 2500);
      }
    }

    _renderInfo(item) {
      this.upName.textContent = item.owner.name || '未知 UP';
      this.titleEl.textContent = item.title;
      this.titleEl.classList.remove('bbdy-open');
      this.tagsEl.innerHTML = '';
      const tags = [];
      if (item.tname) tags.push('#' + item.tname);
      for (const t of item.tags || []) tags.push('#' + t);
      for (const t of tags.slice(0, 8)) {
        this.tagsEl.append(
          el('span', {
            class: 'bbdy-tag',
            text: t,
            onclick: (e) => {
              e.stopPropagation();
              this.switchSource('ranking');
            },
          })
        );
      }
      this.reasonEl.textContent = item.reason || '';
      const st = item.stat || {};
      this.metaEl.querySelector('.bbdy-meta-stat').innerHTML =
        `${BBDY.icon('eye')} ${BBDY.num(st.view)}　${BBDY.icon('comment')} ${BBDY.num(st.danmaku)}　${BBDY.since(item.pubdate)}`;
      const followed = this._interactState(item).followed;
      this.followBtn.classList.toggle('bbdy-on', followed);
      this.followBtn.textContent = followed ? '已关注' : '+ 关注';
      this.danmakuBtn.classList.toggle('bbdy-on', !!BBDY.config.settings.danmaku);
      this.muteBtn.innerHTML = BBDY.icon(this.muted ? 'volumeOff' : 'volume');
    }

    _interactState(item) {
      const saved = this.interact.get(item.bvid) || {};
      return {
        like: !!saved.like || !!(item.reqUser && item.reqUser.like),
        coin: !!saved.coin,
        fav: !!saved.fav,
        followed: saved.followed === undefined ? !!item.followed : !!saved.followed,
        coinCount: saved.coinCount || 0,
      };
    }

    /* ==================================================================== *
     * 翻页
     * ==================================================================== */
    async goNext() {
      if (this.pending || !this.visible) return;
      const dir = 1;
      this.pending = true;
      await this._animate(dir);
      try {
        // 与 FeedQueue.next() 同样的语义，但这里自己控制相邻槽位的刷新
        const cur = this.queue.current();
        if (cur) {
          this.queue.history.push(cur);
          this.queue.cursor++;
        }
        const item = await this.queue.ensure(0);
        if (!item) throw new Error('没有更多视频了');
        this.queue.lastBvid = item.bvid;
        BBDY.config.markSeen(item.bvid);
        this.item = item;
        this._renderAll();
        this.queue.schedulePrefetch();
        this._hideHint();
      } catch (e) {
        this.toast('没有更多了：' + (e.message || e), { bottom: true, ms: 2400 });
        await this._animate(-dir);
      } finally {
        this.pending = false;
      }
    }

    async goPrev() {
      if (this.pending || !this.visible) return;
      if (this.queue.cursor <= 0 && !this.queue.history.length) {
        this.toast('已经是第一条了', { bottom: true });
        return;
      }
      this.pending = true;
      await this._animate(-1);
      try {
        this.queue.cursor = Math.max(0, this.queue.cursor - 1);
        const item = await this.queue.ensure(0);
        if (!item) throw new Error('没有上一条了');
        this.item = item;
        this._renderAll();
      } catch (e) {
        await this._animate(1);
      } finally {
        this.pending = false;
      }
    }

    /** 视觉翻页：先动画位移，再瞬间重置并换内容（三槽循环复用） */
    _animate(dir) {
      return new Promise((resolve) => {
        this.track.classList.add('bbdy-anim');
        const page = this._slot(0).page;
        page.classList.add('bbdy-drag');
        this.track.style.transform = `translateY(${-dir * 100}%)`;
        const done = () => {
          this.track.classList.remove('bbdy-anim');
          page.classList.remove('bbdy-drag');
          this.track.style.transform = 'translateY(0)';
          this._applyDepth(0);
          resolve();
        };
        setTimeout(done, 290);
      });
    }

    /** 拖拽过程中的位移动画 */
    _applyDrag(dy) {
      this.track.classList.remove('bbdy-anim');
      this.track.style.transform = `translateY(${dy}px)`;
      this._applyDepth(dy);
    }

    /** 当前页随位移缩放、相邻页缩放渐入，做出抖音那种层次感 */
    _applyDepth(dy) {
      const h = this.viewport.clientHeight || 1;
      const p = clamp(Math.abs(dy) / h, 0, 1);
      const active = this._slot(0);
      if (active) {
        const scale = 1 - p * 0.06;
        active.page.style.transform = `translateY(0) scale(${scale})`;
        active.page.style.borderRadius = p > 0.02 ? '14px' : '';
        active.page.classList.toggle('bbdy-active', p < 0.12);
        active.page.classList.toggle('bbdy-adjacent', p >= 0.12);
      }
      for (const slot of this.slots) {
        if (slot.offset === 0) continue;
        const base = slot.offset * 100;
        const alpha = slot.offset === Math.sign(dy) ? p : 0;
        slot.page.style.transform = `translateY(${base - (dy / h) * 100}%) scale(${0.94 + alpha * 0.06})`;
      }
    }

    /* ==================================================================== *
     * 手势 / 键盘
     * ==================================================================== */
    _bindGestures() {
      const vp = this.viewport;
      let dragging = false;
      let startY = 0;
      let startX = 0;
      let lastY = 0;
      let lastT = 0;
      let velocity = 0;
      let longTimer = 0;
      let moved = false;
      let pressDrag = null; // 长按拖动加速状态

      const onDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        dragging = true;
        moved = false;
        this.isDragging = true;
        startY = lastY = e.clientY;
        startX = e.clientX;
        lastT = performance.now();
        velocity = 0;
        vp.setPointerCapture && vp.setPointerCapture(e.pointerId);
        clearTimeout(longTimer);
        longTimer = setTimeout(() => {
          if (!moved && dragging) {
            this._cancelTap();
            dragging = false;
            this.isDragging = false;
            this._resetTrack();
            BBDY.moreMenu(this.root, this.item, { onPick: (key, item) => this.onAction(key, item) });
          }
        }, LONG_PRESS_MS);
      };

      const onMove = (e) => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        const dx = e.clientX - startX;
        if (!moved && Math.hypot(dx, dy) > 8) {
          moved = true;
          clearTimeout(longTimer);
          this.root.classList.add('bbdy-dragging');
          // 长按拖动 = 倍速（抖音同款手感）
          pressDrag = { startY: e.clientY, savedRate: this.speed, applied: false };
        }
        if (!moved) return;
        const t = performance.now();
        velocity = (e.clientY - lastY) / Math.max(1, t - lastT);
        lastY = e.clientY;
        lastT = t;
        // 按住不放往上拖：先加速；再拖过阈值就变成切上下条
        if (pressDrag && !pressDrag.applied) {
          const up = pressDrag.startY - e.clientY;
          if (up > 90 && this._slot(0).player.isNative) {
            pressDrag.applied = true;
            this._applyPressRate();
          }
        }
        // 越界阻尼
        const h = vp.clientHeight || 1;
        let shown = dy;
        const beyond = (dy < 0 && !this._slot(1).item) || (dy > 0 && !this._slot(-1).item);
        if (beyond) shown = dy * 0.32;
        this._applyDrag(clamp(shown, -h * 1.1, h * 1.1));
      };

      const onUp = (e) => {
        clearTimeout(longTimer);
        this.isDragging = false;
        this.root.classList.remove('bbdy-dragging');
        if (pressDrag) {
          if (pressDrag.applied && this._slot(0).player.isNative) this._slot(0).player.setRate(pressDrag.savedRate);
          pressDrag = null;
        }
        if (!dragging) return;
        dragging = false;
        const dy = e.clientY - startY;
        const h = vp.clientHeight || 1;
        const p = dy / h;
        const flick = Math.abs(velocity) > FLICK_VELOCITY;

        if (!moved) {
          this._onTap(e);
          this._resetTrack();
          return;
        }
        if (p < -PULL_THRESHOLD || (flick && velocity < 0 && dy < -30)) {
          this.goNext();
        } else if (p > PULL_THRESHOLD || (flick && velocity > 0 && dy > 30)) {
          this.goPrev();
        } else {
          this._resetTrack();
        }
      };

      vp.addEventListener('pointerdown', onDown);
      vp.addEventListener('pointermove', onMove);
      vp.addEventListener('pointerup', onUp);
      vp.addEventListener('pointercancel', () => {
        clearTimeout(longTimer);
        dragging = false;
        this.isDragging = false;
        this._resetTrack();
      });
      // 桌面滚轮
      vp.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const now = Date.now();
          if (Math.abs(e.deltaY) < 12) return;
          if (now - this._wheelAt < WHEEL_COOLDOWN) return;
          if (this.pending) return;
          this._wheelAt = now;
          if (e.deltaY > 0) this.goNext();
          else this.goPrev();
        },
        { passive: false }
      );
      // 视频还没加载完时点一下也能播
      this.center.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._onTap(e);
      });
    }

    /** 长按往上拖 = 加速播放 */
    _applyPressRate() {
      const rate = this.speed >= 2 ? 3 : 2;
      const slot = this._slot(0);
      slot.player.setRate(rate);
      this._showRateBadge(rate);
    }

    _showRateBadge(rate) {
      if (!this.rateBadge) {
        this.rateBadge = el('div', { class: 'bbdy-rate' });
        this.root.append(this.rateBadge);
      }
      this.rateBadge.textContent = rate + 'x ▶▶';
      this.rateBadge.hidden = false;
      clearTimeout(this._rateTimer);
      this._rateTimer = setTimeout(() => {
        this.rateBadge.hidden = true;
      }, 2600);
    }

    /** 自绘进度条：可点击也可拖动 seek */
    _bindProgress() {
      const seekFromEvent = (clientX) => {
        const rect = this.progressBar.getBoundingClientRect();
        const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        const slot = this._slot(0);
        const dur = slot.player.duration || this.item?.duration || 0;
        if (!dur) return;
        const t = ratio * dur;
        this.progressFill.style.width = ratio * 100 + '%';
        this.progressTime.textContent = `${BBDY.mmss(t)} / ${BBDY.mmss(dur)}`;
        return t;
      };
      this.progress.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.seeking = true;
        const t = seekFromEvent(e.clientX);
        const move = (ev) => seekFromEvent(ev.clientX);
        const up = (ev) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          this.seeking = false;
          const final = seekFromEvent(ev.clientX);
          if (final !== undefined) this._slot(0).player.seek(final);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }

    _resetTrack() {
      this.track.classList.add('bbdy-anim');
      this.track.style.transform = 'translateY(0)';
      this._applyDepth(0);
      const active = this._slot(0);
      if (active) {
        active.page.style.borderRadius = '';
        active.page.classList.add('bbdy-active');
        active.page.classList.remove('bbdy-adjacent');
      }
      setTimeout(() => this.track.classList.remove('bbdy-anim'), 300);
    }

    /** 单击 / 双击 / 双击左右两侧快进快退 */
    _onTap(e) {
      const now = performance.now();
      const x = e.clientX || 0;
      const y = e.clientY || 0;
      const last = this._tap;
      const isDouble = now - last.time < DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < 40;
      clearTimeout(this._tap.timer);
      if (isDouble) {
        this._tap.time = 0;
        const ratio = x / (this.viewport.clientWidth || 1);
        const slot = this._slot(0);
        // 屏幕中间区域双击点赞，左右两侧双击快退/快进
        if (ratio > 0.34 && ratio < 0.66) this.onAction('like', this.item);
        else if (slot.player.duration) slot.player.seek(slot.player.time + (ratio >= 0.66 ? 10 : -10));
        return;
      }
      this._tap = { time: now, x, y, timer: 0 };
      this._tap.timer = setTimeout(() => {
        this._tap.time = 0;
        this._singleTap();
      }, DOUBLE_TAP_MS);
    }

    _cancelTap() {
      clearTimeout(this._tap.timer);
      this._tap.time = 0;
    }

    _singleTap() {
      const slot = this._slot(0);
      // 首次点击顺带解除静音（符合"点一下就有声音"的直觉）
      if (this.muted) {
        this.setMuted(false);
        if (slot.player.state !== 'playing') slot.player.play();
        return;
      }
      const playing = slot.player.toggle();
      this._showBig(playing ? 'play' : 'pause', 600);
    }

    _bindKeys() {
      this._onKey = (e) => {
        if (!this.visible) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        const k = e.key;
        const map = {
          ArrowDown: () => this.goNext(),
          ArrowUp: () => this.goPrev(),
          j: () => this.goNext(),
          k: () => this.goPrev(),
          J: () => this.goNext(),
          K: () => this.goPrev(),
          ' ': () => this._space(),
          l: () => this.onAction('like', this.item),
          L: () => this.onAction('like', this.item),
          c: () => this.onAction('comment', this.item),
          C: () => this.onAction('comment', this.item),
          f: () => this.onAction('fav', this.item),
          F: () => this.onAction('fav', this.item),
          m: () => this.toggleMute(),
          M: () => this.toggleMute(),
          s: () => this.openSettings(),
          S: () => this.openSettings(),
          r: () => this.refresh(),
          R: () => this.refresh(),
          n: () => this.onAction('dislike', this.item),
          Escape: () => this._escape(),
          ArrowRight: () => this._slot(0).player.seek(this._slot(0).player.time + 5),
          ArrowLeft: () => this._slot(0).player.seek(this._slot(0).player.time - 5),
        };
        const fn = map[k];
        if (fn) {
          e.preventDefault();
          e.stopPropagation();
          fn();
        }
      };
      window.addEventListener('keydown', this._onKey, true);
    }

    _space() {
      const playing = this._slot(0).player.toggle();
      this._showBig(playing ? 'play' : 'pause', 700);
    }

    _escape() {
      if (this.settings.isOpen) return this.settings.close();
      if (this.comments.isOpen) return this.comments.close();
      const sheet = this.root.querySelector('.bbdy-sheet-mask');
      if (sheet) return sheet.remove();
      this.hide();
    }

    /* ==================================================================== *
     * 播放控制
     * ==================================================================== */
    toggleMute() {
      this.setMuted(!this.muted);
    }

    setMuted(muted, { silent } = {}) {
      this.muted = !!muted;
      this.muteBtn.innerHTML = BBDY.icon(this.muted ? 'volumeOff' : 'volume');
      const slot = this._slot(0);
      if (slot) slot.player.setMuted(this.muted);
      if (!this.muted) {
        this.toast('已开启声音', { bottom: true, ms: 1100 });
        this._hideHint();
      } else if (!silent) {
        this.toast('已静音', { bottom: true, ms: 1100 });
      }
      BBDY.config.save({ muteOnStart: this.muted }).catch(() => {});
    }

    toggleDanmaku() {
      const on = !BBDY.config.settings.danmaku;
      BBDY.config.save({ danmaku: on }).then(() => {
        this.danmakuBtn.classList.toggle('bbdy-on', on);
        for (const slot of this.slots) slot.player.setDanmaku(on);
        this.toast(on ? '弹幕已开' : '弹幕已关', { bottom: true, ms: 1200 });
      });
    }

    async switchSource(source) {
      if (this.pending) return;
      await BBDY.config.save({ source });
      this._syncSourceTabs();
      this.queue.reset(source);
      this.queue.source = source;
      this.upOnly = null;
      this.pending = true;
      this._showLoad('换一批…');
      try {
        this.track.style.transform = 'translateY(0)';
        const item = await this.queue.next();
        this.item = item;
        this.slots.forEach((s) => {
          if (s.offset !== 0) this._paintSlot(s, null);
        });
        this._renderAll();
      } catch (e) {
        this._showError(e);
      } finally {
        this.pending = false;
      }
      this.toast('已切换到「' + (SOURCE_LABEL[source] || source) + '」', { bottom: true, ms: 1200 });
    }

    _syncSourceTabs() {
      const cur = this.queue?.source || BBDY.config.settings.source;
      for (const [k, b] of Object.entries(this.tabBtns)) b.classList.toggle('bbdy-on', k === cur);
    }

    async refresh() {
      this.queue.reset();
      this.pending = true;
      this._showLoad('换一批…');
      try {
        const item = await this.queue.next();
        this.item = item;
        this._renderAll();
      } catch (e) {
        this._showError(e);
      } finally {
        this.pending = false;
      }
    }

    async applySpeed(rate) {
      this.speed = rate;
      // 官方 iframe 不开放倍速 API，退化为提示 + 本地记录（换源时生效）
      const ok = this._slot(0).player.post('playbackRate', rate) || this._slot(0).player.post('setPlaybackRate', rate);
      this.toast(ok ? `已设置 ${rate}x` : `已记录 ${rate}x（官方播放器可能不支持倍速）`, { bottom: true, ms: 2000 });
    }

    onSettingsChange(patch) {
      if (patch.screen) this.root.dataset.screen = patch.screen;
      if (patch.loop !== undefined) for (const s of this.slots) s.player.setLoop(patch.loop);
      if (patch.quality !== undefined) for (const s of this.slots) s.player.setQuality(patch.quality);
      if (patch.danmaku !== undefined) {
        this.danmakuBtn.classList.toggle('bbdy-on', patch.danmaku);
        for (const s of this.slots) s.player.setDanmaku(patch.danmaku);
      }
      this._paintSettings();
    }

    _paintSettings() {
      this.root.dataset.screen = BBDY.config.settings.screen;
      this.muted = !!BBDY.config.settings.muteOnStart;
      this.muteBtn.innerHTML = BBDY.icon(this.muted ? 'volumeOff' : 'volume');
      this.danmakuBtn.classList.toggle('bbdy-on', !!BBDY.config.settings.danmaku);
    }

    /* ==================================================================== *
     * 互动
     * ==================================================================== */
    async onAction(key, item) {
      if (!item && !['help'].includes(key)) return;
      const st = this.interact.get(item?.bvid || '') || {};
      const needLogin = () => {
        if (BBDY.api.isLogin()) return false;
        this.toast('需要先登录 B 站账号', { bottom: true, ms: 2200 });
        BBDY.api.openLogin();
        return true;
      };
      try {
        switch (key) {
          case 'like': {
            if (needLogin()) return;
            const on = !st.like;
            st.like = on;
            this.interact.set(item.bvid, st);
            this.actionbar.setState('like', on);
            if (on) this.actionbar.burstHeart();
            const r = await BBDY.api.like({ bvid: item.bvid, on });
            if (!r.ok) {
              st.like = !on;
              this.interact.set(item.bvid, st);
              this.actionbar.setState('like', !on);
              this.toast('点赞失败：' + (r.message || r.code), { bottom: true });
            } else if (on) {
              const mine = BBDY.api._nav?.data?.mid;
              if (mine && item.owner.mid === mine) BBDY.log('给自己点赞');
            }
            break;
          }
          case 'coin': {
            if (needLogin()) return;
            if (st.coin) {
              this.toast('已投过币了（B 站不支持撤币）', { bottom: true });
              return;
            }
            const r = await BBDY.api.coin({ bvid: item.bvid, count: 2 });
            if (r.ok) {
              st.coin = true;
              st.coinCount = 2;
              this.interact.set(item.bvid, st);
              this.actionbar.setState('coin', true);
              this.actionbar.setCount('coin', (item.stat.coin || 0) + 2);
              this.toast('已投 2 币，感谢 UP 主', { bottom: true });
            } else {
              this.toast('投币失败：' + (r.message || r.code), { bottom: true });
            }
            break;
          }
          case 'fav': {
            if (needLogin()) return;
            const on = !st.fav;
            if (!this.actionbar.favFolder) {
              const nav = await BBDY.api.nav();
              const folders = await BBDY.api.favFolders(nav.mid);
              if (!folders.length) {
                this.toast('没找到你的收藏夹', { bottom: true });
                return;
              }
              this.actionbar.favFolder = folders[0];
            }
            const fid = this.actionbar.favFolder.id;
            const r = await BBDY.api.fav({ bvid: item.bvid, on, addIds: fid, delIds: fid });
            if (r.ok) {
              st.fav = on;
              this.interact.set(item.bvid, st);
              this.actionbar.setState('fav', on);
              this.toast(on ? `已收藏到「${this.actionbar.favFolder.title}」` : '已取消收藏', { bottom: true });
            } else {
              this.toast('操作失败：' + (r.message || r.code), { bottom: true });
            }
            break;
          }
          case 'follow': {
            if (needLogin()) return;
            const followed = this._interactState(item).followed;
            const r = await BBDY.api.follow({ mid: item.owner.mid, on: !followed });
            if (r.ok) {
              st.followed = !followed;
              this.interact.set(item.bvid, st);
              item.followed = !followed;
              this.actionbar.setState('followed', !followed);
              this.followBtn.classList.toggle('bbdy-on', !followed);
              this.followBtn.textContent = !followed ? '已关注' : '+ 关注';
              this.toast(!followed ? `已关注 ${item.owner.name}` : `已取消关注 ${item.owner.name}`, { bottom: true });
            } else {
              this.toast('操作失败：' + (r.message || r.code), { bottom: true });
            }
            break;
          }
          case 'comment':
            if (this.comments.isOpen && this.comments.item?.bvid === item.bvid) this.comments.close();
            else this.comments.open(item);
            break;
          case 'share':
            await this.copyLink(item, { share: true });
            break;
          case 'copy':
            await this.copyLink(item);
            break;
          case 'open':
            window.open(`https://www.bilibili.com/video/${item.bvid}`, '_blank', 'noopener');
            break;
          case 'login': {
            const state = await BBDY.api.nav(true).catch(() => null);
            if (state?.isLogin) {
              this.toast(`当前已登录：${state.uname}`, { bottom: true });
              const again = await BBDY.api.nav(true).catch(() => null);
              if (again) this._paintMe(again);
            } else {
              BBDY.api.openLogin();
            }
            break;
          }
          case 'uponly':
            await this.showUpOnly(item);
            break;
          case 'dislike':
            await this.queue.block(item);
            this.toast('已减少此类推荐', { bottom: true });
            this.interact.delete(item.bvid);
            await this._afterRemoval();
            break;
          case 'watchlater':
            this.toast('可在 B 站「稍后再看」查看已加入的视频', { bottom: true });
            await BBDY.api.http
              .post('/x/v2/history/toview/add', { bvid: item.bvid })
              .then((r) => {
                if (r.code === 0) this.toast('已加入稍后再看', { bottom: true });
                else this.toast('加入失败：' + (r.message || r.code), { bottom: true });
              })
              .catch(() => this.toast('加入稍后再看失败', { bottom: true }));
            break;
          case 'speed':
            BBDY.speedMenu(this.root, item, this.speed, (rate) => this.applySpeed(rate));
            break;
          case 'report': {
            const reason = item.bvid;
            window.open(
              `https://www.bilibili.com/video/${reason}`,
              '_blank',
              'noopener'
            );
            this.toast('已打开原页面，可在播放器内举报', { bottom: true });
            break;
          }
          case 'blockup':
            this.toast('在「设置 - 本地屏蔽」里可管理已点踩的视频', { bottom: true });
            break;
          case 'more':
            BBDY.moreMenu(this.root, item, { onPick: (k, it) => this.onAction(k, it) });
            break;
          case 'help':
            BBDY.helpSheet(this.root);
            break;
          default:
            BBDY.log('未处理的动作', key);
        }
      } catch (e) {
        BBDY.warn('动作失败', key, e);
        this.toast('操作失败：' + (e.message || e), { bottom: true });
      }
      // 互动后刷新一下按钮数字
      if (item) this.actionbar.setItem(item, this._interactState(item));
    }

    async copyLink(item, { share } = {}) {
      const url = `https://www.bilibili.com/video/${item.bvid}`;
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch (_) {
        const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
        ta.value = url;
        document.body.append(ta);
        ta.select();
        copied = document.execCommand('copy');
        ta.remove();
      }
      if (share) BBDY.api.share(item.bvid);
      this.toast(copied ? '链接已复制，去粘贴给朋友吧' : url, { bottom: true, ms: copied ? 1500 : 3000 });
    }

    /** 只看这个 UP：把队列换成他的投稿 */
    async showUpOnly(item) {
      const mid = item.owner.mid;
      if (!mid) return;
      this.toast(`正在拉取 ${item.owner.name} 的投稿…`, { bottom: true });
      try {
        const list = await BBDY.api.spaceArc({ mid, ps: 30 });
        if (!list.length) {
          this.toast('这个 UP 没有可播放的投稿', { bottom: true });
          return;
        }
        this.upOnly = mid;
        this.queue.queue = list;
        this.queue.cursor = 0;
        this.queue.source = 'space';
        this.queue.schedulePrefetch();
        this.item = await this.queue.next();
        this._renderAll();
        this.toast(`已进入「只看 ${item.owner.name}」`, { bottom: true });
      } catch (e) {
        this.toast('拉取失败：' + (e.message || e), { bottom: true });
      }
    }

    async _afterRemoval() {
      // 当前这条被移除：用下一条填坑
      const next = this.queue.queue[this.queue.cursor];
      if (!next) {
        try {
          await this.queue.pull();
        } catch (_) {}
      }
      const item = await this.queue.ensure(0);
      if (!item) {
        this._showError(new Error('没有更多视频了'));
        return;
      }
      this.item = item;
      this._renderAll();
    }

    /* ==================================================================== *
     * UI 状态
     * ==================================================================== */
    _updateProgress({ time, duration }) {
      if (this.seeking) return;
      const d = duration || this.item?.duration || 0;
      const pct = d ? clamp((time / d) * 100, 0, 100) : 0;
      this.progressFill.style.width = pct + '%';
      this.progressTime.textContent = `${BBDY.mmss(time)} / ${BBDY.mmss(d)}`;
    }

    _showBig(iconName, ms) {
      this.bigBtn.innerHTML = BBDY.icon(iconName);
      this.bigBtn.classList.add('bbdy-show');
      clearTimeout(this._bigTimer);
      this._bigTimer = setTimeout(() => this.bigBtn.classList.remove('bbdy-show'), ms || 700);
    }

    _showLoad(text) {
      this.loadWrap.hidden = false;
      this.loadWrap.querySelector('.bbdy-tip').textContent = text || '加载中…';
      this.spinner.hidden = false;
      this.spinner.classList.add('bbdy-spinner');
      const retry = this.loadWrap.querySelector('.bbdy-retry');
      if (retry) retry.remove();
    }

    _hideLoad() {
      this.loadWrap.hidden = true;
      this._checkSoundHint();
    }

    _showError(e) {
      this.loadWrap.hidden = false;
      this.spinner.hidden = true;
      this.loadWrap.querySelector('.bbdy-tip').textContent = '出了点问题：' + (e?.message || e);
      if (!this.loadWrap.querySelector('.bbdy-retry')) {
        this.loadWrap.append(
          el('button', {
            class: 'bbdy-retry',
            text: '重试',
            attrs: { type: 'button' },
            onclick: (ev) => {
              ev.stopPropagation();
              this._showLoad('重试中…');
              this.refresh();
            },
          })
        );
      }
    }

    /** 静音启动时给一条"轻触开启声音"的提示（仅原生引擎可控音量） */
    _checkSoundHint() {
      if (!this.muted || !this.visible) return;
      if (this.hint) return;
      const native = this._slot(0)?.player?.isNative;
      this.hint = el('div', {
        class: 'bbdy-hint',
        html: `${BBDY.icon(native ? 'volumeOff' : 'play')}<span>${
          native ? '静音播放中 · 轻触开启声音' : '官方播放器请点画面中央播放'
        }</span>`,
        onclick: (e) => {
          e.stopPropagation();
          if (native) this.setMuted(false);
          else this._singleTap();
        },
      });
      this.root.append(this.hint);
    }

    _hideHint() {
      if (this.hint) {
        this.hint.remove();
        this.hint = null;
      }
    }

    toast(text, opts) {
      return BBDY.sheets.toast(this.root, text, opts);
    }

    /** 顶栏右侧的登录态胶囊 */
    _paintMe(nav) {
      if (!nav) return;
      this.meBox.hidden = false;
      this.meBox.innerHTML = '';
      this.meBox.style.cursor = 'pointer';
      if (nav.isLogin) {
        if (nav.face) this.meBox.append(el('img', { attrs: { src: nav.face, alt: '' } }));
        this.meBox.append(el('span', { text: nav.uname + (nav.money ? `（${nav.money} 币）` : '') }));
        this.meBox.onclick = (e) => {
          e.stopPropagation();
          this.openSettings();
        };
      } else {
        this.meBox.append(el('span', { text: '未登录 · 点此登录' }));
        this.meBox.onclick = (e) => {
          e.stopPropagation();
          BBDY.api.openLogin();
        };
      }
    }

    async _bootstrapAuth() {
      try {
        const nav = await BBDY.api.nav();
        this._paintMe(nav);
        if (!nav.isLogin) {
          this.toast('未登录也能刷，但推荐会更泛；登录后可点赞投币', { bottom: true, ms: 3200 });
        }
      } catch (e) {
        BBDY.log('登录态获取失败', e.message);
      }
    }

    async openSettings() {
      const item = this.item;
      let qualities = null;
      if (item) {
        const pu = await BBDY.api.playurl({ bvid: item.bvid, cid: item.cid || undefined }).catch(() => null);
        qualities = pu?.accept || null;
        if (pu?.duration && !item.duration) item.duration = pu.duration;
      }
      this.settings.open({ item, qualities });
    }
  }

  BBDY.Overlay = Overlay;
})();
