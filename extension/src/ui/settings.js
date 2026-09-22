/**
 * ui/settings.js —— 设置面板 + 长按「更多」菜单
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;
  const { el } = BBDY;

  const SOURCES = [
    { value: 'recommend', label: '推荐' },
    { value: 'popular', label: '热门' },
    { value: 'ranking', label: '排行榜' },
    { value: 'follow', label: '关注' },
  ];

  class SettingsPanel {
    /** @param {HTMLElement} host @param {{onChange:Function, onAction:Function, feed:Function}} opts */
    constructor(host, opts = {}) {
      this.host = host;
      this.onChange = opts.onChange || (() => {});
      this.onAction = opts.onAction || (() => {});
      this.feed = opts.feed || (() => null);
      this.ui = null;
    }

    get isOpen() {
      return !!this.ui;
    }

    close() {
      if (this.ui) this.ui.close();
      this.ui = null;
    }

    async open({ item, qualities } = {}) {
      this.close();
      const cfg = BBDY.config;
      const s = cfg.settings;
      this.ui = BBDY.sheets.sheet({ title: '设置', onClose: () => (this.ui = null) });
      const body = this.ui.body;

      const save = async (patch) => {
        await cfg.save(patch);
        this.onChange(patch);
      };

      // 内容来源
      body.append(
        BBDY.sheets.segRow('内容来源', 'fire', SOURCES, s.source, async (v) => {
          await save({ source: v });
          BBDY.sheets.toast(this.host, '已切换到「' + (SOURCES.find((x) => x.value === v)?.label || v) + '」', {
            bottom: true,
          });
        })
      );

      body.append(BBDY.sheets.switchRow('自动连播下一条', 'play', s.autoplay, (on) => save({ autoplay: on })));
      body.append(BBDY.sheets.switchRow('单条循环播放', 'refresh', s.loop, (on) => save({ loop: on })));
      body.append(BBDY.sheets.switchRow('静音启动', 'volumeOff', s.muteOnStart, (on) => save({ muteOnStart: on })));
      body.append(BBDY.sheets.switchRow('显示弹幕', 'danmaku', s.danmaku, (on) => save({ danmaku: on })));
      body.append(
        BBDY.sheets.segRow(
          '画面填充',
          'window',
          [
            { value: 'portrait', label: '竖屏裁切' },
            { value: 'cover', label: '铺满' },
            { value: 'fit', label: '完整显示' },
          ],
          s.screen,
          (v) => {
            save({ screen: v }).then(() => this.onChange({ screen: v }));
          }
        )
      );
      body.append(
        BBDY.sheets.segRow(
          '每次预取条数',
          'history',
          [
            { value: 6, label: '6' },
            { value: 12, label: '12' },
            { value: 20, label: '20' },
          ],
          s.pageSize,
          (v) => save({ pageSize: v })
        )
      );

      if (qualities?.length) {
        body.append(
          BBDY.sheets.segRow(
            '清晰度',
            'eye',
            [{ value: 0, label: '自动' }, ...qualities.map((q) => ({ value: q.qn, label: q.label }))],
            s.quality,
            (v) => save({ quality: v })
          )
        );
      }

      // 当前视频的快捷操作
      if (item) {
        body.append(el('div', { class: 'bbdy-sheet-hd', text: '当前视频' }));
        body.append(
          BBDY.sheets.row('复制视频链接', 'link', () => this.onAction('copy', item), {
            sub: item.bvid,
          })
        );
        body.append(BBDY.sheets.row('在 B 站打开原视频页', 'window', () => this.onAction('open', item)));
        body.append(
          BBDY.sheets.row('只看这个 UP 主', 'history', () => this.onAction('uponly', item), { sub: item.owner.name })
        );
        body.append(BBDY.sheets.row('不感兴趣（从队列移除）', 'ban', () => this.onAction('dislike', item)));
        body.append(
          BBDY.sheets.row('查看此 UP 的黑名单状态', 'eye', () => this.onAction('blockup', item), { sub: '点踩后不再推荐' })
        );
      }

      // 本地拉黑列表
      const blocked = BBDY.config.blockedList();
      body.append(el('div', { class: 'bbdy-sheet-hd', text: `本地屏蔽（${blocked.length}）` }));
      if (!blocked.length) {
        body.append(el('div', { class: 'bbdy-empty', text: '还没有屏蔽任何视频' }));
      } else {
        for (const bvid of blocked.slice(-20).reverse()) {
          const meta = BBDY.config.state.blocked[bvid] || {};
          body.append(
            BBDY.sheets.row(meta.title || bvid, 'ban', () => {
              BBDY.config.unblock(bvid);
              BBDY.sheets.toast(this.host, '已取消屏蔽', { bottom: true });
            }, { sub: bvid })
          );
        }
        body.append(
          BBDY.sheets.row('清空屏蔽列表', 'close', () => {
            BBDY.config.clearBlocked();
            BBDY.sheets.toast(this.host, '已清空', { bottom: true });
          }, { danger: true })
        );
      }

      body.append(el('div', { class: 'bbdy-sheet-hd', text: '其他' }));
      body.append(
        BBDY.sheets.row('恢复默认设置', 'refresh', async () => {
          await BBDY.config.reset();
          BBDY.sheets.toast(this.host, '已恢复默认设置', { bottom: true });
          this.close();
        })
      );
      body.append(
        BBDY.sheets.row('使用说明 / 快捷键', 'flag', () => this.onAction('help', null))
      );
    }
  }

  /** 长按视频弹出的「更多」菜单 */
  function moreMenu(host, item, { onPick } = {}) {
    const ui = BBDY.sheets.sheet({ title: item.title || '更多', onClose: () => {} });
    const pick = (key) => {
      ui.close();
      onPick && onPick(key, item);
    };
    ui.body.append(
      BBDY.sheets.row('不感兴趣', 'ban', () => pick('dislike')),
      BBDY.sheets.row('稍后再看', 'clock', () => pick('watchlater')),
      BBDY.sheets.row('倍速播放', 'speed', () => pick('speed'), { sub: '0.75x / 1x / 1.5x / 2x' }),
      BBDY.sheets.row('复制链接', 'link', () => pick('copy')),
      BBDY.sheets.row('在 B 站打开', 'window', () => pick('open')),
      BBDY.sheets.row('只看这个 UP 主', 'history', () => pick('uponly')),
      BBDY.sheets.row('举报', 'flag', () => pick('report'), { danger: true })
    );
    host.append(ui.root);
    return ui;
  }

  /** 倍速菜单 */
  function speedMenu(host, item, current, onPick) {
    const ui = BBDY.sheets.sheet({ title: '倍速播放' });
    for (const r of [0.75, 1, 1.25, 1.5, 2]) {
      ui.body.append(
        BBDY.sheets.row(r + 'x', current === r ? 'check' : 'speed', () => {
          ui.close();
          onPick(r);
        })
      );
    }
    host.append(ui.root);
    return ui;
  }

  /** 使用说明 */
  function helpSheet(host) {
    const ui = BBDY.sheets.sheet({ title: '使用说明 / 快捷键' });
    const add = (html) => ui.body.append(el('div', { class: 'bbdy-row bbdy-row-col', html }));
    add('<b>刷视频</b><br>上下滑动 / 鼠标滚轮 / ↑↓ 键切换视频，空格暂停，Esc 退出。');
    add('<b>单击 / 双击 / 长按</b><br>单击暂停或播放；双击点赞（会飘心）；长按弹出更多菜单。');
    add('<b>键盘快捷键</b><br>↑↓ / J K 上一个下一个　空格 播放暂停　L 点赞　C 评论　F 收藏<br>M 静音　S 设置　R 换一批　Esc 退出');
    add('<b>关于声音</b><br>受浏览器自动播放策略限制，视频默认静音开始；点一下画面或按 M 打开声音。');
    add('<b>在 B 站页面点开</b><br>右下角粉色悬浮按钮，或 Alt+Shift+B（可在 chrome://extensions/shortcuts 改键）。');
    add('<b>登录</b><br>用完整体验请先在 bilibili.com 登录，扩展开关直接复用你已登录的账号 Cookie。');
    host.append(ui.root);
    return ui;
  }

  BBDY.SettingsPanel = SettingsPanel;
  BBDY.moreMenu = moreMenu;
  BBDY.speedMenu = speedMenu;
  BBDY.helpSheet = helpSheet;
})();
