/* MakerVault web — shared UI helpers: DOM builder, modals, toasts, swatches,
   category icons, timestamps. */

const UI = (() => {

  // ---------- DOM builder ----------
  // h('div.card#main', {onclick: fn, dataset: {...}}, child, 'text', ...)
  function h(tag, ...args) {
    let attrs = {};
    if (args.length && args[0] !== null && typeof args[0] === 'object' && !(args[0] instanceof Node) && !Array.isArray(args[0])) {
      attrs = args.shift();
    }
    const [name, ...classes] = tag.split('.');
    const [tagName, id] = name.split('#');
    const el = document.createElement(tagName || 'div');
    if (id) el.id = id;
    classes.forEach((c) => {
      const [cls, cid] = c.split('#');
      if (cls) el.classList.add(cls);
      if (cid) el.id = cid;
    });
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v);
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v);
      } else if (k in el && k !== 'width' && k !== 'height' && k !== 'type') {
        el[k] = v;
      } else {
        el.setAttribute(k, v);
      }
    }
    const append = (child) => {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) { child.forEach(append); return; }
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    };
    args.forEach(append);
    return el;
  }

  // ---------- Toast ----------
  function toast(message, isError = false) {
    const root = document.getElementById('toast-root');
    const el = h('div.toast' + (isError ? '.error' : ''), message);
    root.append(el);
    setTimeout(() => el.remove(), isError ? 5000 : 2600);
  }

  // ---------- Modal ----------
  function syncScrollLock() {
    const root = document.getElementById('modal-root');
    document.documentElement.classList.toggle('modal-open', root.childElementCount > 0);
  }

  function modal({ title, body, footer, wide = false, onClose }) {
    const root = document.getElementById('modal-root');
    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      syncScrollLock();
      if (onClose) onClose();
    };
    // Escape closes only the topmost modal; Tab is trapped inside it so
    // keyboard focus can't wander into the page behind the backdrop
    const onKey = (e) => {
      if (root.lastElementChild !== backdrop) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      const focusables = [...box.querySelectorAll(
        'button, [href], input:not([type=hidden]), select, textarea'
      )].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!box.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const box = h('div.modal' + (wide ? '.wide' : ''),
      h('div.modal-header',
        h('h2', title),
        h('button.modal-close', { onclick: close, 'aria-label': 'Close' }, '✕')),
      h('div.modal-body', body),
      footer ? h('div.modal-footer', footer) : null,
    );
    // Close on backdrop click — but only when the press STARTED on the
    // backdrop. A text-selection drag that starts in an input and ends over
    // the backdrop fires a click with target === backdrop, which used to
    // silently discard the whole form.
    let pressOnBackdrop = false;
    const backdrop = h('div.modal-backdrop', {
      onpointerdown: (e) => { pressOnBackdrop = e.target === backdrop; },
      onclick: (e) => { if (e.target === backdrop && pressOnBackdrop) close(); },
    }, box);

    document.addEventListener('keydown', onKey);
    root.append(backdrop);
    syncScrollLock();

    // Focus the first control so keyboard/mobile entry starts immediately
    requestAnimationFrame(() => {
      const first = box.querySelector('.modal-body input:not([type=hidden]):not([type=file]), .modal-body select, .modal-body textarea');
      if (first) first.focus({ preventScroll: true });
    });
    return { close, box };
  }

  /** Close every open modal (used when navigating between views). */
  function closeAllModals() {
    const root = document.getElementById('modal-root');
    root.querySelectorAll(':scope > .modal-backdrop').forEach((b) => {
      const btn = b.querySelector('.modal-close');
      if (btn) btn.click(); else b.remove();
    });
    syncScrollLock();
  }

  function confirmDialog(title, message, confirmLabel = 'Delete') {
    return new Promise((resolve) => {
      const m = modal({
        title,
        body: h('p', { style: { margin: 0 } }, message),
        footer: [
          h('button.btn', { onclick: () => { m.close(); } }, 'Cancel'),
          // resolve BEFORE close: close() fires onClose synchronously, and
          // its resolve(false) would win the promise otherwise (which made
          // every confirmed action silently no-op)
          h('button.btn.danger', { onclick: () => { resolve(true); m.close(); } }, confirmLabel),
        ],
        onClose: () => resolve(false),
      });
    });
  }

  // ---------- Category helpers ----------
  // Map SF Symbol names (stored in the DB from the SwiftUI app) to emoji.
  const SF_ICON_MAP = {
    'circle.fill': '🧵',
    'wrench.and.screwdriver': '🔩',
    'gearshape.2': '⚙️',
    'engine.combustion': '🌀',
    'cable.connector': '🔌',
    'hammer': '🔨',
    'bag': '🛍️',
    'doc.plaintext': '📄',
    'bandage': '🩹',
    'printer': '🖨️',
    'screwdriver': '🪛',
    'wrench': '🧰',
    'paintpalette': '🎨',
    'shippingbox': '📦',
  };

  function categoryIcon(cat) {
    if (!cat) return '📦';
    return SF_ICON_MAP[cat.icon] || '📦';
  }

  // ---------- Filament swatch ----------
  // Replicates FilamentSwatchView color modes with CSS gradients.
  function swatch(filament, big = false) {
    const el = h('div.swatch' + (big ? '.big' : ''));
    if (!filament) { el.style.background = '#888'; return el; }
    const c1 = filament.color_hex || '#888888';
    const c2 = filament.color_hex2 || c1;
    const c3 = filament.color_hex3;
    const c4 = filament.color_hex4;
    switch (filament.color_mode) {
      case 'gradient':
        el.style.background = `linear-gradient(90deg, ${c1}, ${c2})`;
        break;
      case 'split': {
        const stops = [c1, c2, c3, c4].filter(Boolean);
        const pct = 100 / stops.length;
        const parts = stops.map((c, i) => `${c} ${i * pct}% ${(i + 1) * pct}%`);
        el.style.background = `linear-gradient(90deg, ${parts.join(', ')})`;
        break;
      }
      case 'sparkle':
        el.style.background = c1;
        el.style.backgroundImage =
          'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9) 0 6%, transparent 8%),' +
          'radial-gradient(circle at 70% 45%, rgba(255,255,255,0.8) 0 5%, transparent 7%),' +
          'radial-gradient(circle at 45% 75%, rgba(255,255,255,0.85) 0 5%, transparent 7%)';
        break;
      case 'silk':
        el.style.background = `linear-gradient(135deg, ${c1} 20%, rgba(255,255,255,0.65) 50%, ${c1} 80%)`;
        break;
      default:
        el.style.background = c1;
    }
    return el;
  }

  // Plain color dot for non-filament items with a color_hex set.
  function colorDot(hex) {
    const el = h('div.swatch');
    el.style.background = hex;
    return el;
  }

  // ---------- Timestamps ----------
  // Handles both ISO 8601 and SQLite "YYYY-MM-DD HH:MM:SS" (UTC) formats,
  // like relativeTimestamp() in PlatformHelpers.swift did.
  function parseTimestamp(ts) {
    if (!ts) return null;
    let s = ts;
    if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
    if (!/Z|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function relativeTime(ts) {
    const d = parseTimestamp(ts);
    if (!d) return '';
    const secs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    if (secs < 86400 * 7) return `${Math.floor(secs / 86400)}d ago`;
    return d.toLocaleDateString();
  }

  // ---------- Activity labels ----------
  const ACTION_META = {
    added:            { label: 'Added',      color: 'var(--green)' },
    edited:           { label: 'Edited',     color: 'var(--blue)' },
    updated:          { label: 'Updated',    color: 'var(--blue)' },
    moved:            { label: 'Moved',      color: 'var(--purple)' },
    deleted:          { label: 'Deleted',    color: 'var(--red)' },
    imported:         { label: 'Imported',   color: 'var(--green)' },
    merged:           { label: 'Merged',     color: 'var(--purple)' },
    skipped:          { label: 'Skipped',    color: 'var(--text-faint)' },
    checkedOut:       { label: 'Checked out', color: 'var(--orange)' },
    checkedIn:        { label: 'Checked in', color: 'var(--green)' },
    quantityChanged:  { label: 'Quantity',   color: 'var(--orange)' },
    quantity_updated: { label: 'Quantity',   color: 'var(--orange)' },
  };
  function actionMeta(action) {
    return ACTION_META[action] || { label: action, color: 'var(--text-dim)' };
  }

  // ---------- Misc ----------
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function money(v) {
    if (v === null || v === undefined) return '';
    return '$' + Number(v).toFixed(2);
  }

  function stockBadge(item) {
    if (item.quantity === 0) return h('span.badge.out', 'Out of stock');
    if (item.min_quantity !== null && item.quantity <= item.min_quantity) {
      return h('span.badge.low', 'Low stock');
    }
    return null;
  }

  return {
    h, toast, modal, confirmDialog, closeAllModals, categoryIcon, swatch, colorDot,
    relativeTime, parseTimestamp, actionMeta, debounce, money, stockBadge,
  };
})();
