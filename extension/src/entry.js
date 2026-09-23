/**
 * entry.js —— 把入口做进 B 站自己的界面里
 *
 * 三个位置，按「越原生越优先」的顺序：
 *   1. 顶栏右侧（所有页面）：插在头像左边的一颗粉色药丸，和 B 站自己的入口排在一起
 *   2. 视频页互动栏（一键三连那一排）末尾：直接在当前视频上开刷
 *   3. 右下角悬浮按钮：顶栏结构改版/登录页等场景兜底
 *
 * B 站顶栏和互动栏都是组件异步渲染的，所以这里用「选择器链 + MutationObserver 重试」，
 * 任何一环找不到都不会报错，只会退到下一个位置。
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;

  const MARK = 'data-bbdy-entry';
  const PILL_NAV = 'nav';
  const PILL_TOOLBAR = 'toolbar';

  /** 顶栏右侧容器：从最精确的锚点一路退到最宽松的 */
  const NAV_ANCHORS = [
    // 首选：整条右侧入口栏（药丸会排到头像左边）
    { sel: '.right-entry__main', pos: 'beforeAvatar' },
    { sel: '.right-entry', pos: 'beforeAvatar' },
    // 退而求其次：直接挨着头像插
    { sel: '.header-avatar-wrap', pos: 'before' },
    { sel: '.header-avatar', pos: 'before' },
    { sel: '.header-avatar-unlogin-entry', pos: 'before' },
    { sel: '.header-login-entry', pos: 'before' },
    // 再退：右侧入口的第一项之前
    { sel: '.right-entry__item', pos: 'before' },
    // 最后：整条顶栏的最右边
    { sel: '.bili-header__bar', pos: 'append' },
  ];

  /** 视频页互动栏：插在最后一个三连按钮后面 */
  const TOOLBAR_ANCHORS = [
    { sel: '#arc_toolbar_report .video-toolbar-left-main', pos: 'append' },
    { sel: '#arc_toolbar_report .video-toolbar-left', pos: 'append' },
    { sel: '.video-toolbar-left-main', pos: 'append' },
    { sel: '#arc_toolbar_report', pos: 'append' },
    { sel: '.video-toolbar-container', pos: 'append' },
  ];

  const pick = (anchors) => {
    for (const a of anchors) {
      const node = document.querySelector(a.sel);
      if (node) return { node, pos: a.pos };
    }
    return null;
  };

  /** 当前页面上的视频 BV 号（视频页才有效） */
  function currentBvid() {
    const m = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
    if (m) return m[1];
    const q = new URLSearchParams(location.search);
    return /^BV[0-9A-Za-z]+$/.test(q.get('bvid') || '') ? q.get('bvid') : '';
  }

  const isVideoPage = () => !!currentBvid();

  /* ------------------------------------------------------------------ *
   * 药丸按钮
   * ------------------------------------------------------------------ */
  function buildPill(kind) {
    const pill = document.createElement(kind === PILL_TOOLBAR ? 'div' : 'a');
    pill.className = 'bbdy-pill bbdy-pill--' + kind;
    pill.setAttribute(MARK, kind);
    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '0');
    pill.title = '刷B站 · 竖滑视频流（Alt+Shift+B）';
    if (kind === 'nav') pill.href = 'javascript:void(0)';
    pill.innerHTML =
      `<span class="bbdy-pill-icon">${BBDY.icon('play')}</span>` +
      `<span class="bbdy-pill-text">竖滑刷</span>`;

    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      BBDY.userInvoked = true;
      BBDY.toggleOverlay(true);
    };
    pill.addEventListener('click', open, true);
    pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
    // B 站顶栏的 hover 面板可能吃掉事件
    pill.addEventListener('mousedown', (e) => e.stopPropagation());
    pill.addEventListener('mouseup', (e) => e.stopPropagation());
    return pill;
  }

  function placePill(kind, anchors) {
    const found = pick(anchors);
    if (!found) return false;
    const { node, pos } = found;
    // 只复用「还活在文档里」的那颗；B 站重建顶栏后旧节点要丢掉重插
    let pill = null;
    for (const p of document.querySelectorAll(`[${MARK}="${kind}"]`)) {
      if (p.isConnected) {
        pill = p;
        break;
      }
    }
    if (!pill) pill = buildPill(kind);
    // 已经在正确位置就不动它（避免反复重排引起闪烁）
    if (pill.parentElement) {
      if (pos === 'append' && pill.parentElement === node) return true;
      if (pos !== 'append' && pill.parentElement === node.parentElement) return true;
    }
    try {
      if (pos === 'append') node.append(pill);
      else if (pos === 'before') node.before(pill);
      else if (pos === 'beforeAvatar') {
        // 排到头像（或整栏最后一项）左边
        const avatar =
          node.querySelector('.header-avatar-wrap, .header-avatar, .header-avatar-unlogin-entry') ||
          [...node.children].pop();
        if (avatar && avatar.parentElement === node) avatar.before(pill);
        else node.append(pill);
      }
    } catch (e) {
      BBDY.warn('入口注入失败', kind, e);
      return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 兜底悬浮按钮
   * ------------------------------------------------------------------ */
  let launcher = null;
  function buildLauncher() {
    const btn = document.createElement('button');
    btn.className = 'bbdy-launcher';
    btn.type = 'button';
    btn.title = '刷B站 · 竖滑视频流（Alt+Shift+B）';
    btn.innerHTML = `<span class="bbdy-icon">${BBDY.icon('play')}</span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      BBDY.userInvoked = true;
      BBDY.toggleOverlay(true);
    });
    // 拖动换位置，别挡住 B 站自己的悬浮元素
    let dragging = false;
    let moved = false;
    let sy = 0;
    let sx = 0;
    let bottom = 96;
    let right = 18;
    btn.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = false;
      sy = e.clientY;
      sx = e.clientX;
      btn.setPointerCapture(e.pointerId);
    });
    btn.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = sy - e.clientY;
      const dx = sx - e.clientX;
      if (!moved && Math.hypot(dx, dy) > 6) moved = true;
      if (!moved) return;
      bottom = BBDY.clamp(bottom + dy, 20, window.innerHeight - 80);
      right = BBDY.clamp(right + dx, 8, window.innerWidth - 70);
      btn.style.bottom = bottom + 'px';
      btn.style.right = right + 'px';
      sy = e.clientY;
      sx = e.clientX;
    });
    btn.addEventListener('pointerup', () => {
      dragging = false;
      if (moved) {
        btn.dataset.moved = '1';
        setTimeout(() => delete btn.dataset.moved, 300);
      }
    });
    btn.addEventListener(
      'click',
      (e) => {
        if (btn.dataset.moved) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
    return btn;
  }

  /** 悬浮按钮只在「设置为悬浮模式」或「顶栏入口没插上」时出现 */
  function paintLauncher() {
    const s = BBDY.config.settings;
    const overlayOpen = !!(BBDY.getOverlay && BBDY.getOverlay().visible);
    const navOk = !!document.querySelector(`[${MARK}="nav"]`);
    const wantFloating =
      s.entryMode !== 'hidden' && !overlayOpen && (s.entryMode === 'floating' || !navOk);
    if (wantFloating && !launcher) {
      launcher = buildLauncher();
      document.body.append(launcher);
    } else if (!wantFloating && launcher) {
      launcher.remove();
      launcher = null;
    }
  }

  /* ------------------------------------------------------------------ *
   * 注入调度
   * ------------------------------------------------------------------ */
  let scheduled = 0;
  function ensure() {
    clearTimeout(scheduled);
    scheduled = setTimeout(() => {
      // 顶栏/互动栏被 B 站重建时，旧药丸会脱离文档，这里顺手清掉
      for (const stale of document.querySelectorAll(`[${MARK}].bbdy-pill`)) {
        if (!stale.isConnected) stale.remove();
      }
      if (BBDY.config.settings.entryMode !== 'floating') {
        placePill(PILL_NAV, NAV_ANCHORS);
        if (isVideoPage()) placePill(PILL_TOOLBAR, TOOLBAR_ANCHORS);
        else {
          const t = document.querySelector(`[${MARK}="${PILL_TOOLBAR}"]`);
          if (t) t.remove();
        }
      } else {
        for (const p of document.querySelectorAll(`[${MARK}].bbdy-pill`)) p.remove();
      }
      paintLauncher();
    }, 60);
  }

  const ensureSoon = () => ensure();

  function watch() {
    // B 站是 SPA：顶栏/互动栏会反复重建，用观察者兜住
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType === 1 && !n.classList?.contains('bbdy-pill') && !n.closest?.('.bbdy-root')) {
            ensureSoon();
            return;
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // 路由变化（history API + 后退）
    let lastUrl = location.href;
    const onNav = () => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      if (BBDY.config.settings.openOnVideoPage && isVideoPage() && !BBDY.userInvoked) {
        // 用户明确要求「进视频页自动开刷」时才自动打开
        BBDY.toggleOverlay(true);
      }
      ensureSoon();
    };
    for (const fn of ['pushState', 'replaceState']) {
      const orig = history[fn];
      history[fn] = function (...args) {
        const r = orig.apply(this, args);
        setTimeout(onNav, 0);
        return r;
      };
    }
    window.addEventListener('popstate', () => setTimeout(onNav, 0));
    return mo;
  }

  BBDY.entry = { ensure, paintLauncher, watch, currentBvid, isVideoPage, buildPill, placePill, MARK };
})();
