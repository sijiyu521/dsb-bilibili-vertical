/**
 * entry.js —— 把入口做进 B 站自己的界面里
 *
 * 四个位置，按「越原生越优先」的顺序：
 *   1. 视频页「更多」菜单（⋯）：把「竖滑模式刷视频 / 看评论 / 只刷这个 UP / 不感兴趣 / 复制链接」
 *      直接并进 B 站自己的下拉菜单里，复用它的 dropdown-item 样式（首选入口）
 *   2. 视频页互动栏（一键三连那一排）末尾：一颗药丸按钮；点它优先点开 B 站自己的「更多」菜单，
 *      菜单结构变了就弹一个参数照抄 .video-tool-more-popover 的同款菜单
 *   3. 顶栏右侧（所有页面）：插在头像左边的粉色药丸，点了直接开刷
 *   4. 右下角悬浮按钮：顶栏结构改版/登录页等场景兜底
 *
 * B 站顶栏、互动栏、菜单都是组件异步渲染的，所以这里用「选择器链 + MutationObserver 重试」，
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

  /** 视频页自带的「更多」菜单（⋯）——优先把入口加进这里，最像原生 */
  const NATIVE_MENU_WRAP = [
    '.video-tool-more-popover .video-tool-more-dropdown',
    '.video-tool-more-dropdown',
    '.video-tool-more-popover',
  ];
  /** 触发「更多」菜单的按钮，用来定位我们自己的兜底菜单 */
  const MORE_BUTTON = [
    '[class*="video-tool-more"]',
    '[data-header-fav-entry] + *',
    '.video-toolbar-left-main [class*="more"]',
  ];

  const pick = (anchors) => {
    for (const a of anchors) {
      const node = document.querySelector(a.sel);
      if (node) return { node, pos: a.pos };
    }
    return null;
  };

  const pickSel = (sels) => {
    for (const s of sels) {
      const node = document.querySelector(s);
      if (node) return node;
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
      // 顶栏那颗：直接开刷
      if (kind === PILL_NAV) {
        BBDY.userInvoked = true;
        BBDY.toggleOverlay(true, { seed: currentBvid() });
        return;
      }
      // 视频页那颗：点开「更多」菜单（菜单里有竖滑入口）
      onToolbarPillClick(e, pill);
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
   * 视频页菜单：优先并入 B 站自己的「更多」菜单
   * ------------------------------------------------------------------ */
  const MENU_MARK = 'data-bbdy-menu';

  /** 菜单里的功能项定义（图标名对应 icons.js）
   *  run(ctx) 收到的是 { api, bvid, close }，api 由 Overlay 提供。 */
  function menuItems() {
    const bvid = currentBvid();
    return [
      {
        key: 'feed',
        icon: 'play',
        text: '竖滑模式刷视频',
        hint: 'Alt+Shift+B',
        run: ({ api }) => api.openFeed(bvid),
      },
      { key: 'comment', icon: 'comment', text: '在竖滑里看评论', run: ({ api }) => api.comments(bvid) },
      { key: 'uponly', icon: 'history', text: '只刷这个 UP 主的视频', run: ({ api }) => api.upOnly() },
      { key: 'dislike', icon: 'ban', text: '不感兴趣（从队列移除）', run: ({ api }) => api.dislike() },
      { key: 'copy', icon: 'link', text: '复制视频链接', run: ({ api }) => api.copy() },
    ];
  }

  /** 兜底：自己弹一个「和 B 站同款」的菜单 */
  let fallbackMenu = null;
  function closeFallbackMenu() {
    if (fallbackMenu) {
      fallbackMenu.remove();
      fallbackMenu = null;
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onDocKey, true);
    }
  }
  function onDocDown(e) {
    if (fallbackMenu && !fallbackMenu.contains(e.target)) closeFallbackMenu();
  }
  function onDocKey(e) {
    if (e.key === 'Escape') closeFallbackMenu();
  }

  /** 菜单项需要的动作接口（都由 Overlay 提供；视频流没开时它会给出提示） */
  function menuApi() {
    const overlay = BBDY.getOverlay ? BBDY.getOverlay() : null;
    return {
      // 注意要把 bvid 透传下去，否则「从菜单进入时先播当前视频」会失效
      openFeed: (bvid) =>
        BBDY.openFromUi ? BBDY.openFromUi(bvid || currentBvid()) : overlay && overlay.show({ seed: bvid || currentBvid() }),
      comments: (bvid) => overlay && overlay.commentsFor(bvid),
      upOnly: () => overlay && overlay.menuAction('uponly'),
      dislike: () => overlay && overlay.menuAction('dislike'),
      copy: () => overlay && overlay.menuAction('copy'),
      raw: overlay,
    };
  }

  function openFallbackMenu(anchor) {
    closeFallbackMenu();
    const box = document.createElement('div');
    box.className = 'bbdy-vmenu';
    box.setAttribute(MENU_MARK, 'own');

    const run = (item) => {
      closeFallbackMenu();
      try {
        item.run({ api: menuApi(), bvid: currentBvid() });
      } catch (err) {
        BBDY.warn('菜单项执行失败', item.key, err);
      }
    };

    for (const item of menuItems()) {
      const row = document.createElement('div');
      row.className = 'bbdy-vmenu-item';
      row.setAttribute('role', 'menuitem');
      row.tabIndex = 0;
      row.innerHTML =
        `<span class="bbdy-vmenu-icon">${BBDY.icon(item.icon)}</span>` +
        `<span class="bbdy-vmenu-text">${item.text}</span>` +
        (item.hint ? `<span class="bbdy-vmenu-hint">${item.hint}</span>` : '');
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        run(item);
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') run(item);
      });
      box.append(row);
    }

    // 贴着触发按钮放（跟 B 站一样在按钮下方）
    const rect = anchor?.getBoundingClientRect?.() || { left: 100, bottom: 100, top: 100 };
    box.style.position = 'fixed';
    box.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 220)) + 'px';
    box.style.top = Math.min(rect.bottom + 8, window.innerHeight - 260) + 'px';
    document.body.append(box);
    fallbackMenu = box;
    setTimeout(() => {
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('keydown', onDocKey, true);
    }, 0);
    return box;
  }

  /** 把 B 站的「更多」菜单收起来（它可能是 hover 触发，也可能是点击触发） */
  function closeNativeMenu() {
    const popover = pickSel(['.video-tool-more-popover']);
    if (!popover) return;
    // 鼠标移开让它自己收起；实在不行再改 display
    try {
      popover.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      popover.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    } catch (_) {}
    setTimeout(() => {
      const still = pickSel(['.video-tool-more-popover']);
      if (still && still.offsetParent !== null && !still.matches(':hover')) {
        // 兜底隐藏（只针对本次注入的那个容器，不动 B 站自己的 DOM 结构）
        still.style.display = 'none';
        setTimeout(() => {
          still.style.display = '';
        }, 400);
      }
    }, 60);
  }

  /**
   * 把我们的入口注入 B 站自己的「更多」菜单里。
   * 菜单是点开才渲染的，所以每次菜单出现都要检查一遍。
   */
  function injectNativeMenu() {
    const wrap = pickSel(NATIVE_MENU_WRAP);
    if (!wrap) return false;
    if (wrap.querySelector(`[${MENU_MARK}="native"]`)) return true; // 已经注入过

    const group = document.createElement('div');
    group.className = 'bbdy-vmenu-native';
    group.setAttribute(MENU_MARK, 'native');

    for (const item of menuItems()) {
      // 复用 B 站自己的 class，让间距/字号/hover 全部继承原生样式
      const row = document.createElement('div');
      row.className = 'dropdown-item bbdy-vmenu-item';
      row.innerHTML =
        `<span class="video-toolbar-item-icon bbdy-vmenu-icon">${BBDY.icon(item.icon)}</span>` +
        `<span class="bbdy-vmenu-text">${item.text}</span>`;
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 先让 B 站自己把菜单收起来（点一下它内部，触发外点关闭）
        try {
          document.body?.click?.();
        } catch (_) {}
        closeNativeMenu();
        try {
          item.run({ api: menuApi(), bvid: currentBvid() });
        } catch (err) {
          BBDY.warn('菜单项执行失败', item.key, err);
        }
      });
      group.append(row);
    }
    wrap.append(group);
    BBDY.log('已并入 B 站「更多」菜单');
    return true;
  }

  /** 找 B 站自己的「更多」按钮 */
  function findMoreButton() {
    // 互动栏里那些"不是点赞/投币/收藏/分享"的项，通常就是更多
    const cands = [
      ...document.querySelectorAll(
        '#arc_toolbar_report [class*="video-tool-more"], #arc_toolbar_report [class*="toolbar-left-item"]'
      ),
    ];
    for (const el of cands) {
      if (/more|ellipsis|argue|dot/i.test(el.className)) return el;
    }
    return cands[cands.length - 1] || null;
  }

  /**
   * 工具栏那颗按钮被点击时：
   *   1. 有 B 站原生「更多」菜单 → 点开它并把我们的项注入进去（最原生）
   *   2. 没有 → 弹一个和它同款的菜单
   */
  function onToolbarPillClick(e, pill) {
    e.preventDefault();
    e.stopPropagation();
    if (fallbackMenu) {
      closeFallbackMenu();
      return;
    }
    const nativeOpen = document.querySelector(`[${MENU_MARK}="native"]`);
    if (nativeOpen && nativeOpen.offsetParent !== null) {
      // 原生菜单已经开着（里面已经有我们的项），不动它
      return;
    }
    const more = findMoreButton();
    if (more && more !== pill) {
      more.click();
      BBDY.log('已点开 B 站原生「更多」菜单');
      // 菜单是异步渲染的；如果 320ms 后仍然没出现我们的项，就用自己的菜单兜底
      setTimeout(() => {
        if (!injectNativeMenu()) openFallbackMenu(pill);
      }, 320);
      return;
    }
    openFallbackMenu(pill);
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
        if (isVideoPage()) {
          placePill(PILL_TOOLBAR, TOOLBAR_ANCHORS);
          // 用户点开 B 站「更多」菜单时，菜单是刚渲染出来的，这里补注入
          injectNativeMenu();
        } else {
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

  BBDY.entry = {
    ensure,
    paintLauncher,
    watch,
    currentBvid,
    isVideoPage,
    buildPill,
    placePill,
    injectNativeMenu,
    openFallbackMenu,
    closeFallbackMenu,
    menuItems,
    MARK,
    MENU_MARK,
  };
})();
