/**
 * ui/comments.js —— 评论区抽屉（上滑抽屉 + 分页加载）
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;
  const { el, escapeHtml } = BBDY;

  class CommentDrawer {
    /**
     * @param {HTMLElement} host 全屏根节点
     * @param {{onNotice:Function}} opts
     */
    constructor(host, opts = {}) {
      this.host = host;
      this.onNotice = opts.onNotice || (() => {});
      this.item = null;
      this.page = 1;
      this.total = 0;
      this.loading = false;
      this.done = false;
      this.ui = null;
      this.requestId = 0;
    }

    async open(item) {
      if (!item) return;
      if (this.ui) this.close();
      this.item = item;
      this.page = 1;
      this.total = 0;
      this.done = false;
      const rid = ++this.requestId;

      this.ui = BBDY.sheets.sheet({
        title: `评论 ${BBDY.numFull(item.stat?.reply || 0)}`,
        cls: 'bbdy-comments',
        onClose: () => {
          this.ui = null;
        },
      });
      this.body = this.ui.body;
      this.body.append(el('div', { class: 'bbdy-loading-row', text: '评论加载中…' }));
      this.ui.root.addEventListener('scroll', () => this._maybeLoadMore(), { passive: true });
      this.body.addEventListener('scroll', () => this._maybeLoadMore(), { passive: true });
      this.host.append(this.ui.root);
      await this._load(rid);
    }

    close() {
      this.requestId++;
      if (this.ui) this.ui.close();
      this.ui = null;
    }

    get isOpen() {
      return !!this.ui;
    }

    _maybeLoadMore() {
      if (!this.body || this.loading || this.done) return;
      const near = this.body.scrollTop + this.body.clientHeight > this.body.scrollHeight - 240;
      if (near) this._load(this.requestId);
    }

    async _load(rid) {
      if (this.loading || this.done) return;
      this.loading = true;
      try {
        const res = await BBDY.api.comments({ aid: this.item.aid, pn: this.page, ps: 20 });
        if (rid !== this.requestId || !this.ui) return;
        if (this.page === 1) {
          this.body.innerHTML = '';
          this.total = res.total || 0;
          this.ui.head.querySelector('span').textContent = `评论 ${BBDY.numFull(this.total)}`;
        }
        if (res.code !== 0 && this.page === 1) {
          this.body.append(
            el('div', {
              class: 'bbdy-empty',
              text: res.code === -404 ? '评论区已关闭' : `评论加载失败（${res.message || res.code}）`,
            })
          );
          this.done = true;
          return;
        }
        if (!res.list.length) {
          if (this.page === 1) {
            this.body.append(el('div', { class: 'bbdy-empty', text: '还没有人评论，说点什么？' }));
          }
          this.done = true;
          return;
        }
        for (const c of res.list) this.body.append(this._render(c));
        this.body.append(el('div', { class: 'bbdy-loading-row', text: '上滑加载更多…' }));
        this.page++;
        if (this.body.children.length - 1 >= this.total) this.done = true;
      } catch (e) {
        if (rid === this.requestId && this.page === 1) {
          this.body.innerHTML = '';
          this.body.append(el('div', { class: 'bbdy-empty', text: '评论加载失败：' + (e.message || e) }));
        }
      } finally {
        this.loading = false;
        const tip = this.body.querySelector('.bbdy-loading-row:last-child');
        if (tip && this.done) tip.remove();
      }
    }

    _render(c) {
      const node = el('div', { class: 'bbdy-comment' });
      const img = el('img', { attrs: { src: c.user.face || '', alt: '', loading: 'lazy' } });
      img.onerror = () => {
        img.style.visibility = 'hidden';
      };
      const main = el('div', { class: 'bbdy-comment-main' });
      const top = el('div', { class: 'bbdy-comment-top' });
      top.append(
        el('span', { class: 'bbdy-comment-name', text: c.user.name }),
        c.user.level ? el('span', { class: 'bbdy-lv', text: 'LV' + c.user.level }) : null,
        el('span', { text: BBDY.since(c.ctime) }),
        c.ip ? el('span', { text: c.ip }) : null
      );
      main.append(
        top,
        el('div', { class: 'bbdy-comment-msg', text: c.message }),
        el('div', {
          class: 'bbdy-comment-foot',
          html: `${BBDY.icon('heart')} ${BBDY.num(c.like)}` + (c.replyCount ? `　${BBDY.icon('comment')} ${BBDY.num(c.replyCount)}` : ''),
        })
      );
      if (c.replies?.length) {
        const sub = el('div', { class: 'bbdy-comment-sub' });
        for (const s of c.replies.slice(0, 3)) {
          sub.append(
            el('div', {
              html: `<b>${escapeHtml(s.user.name)}</b>：${escapeHtml(s.message)}`,
            })
          );
        }
        if (c.replyCount > c.replies.length) {
          sub.append(el('div', { style: { opacity: '0.7' }, text: `共 ${c.replyCount} 条回复` }));
        }
        main.append(sub);
      }
      node.append(img, main);
      return node;
    }
  }

  BBDY.CommentDrawer = CommentDrawer;
})();
