/**
 * icons.js —— 内联 SVG 图标集（不依赖任何外部资源/字体）
 */
(function () {
  'use strict';
  const BBDY = globalThis.BBDY;

  const svg = (inner, viewBox) =>
    `<svg viewBox="${viewBox || '0 0 24 24'}" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">${inner}</svg>`;

  const F = (d) => svg(`<path d="${d}" fill="currentColor"/>`);
  const S = (d, w) =>
    svg(
      `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w || 1.9}" stroke-linecap="round" stroke-linejoin="round"/>`
    );

  const icons = {
    heart: F(
      'M12 21s-7.6-4.9-9.4-9.2C1.1 8 3 4.6 6.4 4.1c2-.3 3.9.6 5 2.2 1.1-1.6 3-2.5 5-2.2 3.4.5 5.3 3.9 3.8 7.7C19.6 16.1 12 21 12 21z'
    ),
    heartOutline: S(
      'M12 20.3C9.6 18.7 4.4 15.1 3.2 11.9 1.9 8.5 3.6 5.9 6.4 5.4c1.9-.3 3.7.6 4.7 2.1l.9 1.4.9-1.4c1-1.5 2.8-2.4 4.7-2.1 2.8.5 4.5 3.1 3.2 6.5-1.2 3.2-6.4 6.8-8.8 8.4z',
      1.8
    ),
    coin: svg(
      `<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8.2 14.9 10v4L12 15.8 9.1 14v-4z" fill="currentColor"/>`
    ),
    star: F(
      'M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.75L6.8 19.65l1-5.8-4.2-4.1 5.8-.85z'
    ),
    starOutline: S(
      'M12 4.6l2.2 4.5 5 .75-3.6 3.5.85 5-4.45-2.35L7.55 18.3l.85-5-3.6-3.5 5-.75z',
      1.8
    ),
    comment: F(
      'M4 3.5h16c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2h-8.2l-4.6 3.6c-.6.5-1.2.1-1.2-.6v-3H4c-1.1 0-2-.9-2-2v-10c0-1.1.9-2 2-2z'
    ),
    share: F(
      'M14 3.2v3.3C7.9 7.2 4.3 11 3.4 17.6c-.1.7.8 1.1 1.2.5 1.9-2.9 4.7-4.3 9.4-4.3v3.4c0 .6.7.9 1.2.5l7.3-6.3c.4-.3.4-.9 0-1.2l-7.3-6.4c-.5-.4-1.2 0-1.2.5z'
    ),
    music: svg(
      `<path d="M9.5 18.2V6.6l9-2v11.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7.2" cy="18.4" r="2.6" fill="currentColor"/><circle cx="16.2" cy="16" r="2.6" fill="currentColor"/>`
    ),
    play: F('M7.5 4.8 19 11.4c.6.35.6 1.25 0 1.6L7.5 19.6c-.6.35-1.4-.1-1.4-.8V5.6c0-.7.8-1.15 1.4-.8z'),
    pause: svg(
      `<rect x="6" y="4.5" width="4" height="15" rx="1.4" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1.4" fill="currentColor"/>`
    ),
    volume: F(
      'M11 4.6 6.7 8.2H3.4c-.6 0-1 .4-1 1v5.6c0 .6.4 1 1 1h3.3l4.3 3.6c.6.5 1.5.1 1.5-.7V5.3c0-.8-.9-1.2-1.5-.7zM15.6 8.4c1 .9 1.6 2.2 1.6 3.6s-.6 2.7-1.6 3.6M18.4 5.6c1.6 1.5 2.6 3.6 2.6 6.4s-1 4.9-2.6 6.4'
    ),
    volumeOff: F(
      'M11 4.6 6.7 8.2H3.4c-.6 0-1 .4-1 1v5.6c0 .6.4 1 1 1h3.3l4.3 3.6c.6.5 1.5.1 1.5-.7V5.3c0-.8-.9-1.2-1.5-.7zM16 9.5l5 5M21 9.5l-5 5'
    ),
    more: svg(
      `<circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/>`
    ),
    plus: F('M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z'),
    check: S('M4.5 12.5l5 5 10-11', 2.4),
    close: S('M6 6l12 12M18 6L6 18', 2.2),
    chevronUp: S('M5 14.5 12 7.5l7 7', 2.2),
    chevronDown: S('M5 9.5 12 16.5l7-7', 2.2),
    settings: svg(
      `<path d="M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.3 13.4a7.6 7.6 0 0 0 0-2.8l2-1.5-2-3.4-2.3 1a7.7 7.7 0 0 0-2.4-1.4L14.3 3h-4l-.3 2.3c-.9.3-1.7.8-2.4 1.4l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2.8l-2 1.5 2 3.4 2.3-1c.7.6 1.5 1.1 2.4 1.4l.3 2.3h4l.3-2.3c.9-.3 1.7-.8 2.4-1.4l2.3 1 2-3.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`
    ),
    refresh: S('M20 11.5A8 8 0 1 0 18.4 17M20 5.5v6h-6', 2),
    ban: svg(
      `<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.2 17.8 17.8 6.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`
    ),
    link: S('M9.5 14.5 14.5 9.5M11 6.5l1.4-1.4a4 4 0 0 1 5.6 5.6L16.6 12M12.4 17.5 11 18.9a4 4 0 0 1-5.6-5.6L6.8 11.9', 1.9),
    window: S('M4 5.5h16v13H4zM4 9.5h16', 1.8),
    history: S('M12 7.5V12l3 2M20 12a8 8 0 1 1-2.6-5.9M20 4.5v5h-5', 1.9),
    flag: S('M6 21V4h11l-1.6 3.5L17 11H6', 1.9),
    eye: svg(
      `<path d="M2.6 12S6 6.2 12 6.2 21.4 12 21.4 12 18 17.8 12 17.8 2.6 12 2.6 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>`
    ),
    clock: svg(
      `<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.6V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`
    ),
    speed: S('M12 12l4-4M4.5 18a9 9 0 1 1 15 0', 1.9),
    danmaku: svg(
      `<rect x="2.5" y="5" width="19" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.5 9.5h6M6.5 13h4M14.5 13h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`
    ),
    follow: F('M12 4.5c-.5 0-1 .5-1 1v5.5H5.5c-.6 0-1 .5-1 1s.4 1 1 1H11v5.5c0 .6.5 1 1 1s1-.4 1-1V13h5.5c.6 0 1-.5 1-1s-.4-1-1-1H13V5.5c0-.5-.5-1-1-1z'),
    fire: F(
      'M13.5 2.4c.3 2.2-.6 3.4-1.9 4.7-1.4 1.4-3 3-3 5.7a5.9 5.9 0 0 0 11.8.2c0-4.6-4.4-6-6.9-10.6zM9.4 12.3c-1.1.9-1.8 2-1.8 3.5a4.4 4.4 0 0 0 2.2 3.9 4.6 4.6 0 0 1-.8-2.6c0-1.7.7-3 1.6-4.1z'
    ),
  };

  icons.get = (name) => icons[name] || '';
  BBDY.icons = icons;
  BBDY.icon = (name, cls) =>
    `<span class="bbdy-icon ${cls || ''}" data-icon="${name}">${icons.get(name)}</span>`;
})();
