/**
 * ui/sheets.js —— 底部抽屉 / 底部菜单 / 轻提示 等基础组件
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;
  const { el } = BBDY;

  /** 通用底部抽屉：返回 { root, body, header, close } */
  function sheet({ title, cls, onClose, headerExtra } = {}) {
    const body = el('div', { class: 'bbdy-sheet-body' });
    const head = el('div', { class: 'bbdy-sheet-hd' });
    if (title) head.append(el('span', { text: title }));
    if (headerExtra) head.append(headerExtra);
    const closeBtn = el('button', {
      class: 'bbdy-iconbtn',
      attrs: { type: 'button', title: '关闭 (Esc)' },
      html: BBDY.icon('close'),
      onclick: () => close(),
    });
    head.append(closeBtn);

    const box = el('div', { class: 'bbdy-sheet ' + (cls || '') });
    box.append(el('div', { class: 'bbdy-sheet-grip' }), head, body);

    const mask = el('div', {
      class: 'bbdy-sheet-mask',
      onclick: (e) => {
        if (e.target === mask) close();
      },
    });
    mask.append(box);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      mask.remove();
      onClose && onClose();
    }
    return { root: mask, body, head, close, isClosed: () => closed };
  }

  /** 可开关的设置行 */
  function switchRow(label, iconName, value, onToggle) {
    const row = el('div', {
      class: 'bbdy-row' + (value ? ' bbdy-on' : ''),
      onclick: (e) => {
        e.stopPropagation();
        const on = !row.classList.contains('bbdy-on');
        row.classList.toggle('bbdy-on', on);
        onToggle(on);
      },
    });
    row.append(
      el('span', { class: 'bbdy-icon', html: BBDY.icon(iconName) }),
      el('span', { text: label }),
      el('span', { class: 'bbdy-switch' })
    );
    return row;
  }

  /** 分段选择行 */
  function segRow(label, iconName, options, value, onPick) {
    const wrap = el('div', { class: 'bbdy-row bbdy-row-col' });
    const top = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });
    top.append(el('span', { class: 'bbdy-icon', html: BBDY.icon(iconName) }), el('span', { text: label }));
    const seg = el('div', { class: 'bbdy-seg' });
    const btns = new Map();
    for (const opt of options) {
      const b = el('button', {
        class: String(opt.value) === String(value) ? 'bbdy-on' : '',
        attrs: { type: 'button' },
        text: opt.label,
        onclick: (e) => {
          e.stopPropagation();
          for (const [v, node] of btns) node.classList.toggle('bbdy-on', String(v) === String(opt.value));
          onPick(opt.value);
        },
      });
      btns.set(opt.value, b);
      seg.append(b);
    }
    wrap.append(top, seg);
    return wrap;
  }

  /** 普通点击行 */
  function row(label, iconName, onClick, { sub, danger, cls } = {}) {
    const node = el('div', {
      class: 'bbdy-row' + (danger ? ' bbdy-danger' : '') + (cls ? ' ' + cls : ''),
      onclick: (e) => {
        e.stopPropagation();
        onClick && onClick(e);
      },
    });
    node.append(el('span', { class: 'bbdy-icon', html: BBDY.icon(iconName) }), el('span', { text: label }));
    if (sub) node.append(el('span', { class: 'bbdy-row-sub', text: sub }));
    return node;
  }

  /** 居中/底部轻提示，1.6s 自动消失 */
  function toast(host, text, { bottom = false, ms = 1600 } = {}) {
    const node = el('div', { class: 'bbdy-toast' + (bottom ? ' bbdy-toast-bottom' : ''), text });
    host.append(node);
    setTimeout(() => node.remove(), ms);
    return node;
  }

  BBDY.sheets = { sheet, switchRow, segRow, row, toast };
})();
