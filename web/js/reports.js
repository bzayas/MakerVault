/* Reports view — inventory value & spending analytics (ports the native
 * app's reports.py). Charts are dependency-free: an inline SVG column chart
 * for monthly spending (theme-aware via CSS variables) and HTML bar rows
 * for category/vendor value. Identity is always carried by text labels —
 * bar color is reinforcement only. */

window.Views = window.Views || {};

Views.reports = (() => {
  const { h } = UI;
  const svgNS = 'http://www.w3.org/2000/svg';

  const s = (tag, attrs = {}, ...children) => {
    const el = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    children.forEach((c) => el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return el;
  };

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return `${MONTH_NAMES[m - 1]}${m === 1 ? ' ’' + String(y).slice(2) : ''}`;
  };

  // Column chart: single series (accent hue), 4px rounded tops anchored to
  // the baseline, 2px gaps, recessive gridlines, selective direct labels
  // (max + latest), native tooltips on every column.
  function monthlyChart(months) {
    const W = 720, H = 230;
    const pad = { top: 26, right: 10, bottom: 26, left: 10 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const max = Math.max(...months.map((m) => m.total), 1);
    const maxIdx = months.findIndex((m) => m.total === Math.max(...months.map((x) => x.total)));

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'report-chart', role: 'img',
      'aria-label': 'Monthly spending, last 12 months' });

    // Recessive gridlines at 1/3, 2/3, 3/3 of the max
    for (let g = 1; g <= 3; g++) {
      const y = pad.top + plotH - (plotH * g) / 3;
      svg.appendChild(s('line', { x1: pad.left, x2: W - pad.right, y1: y, y2: y, class: 'chart-grid' }));
    }
    svg.appendChild(s('line', { x1: pad.left, x2: W - pad.right,
      y1: pad.top + plotH, y2: pad.top + plotH, class: 'chart-axis' }));

    const n = months.length;
    const gap = 8;
    const barW = Math.min(44, (plotW - gap * (n - 1)) / n);
    const step = (plotW - barW * n - gap * (n - 1)) / 2;

    months.forEach((m, i) => {
      const x = pad.left + step + i * (barW + gap);
      const hgt = Math.max(2, (m.total / max) * plotH);
      const y = pad.top + plotH - hgt;
      const r = Math.min(4, barW / 2, hgt);
      // Rounded top corners only, flat baseline
      const d = `M${x},${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} `
        + `Q${x + barW},${y} ${x + barW},${y + r} V${pad.top + plotH} H${x} Z`;
      const bar = s('path', { d, class: 'chart-bar' });
      bar.appendChild(s('title', {},
        `${m.month}: ${UI.money(m.total)} across ${m.count} item(s)`));
      svg.appendChild(bar);

      // Month label under every column
      svg.appendChild(s('text', { x: x + barW / 2, y: H - 8,
        class: 'chart-label', 'text-anchor': 'middle' }, monthLabel(m.month)));
      // Direct value labels: the peak month and the latest month only
      if (i === maxIdx || i === n - 1) {
        svg.appendChild(s('text', { x: x + barW / 2, y: y - 7,
          class: 'chart-value', 'text-anchor': 'middle' }, UI.money(m.total)));
      }
    });
    return svg;
  }

  // Horizontal value bars: label + track + value. `color` reinforces an
  // identity the label already establishes.
  function barRows(rows, getLabel, getColor) {
    const max = Math.max(...rows.map((r) => r.value), 1);
    return rows.map((r) => h('div.report-bar-row',
      h('div.report-bar-label', getLabel(r)),
      h('div.report-bar-track',
        h('div.report-bar-fill', { style: {
          width: `${Math.max(1, (r.value / max) * 100)}%`,
          background: getColor ? getColor(r) : 'var(--accent)',
        } })),
      h('div.report-bar-value', UI.money(r.value)),
    ));
  }

  async function render(main) {
    main.replaceChildren(h('div.spinner'));
    let r;
    try {
      r = await API.reports();
    } catch (err) {
      main.replaceChildren(h('div.empty-state', h('div.big', '⚠️'), `Could not load reports: ${err.message}`));
      return;
    }

    const stat = (value, label, cls) =>
      h(`div.card.stat-card${cls ? '.' + cls : ''}`,
        h('div.stat-value', value),
        h('div.stat-label', label));

    const catByKey = Object.fromEntries(App.state.categories.map((c) => [c.key, c]));
    const catRows = r.by_category.map((row) => ({ ...row,
      cat: catByKey[row.category] || { display_name: row.category, color: '#8E8E93' } }));

    main.replaceChildren(
      h('div.page-header',
        h('div', h('h1', 'Reports'),
          h('div.page-sub', 'Inventory value and spending over time'))),

      h('div.stat-grid',
        stat(UI.money(r.total_value), 'Inventory value'),
        stat(String(r.priced_items), `Priced items (of ${r.total_items})`),
        stat(String(r.missing_price_count), 'Missing a price', r.missing_price_count ? 'warn' : ''),
      ),

      h('h3.section-title', 'Monthly Spending'),
      h('div.card',
        r.monthly.length
          ? monthlyChart(r.monthly)
          : h('div.empty-state', 'No dated purchases yet')),

      h('div.dash-columns',
        h('div',
          h('h3.section-title', 'Value by Category'),
          h('div.card', catRows.length
            ? barRows(catRows,
                (row) => h('span', `${UI.categoryIcon(row.cat)} ${row.cat.display_name} `,
                  h('span.desc', `(${row.count})`)),
                (row) => row.cat.color || 'var(--accent)')
            : h('div.empty-state', 'No priced items'))),
        h('div',
          h('h3.section-title', 'Value by Vendor'),
          h('div.card', r.by_vendor.length
            ? barRows(r.by_vendor.slice(0, 10),
                (row) => h('span', `${row.vendor} `, h('span.desc', `(${row.count})`)))
            : h('div.empty-state', 'No vendors recorded')),
          h('h3.section-title', { style: { marginTop: '20px' } }, 'Recent Purchase Days'),
          h('div.card', r.recent_purchases.length
            ? r.recent_purchases.map((p) => h('div.activity-row',
                h('span.activity-action', p.date),
                h('span.activity-details', `${p.count} item(s)`),
                h('span.activity-time', UI.money(p.total))))
            : h('div.empty-state', 'No purchases recorded'))),
      ),
    );
  }

  return { render };
})();
