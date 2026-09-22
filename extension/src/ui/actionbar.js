/**
 * ui/actionbar.js —— 右侧竖排互动栏（点赞/投币/收藏/评论/分享 + 关注 + 音乐碟）
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;
  const { el } = BBDY;

  const ICON_FOR = { like: 'heart', coin: 'coin', fav: 'star', comment: 'comment', share: 'share', more: 'more' };

  class ActionBar {
    /** @param {HTMLElement} host @param {{onAction:Function}} opts */
    constructor(host, opts = {}) {
      this.onAction = opts.onAction || (() => {});
      this.item = null;
      this.state = { like: false, coin: false, fav: false, followed: false };
      this.counts = { like: 0, coin: 0, fav: 0, comment: 0, share: 0 };
      this.favFolder = null;
      this.root = el('div', { class: 'bbdy-actions' });
      this.buttons = {};
      this._build();
      host.append(this.root);
    }

    _build() {
      const order = ['like', 'coin', 'fav', 'comment', 'share'];
      for (const key of order) {
        const btn = el('button', {
          class: 'bbdy-action',
          dataset: { act: key },
          attrs: { type: 'button', title: this._title(key) },
          onclick: (e) => {
            e.stopPropagation();
            this.onAction(key, this.item);
          },
        });
        btn.innerHTML =
          BBDY.icon(ICON_FOR[key]) + `<span class="bbdy-action-num" data-num="${key}">0</span>`;
        this.buttons[key] = btn;
        this.root.append(btn);
      }

      // 分享不显示数字，用"分享"文字更接近原版
      this.buttons.share.querySelector('[data-num]').textContent = '分享';
      this.buttons.share.querySelector('[data-num]').dataset.static = '1';

      // UP 主头像 + 关注
      this.avatar = el('button', {
        class: 'bbdy-avatar-btn',
        attrs: { type: 'button', title: '关注 / 取关' },
        onclick: (e) => {
          e.stopPropagation();
          this.onAction('follow', this.item);
        },
      });
      this.avatarImg = el('img', { attrs: { alt: '', src: '' } });
      this.avatar.append(
        this.avatarImg,
        el('span', { class: 'bbdy-followplus', html: BBDY.icon('plus') })
      );
      this.root.append(this.avatar);

      // 音乐碟（装饰，随播放旋转）
      this.disc = el('div', { class: 'bbdy-disc' });
      this.discImg = el('img', { attrs: { alt: '', src: '' } });
      this.disc.append(this.discImg);
      this.root.append(this.disc);

      this.moreBtn = el('button', {
        class: 'bbdy-iconbtn',
        attrs: { type: 'button', title: '更多（长按视频同款菜单）' },
        style: { marginTop: '2px' },
        onclick: (e) => {
          e.stopPropagation();
          this.onAction('more', this.item);
        },
      });
      this.moreBtn.innerHTML = BBDY.icon('more');
      this.root.append(this.moreBtn);
    }

    _title(key) {
      return { like: '点赞 (L)', coin: '投币', fav: '收藏 (F)', comment: '评论 (C)', share: '分享' }[key] || key;
    }

    /** 切换视频时刷新 */
    setItem(item, interact = {}) {
      this.item = item;
      this.state = {
        like: !!item.interact?.like,
        coin: !!item.interact?.coin,
        fav: !!item.interact?.fav,
        followed: !!(item.followed || item.interact?.followed),
      };
      const stat = item.stat || {};
      this.counts = {
        like: Number(stat.like || 0) + (this.state.like && !item.interact?.like ? 1 : 0),
        coin: Number(stat.coin || 0),
        fav: Number(stat.fav || 0),
        comment: Number(stat.reply || 0),
        share: Number(stat.share || 0),
      };
      this.avatarImg.src = item.owner.face || '';
      this.avatarImg.alt = item.owner.name;
      this.discImg.src = item.owner.face || '';
      // 头像加载失败时用封面兜底，别留白块
      this.avatarImg.onerror = () => {
        this.avatarImg.onerror = null;
        this.avatarImg.src = item.pic || '';
      };
      this.discImg.onerror = () => {
        this.discImg.onerror = null;
        this.discImg.src = item.pic || '';
      };
      this.render();
    }

    setState(key, on) {
      if (!(key in this.state)) return;
      this.state[key] = !!on;
      if (key === 'like' && this.item) {
        this.counts.like = Math.max(0, this.counts.like + (on ? 1 : -1));
      }
      if (key === 'fav' && this.item) {
        this.counts.fav = Math.max(0, this.counts.fav + (on ? 1 : -1));
      }
      this.render();
    }

    setCount(key, value) {
      this.counts[key] = Math.max(0, Number(value) || 0);
      this.render();
    }

    render() {
      for (const [key, btn] of Object.entries(this.buttons)) {
        if (key === 'like' || key === 'coin' || key === 'fav') btn.classList.toggle('bbdy-on', !!this.state[key]);
        const numEl = btn.querySelector('[data-num]');
        if (!numEl || numEl.dataset.static) continue;
        if (key === 'fav' && this.state.fav && !this.counts.fav) numEl.textContent = '已收藏';
        else numEl.textContent = BBDY.num(this.counts[key] || 0);
      }
      this.avatar.classList.toggle('bbdy-followed', !!this.state.followed);
      this.avatar.title = this.state.followed ? '已关注（点击取关）' : '关注';
      this.buttons.comment.title = `评论 (C) · ${BBDY.numFull(this.counts.comment)}`;
    }

    setPlaying(playing) {
      this.disc.classList.toggle('bbdy-playing', !!playing);
    }

    /** 点赞按钮上飞心的动画 */
    burstHeart() {
      const btn = this.buttons.like;
      const r = btn.getBoundingClientRect();
      for (const cls of ['bbdy-heart', 'bbdy-heart bbdy-pop2']) {
        const h = el('div', { class: cls, html: BBDY.icon('heart') });
        h.style.position = 'fixed';
        h.style.left = r.left + r.width / 2 - 45 + 'px';
        h.style.top = r.top + r.height / 2 - 45 + 'px';
        document.body.append(h);
        setTimeout(() => h.remove(), 1200);
      }
    }

    destroy() {
      this.root.remove();
    }
  }

  BBDY.ActionBar = ActionBar;
})();
