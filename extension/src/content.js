/**
 * content.js —— 内容脚本入口
 *
 * 负责：设置引导、开关消息通道、快捷键，以及把「界面入口的注入」交给 entry.js。
 * 三个入口位置（顶栏药丸 / 视频页互动栏按钮 / 悬浮兜底）都在 entry.js 里维护。
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;

  /** 防止同页面被注入两次 */
  if (window.__BBDY_CONTENT_LOADED__) return;
  window.__BBDY_CONTENT_LOADED__ = true;

  let overlay = null;
  const getOverlay = () => overlay || (overlay = new BBDY.Overlay());

  /**
   * 开关视频流
   * @param {boolean} [force] true 打开 / false 关闭 / undefined 切换
   * @param {{seed?:string}} [opts] seed：要优先播放的 BV 号（从视频页进入时带上当前视频）
   */
  async function toggle(force, opts = {}) {
    const o = getOverlay();
    const want = force === undefined ? !o.visible : force;
    if (want) await o.show(opts);
    else o.hide();
    BBDY.entry.paintLauncher();
    return o.visible;
  }

  /** 界面上任何入口点击后都走这里：记下用户意图 + 带上当前视频 */
  function openFromUi(bvid) {
    BBDY.userInvoked = true;
    const seed = bvid || BBDY.entry.currentBvid();
    return toggle(true, { seed });
  }

  /* ------------------------------ 消息通道 ------------------------------ */
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'BB_TOGGLE') {
        const force = msg.open === undefined ? undefined : msg.open;
        toggle(force, { seed: BBDY.entry.currentBvid() }).then((visible) =>
          sendResponse({ ok: true, visible })
        );
        return true;
      }
      if (msg.type === 'BB_ACTION') {
        interact(msg.action, msg.bvid).then((res) => sendResponse(res));
        return true;
      }
      if (msg.type === 'BB_STATE') {
        sendResponse({
          ok: true,
          visible: !!(overlay && overlay.visible),
          version: BBDY.version,
          bvid: (overlay && overlay.visible && overlay.item?.bvid) || BBDY.entry.currentBvid() || '',
          entry: {
            nav: !!document.querySelector(`[${BBDY.entry.MARK}="nav"]`),
            toolbar: !!document.querySelector(`[${BBDY.entry.MARK}="toolbar"]`),
            floating: !!document.querySelector('.bbdy-launcher'),
          },
        });
        return true;
      }
      sendResponse({ ok: false, unknown: msg.type });
      return false;
    });
  }

  /* ------------------------------ 互动（弹窗调用） ------------------------------ */
  /**
   * 统一互动入口，供工具栏弹窗调用。
   * 弹窗自己拿不到 csrf cookie，也没有 aid（评论接口要 oid=aid），所以统一交给内容脚本来做。
   * @param {'like'|'coin'|'fav'|'comment'|'state'} action
   * @param {string} bvid
   */
  async function interact(action, bvid) {
    const o = getOverlay();
    if (!bvid) return { ok: false, hint: '当前页面上找不到视频' };
    const needLogin = () => {
      if (BBDY.api.isLogin()) return false;
      BBDY.api.openLogin();
      return true;
    };
    const snapshot = (item, patch = {}) => {
      const st = BBDY.config.setInteract(item.bvid, patch);
      return {
        bvid: item.bvid,
        title: item.title,
        up: item.owner?.name || '',
        pic: item.pic || '',
        stat: item.stat || {},
        interact: st,
      };
    };
    /** 互动后同步覆盖层上的按钮状态，避免两处显示不一致 */
    const syncOverlay = (item) => {
      if (o.visible && o.item?.bvid === item.bvid) {
        o.actionbar.setItem(o.item, o._interactState(o.item));
      }
    };

    try {
      const item = (o.visible && o.item) || (await BBDY.api.view(bvid));
      if (!item) return { ok: false, hint: '读取视频信息失败' };
      const saved = BBDY.config.getInteract(bvid);

      switch (action) {
        case 'state':
          return { ok: true, state: snapshot(item) };

        case 'like': {
          if (needLogin()) return { ok: false, hint: '请先登录 B 站账号' };
          const cur = saved.like === undefined ? !!item.reqUser?.like : !!saved.like;
          const on = !cur;
          const r = await BBDY.api.like({ bvid, on });
          if (!r.ok) return { ok: false, hint: `点赞失败：${r.message || r.code}` };
          const state = snapshot(item, { like: on });
          syncOverlay(item);
          return { ok: true, hint: on ? '已点赞' : '已取消点赞', state };
        }

        case 'fav': {
          if (needLogin()) return { ok: false, hint: '请先登录 B 站账号' };
          const nav = await BBDY.api.nav();
          const folders = await BBDY.api.favFolders(nav.mid);
          if (!folders.length) return { ok: false, hint: '没找到你的收藏夹' };
          const folder = folders[0];
          const on = !saved.fav;
          const r = await BBDY.api.fav({ bvid, on, addIds: folder.id, delIds: folder.id });
          if (!r.ok) return { ok: false, hint: `收藏失败：${r.message || r.code}` };
          const state = snapshot(item, { fav: on });
          syncOverlay(item);
          return { ok: true, hint: on ? `已收藏到「${folder.title}」` : '已取消收藏', state };
        }

        case 'coin': {
          if (needLogin()) return { ok: false, hint: '请先登录 B 站账号' };
          if (saved.coin) return { ok: false, hint: '已经投过币了（B 站不支持撤币）' };
          const r = await BBDY.api.coin({ bvid, count: 2 });
          if (!r.ok) return { ok: false, hint: `投币失败：${r.message || r.code}` };
          const state = snapshot(item, { coin: true, coinCount: 2 });
          state.stat = { ...state.stat, coin: (Number(state.stat.coin) || 0) + 2 };
          syncOverlay(item);
          return { ok: true, hint: '已投 2 币，感谢 UP 主', state };
        }

        case 'comment': {
          const url = `https://www.bilibili.com/video/${bvid}`;
          let copied = false;
          try {
            await navigator.clipboard.writeText(url);
            copied = true;
          } catch (_) {}
          BBDY.api.share(bvid);
          const opened = await o.openCommentsFor(item);
          if (!opened) window.open(url, '_blank', 'noopener');
          return { ok: true, hint: opened ? '已打开评论' : copied ? '链接已复制，去粘贴打开' : url };
        }

        default:
          return { ok: false, hint: '未知操作：' + action };
      }
    } catch (e) {
      BBDY.warn('interact 失败', action, e);
      return { ok: false, hint: String(e?.message || e) };
    }
  }

  /* --------------------------- 地址栏 / 快捷键 --------------------------- */
  function wantsAutoOpen() {
    try {
      const q = new URLSearchParams(location.search);
      return q.get('bbdy') === '1' || location.hash === '#bbdy';
    } catch (_) {
      return false;
    }
  }

  window.addEventListener(
    'keydown',
    (e) => {
      const t = e.target;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (typing) return;
      // Alt+Shift+B：扩展快捷键没生效时的兜底
      if (e.altKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault();
        openFromUi();
        return;
      }
      // 反斜杠键
      if (e.key === '\\' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        openFromUi();
      }
    },
    true
  );

  /* ------------------------------ 启动 ------------------------------ */
  BBDY.toggleOverlay = toggle;
  BBDY.openFromUi = openFromUi;
  BBDY.getOverlay = getOverlay;
  BBDY.interact = interact;

  /* ------------------------------ 自检 ------------------------------ */
  /**
   * 在 B 站页面控制台里执行 BBDY.diag()，会打印一份状态体检表。
   * 排障时先看这个，能直接看出「入口插上了没 / 原页面被藏了没 / 覆盖层还在不在」。
   */
  BBDY.diag = function diag() {
    const pill = (kind) => document.querySelector(`[${BBDY.entry.MARK}="${kind}"]`);
    const nav = pill('nav');
    const toolbar = pill('toolbar');
    const floating = document.querySelector('.bbdy-launcher');
    const root = document.querySelector('.bbdy-root');
    const o = getOverlay();
    const rows = {
      版本: BBDY.version,
      运行环境: BBDY.runtime,
      入口位置设置: BBDY.config.settings.entryMode,
      顶栏药丸: nav ? (nav.isConnected ? '已插入并在线' : '节点已脱离文档（会被自动重插）') : '未插入',
      视频页入口: toolbar ? '已插入' : BBDY.entry.isVideoPage() ? '未插入（本页是视频页，应该插上）' : '不适用（非视频页）',
      悬浮兜底: floating ? '显示中' : '未显示',
      视频流覆盖层: root ? '在页面上' : '未挂载',
      覆盖层可视: o.visible ? '是' : '否',
      播放引擎: o.item ? (o._slot(0)?.player?.engine || '还没开始加载') : '还没有视频',
      当前视频: o.item ? `${o.item.bvid} ${String(o.item.title).slice(0, 24)}` : '无',
      'html.bbdy-active': document.documentElement.classList.contains('bbdy-active') ? '有（会隐藏原页面）' : '无',
      页面骨架: {
        顶栏入口栏: !!document.querySelector('.right-entry__main, .right-entry'),
        顶栏头像: !!document.querySelector('.header-avatar-wrap, .header-avatar, .header-avatar-unlogin-entry'),
        视频互动栏: !!document.querySelector('#arc_toolbar_report, .video-toolbar-left-main'),
      },
      快捷键: 'Alt+Shift+B / \\',
    };
    try {
      console.table(rows);
    } catch (_) {
      console.log(rows);
    }
    return rows;
  };

  BBDY.config.load().then(() => {
    BBDY.entry.watch();
    BBDY.entry.ensure();
    BBDY.config.on('settings', () => BBDY.entry.ensure());
    if (wantsAutoOpen()) setTimeout(() => toggle(true, { seed: BBDY.entry.currentBvid() }), 300);
    BBDY.log('content script ready v' + BBDY.version);
  });
})();
