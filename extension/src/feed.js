/**
 * feed.js —— 视频流队列
 *
 * 负责：从各个来源（推荐／热门／排行／关注）取数据、去重、过滤已拉黑、
 * 提前预取下一条要用的播放信息，保证「手指一滑立刻能播」，不出现等待。
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;

  class FeedQueue {
    constructor(opts = {}) {
      this.opts = opts;
      this.source = opts.source || 'recommend';
      this.queue = [];
      this.history = [];
      this.cursor = 0; // 下一条要消费的下标
      this.batch = 1; // 推荐流的翻页计数
      this.page = {}; // 分页来源的页码
      this.loading = false;
      this.error = null;
      this.failStreak = 0;
      this.prefetching = new Map(); // bvid -> Promise
      this.detailCache = new Map(); // bvid -> item（带 cid 的详情）
      this.tagsCache = new Map();
      this.onnotice = opts.onnotice || (() => {});
    }

    get size() {
      return Math.max(0, this.queue.length - this.cursor);
    }
    get hasNext() {
      return this.size > 0;
    }

    /** 拉一批新的卡片 */
    async pull() {
      const { settings } = BBDY.config;
      const size = settings.pageSize || 12;
      const src = this.source;
      let list = [];
      try {
        if (src === 'popular') {
          this.page.popular = (this.page.popular || 0) + 1;
          list = await BBDY.api.popular({ pn: this.page.popular, ps: size });
          if (this.page.popular >= 6) this.page.popular = 0; // 热门口碑有限，循环刷
        } else if (src === 'ranking') {
          const rids = [0, 1, 3, 4, 5, 36, 119, 129, 155, 160, 168, 181, 188, 211, 217, 223, 234, 249, 251];
          const rid = rids[(this.page.rankIdx = ((this.page.rankIdx || 0) + 1) % rids.length)];
          list = await BBDY.api.ranking({ rid });
        } else if (src === 'follow') {
          if (!BBDY.api.isLogin()) {
            this.onnotice('关注流需要先登录 B 站账号，已切到推荐流', 'warn');
            this.source = 'recommend';
          } else {
            this.page.follow = (this.page.follow || 0) + 1;
            list = await BBDY.api.followFeed({ page: this.page.follow });
            if (!list.length) this.page.follow = 0;
          }
        }
        if (!list.length) {
          this.batch = this.batch >= 30 ? 1 : this.batch + 1;
          list = await BBDY.api.recommend({ fresh: this.batch, pageSize: size, brush: this.batch });
        }
        // 推荐流偶尔会返回已经在队列里的重复项，混一点相关推荐增加多样性
        if (this.lastBvid && list.length < 4) {
          const extra = await BBDY.api.related(this.lastBvid);
          list = list.concat(extra);
        }
      } catch (e) {
        this.error = e;
        this.failStreak++;
        BBDY.warn('拉取失败', this.source, e);
        if (this.failStreak <= 3) {
          this.onnotice(`拉取失败：${e.message || e}，正在重试…`, 'warn');
          await BBDY.wait(600 * this.failStreak);
        }
        // 推荐流挂了就退到热门，保证「永远有的刷」
        if (this.source === 'recommend' && this.failStreak >= 2) {
          try {
            list = await BBDY.api.popular({ pn: 1 + (this.page.fallback || 0), ps: size });
            this.page.fallback = ((this.page.fallback || 0) + 1) % 5;
            this.onnotice('推荐接口不可用，已切到热门视频', 'warn');
          } catch (_) {}
        }
        if (!list.length) throw e;
      }
      const fresh = list.filter((it) => it && it.bvid && !BBDY.config.isBlocked(it.bvid));
      if (!fresh.length && list.length) return this.pull(); // 整批都被拉黑了，再拉一批
      this.failStreak = 0;
      this.error = null;
      this.queue = this.queue.slice(this.cursor).concat(fresh);
      this.cursor = 0;
      BBDY.log('拉取到', fresh.length, '条', this.source);
      return fresh;
    }

    /** 取第 n 条（n = 0 表示当前），必要时自动补货 */
    async ensure(n = 0) {
      let guard = 0;
      while (this.size <= n && guard++ < 4) {
        if (this.loading) {
          await this.loading;
          continue;
        }
        this.loading = this.pull().finally(() => {
          this.loading = false;
        });
        await this.loading;
      }
      return this.queue[this.cursor + n] || null;
    }

    current() {
      return this.queue[this.cursor] || null;
    }

    /** 前进一条；返回新的当前项 */
    async next() {
      const cur = this.current();
      if (cur) {
        this.history.push(cur);
        this.cursor++;
      }
      const item = await this.ensure(0);
      if (!item) throw new Error('没有更多视频了');
      this.lastBvid = item.bvid;
      BBDY.config.markSeen(item.bvid);
      this.schedulePrefetch();
      return item;
    }

    /** 后退一条（回到上一个刷过的） */
    async prev() {
      if (this.cursor > 0) {
        this.cursor--;
        const item = await this.ensure(0);
        this.schedulePrefetch();
        return item;
      }
      // 队列开头：直接复用刚看过的历史
      if (this.history.length) {
        const last = this.history[this.history.length - 1];
        this.queue.unshift(last);
        this.cursor = 0;
        this.schedulePrefetch();
        return last;
      }
      return null;
    }

    /** 预取后续若干条的播放信息与卡片 */
    schedulePrefetch() {
      const n = BBDY.config.settings.preload || 1;
      for (let i = 1; i <= n; i++) this.prefetch(i);
      this.ensure(Math.min(n, 2)).catch(() => {});
    }

    async prefetch(n = 1) {
      const item = this.queue[this.cursor + n];
      if (!item || !item.bvid) return null;
      return this.detail(item);
    }

    /** 补全 cid / 时长 / 话题等详情，带缓存与去重 */
    async detail(item) {
      if (!item || !item.bvid) return null;
      if (item.cid && item.detail) return item;
      const key = item.bvid;
      if (this.detailCache.has(key) && this.detailCache.get(key).cid) return this.detailCache.get(key);
      if (this.prefetching.has(key)) return this.prefetching.get(key);
      const job = (async () => {
        try {
          const full = await BBDY.api.view(item.bvid);
          if (full) {
            Object.assign(item, {
              cid: full.cid || item.cid,
              duration: full.duration || item.duration,
              stat: full.stat.like || full.stat.view ? full.stat : item.stat,
              desc: full.desc || item.desc,
              tname: full.tname || item.tname,
              pages: full.pages,
              reqUser: full.reqUser,
              tags: full.tags,
              detail: true,
            });
          }
        } catch (e) {
          BBDY.log('详情接口失败（不影响播放）', item.bvid, e.message);
        }
        if (!item.tags) this.tags(item);
        this.detailCache.set(key, item);
        this.prefetching.delete(key);
        return item;
      })();
      this.prefetching.set(key, job);
      return job;
    }

    /** 话题标签（异步补，不阻塞播放） */
    async tags(item) {
      if (!item || item.tags || this.tagsCache.has(item.bvid)) return item?.tags || [];
      const job = BBDY.api.tags(item.bvid).then((tags) => {
        item.tags = tags;
        this.tagsCache.set(item.bvid, tags);
        return tags;
      });
      this.tagsCache.set(item.bvid, []);
      return job;
    }

    /** 不感兴趣：通知服务端 + 本地移除 */
    async block(item, { report = true } = {}) {
      if (!item) return;
      BBDY.config.block(item.bvid, item.title);
      this.queue = this.queue.filter((x) => x.bvid !== item.bvid);
      if (report && this.source === 'recommend') {
        BBDY.api.dislike({ bvid: item.bvid, aid: item.aid }).then((r) => {
          if (!r.ok) BBDY.log('服务端不喜欢上报失败', r.message);
        });
      }
      if (item.owner?.mid) await BBDY.api.spaceArc({ mid: item.owner.mid, ps: 0 }).catch(() => {});
    }

    /** 换一批：清空待播队列 */
    reset(source) {
      if (source) this.source = source;
      this.queue = this.queue.slice(0, this.cursor);
      this.error = null;
      this.failStreak = 0;
      this.batch = 1;
      this.page = {};
      this.detailCache.clear();
    }
  }

  BBDY.FeedQueue = FeedQueue;
})();
