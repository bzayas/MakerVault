/* Dashboard view — stats, category breakdown, filament overview, recent activity. */

window.Views = window.Views || {};

Views.dashboard = {
  async render(main) {
    const { h } = UI;
    main.replaceChildren(h('div.spinner'));

    let data;
    try {
      data = await API.dashboard();
    } catch (err) {
      main.replaceChildren(h('div.empty-state', h('div.big', '⚠️'), `Could not load dashboard: ${err.message}`));
      return;
    }

    const stat = (value, label, cls, onclick) =>
      h(`div.card.stat-card${cls ? '.' + cls : ''}`, { onclick },
        h('div.stat-value', value),
        h('div.stat-label', label));

    const stats = h('div.stat-grid',
      stat(data.total_items, 'Total items', '', () => location.hash = '#/inventory'),
      stat(data.low_stock_count, 'Low stock', data.low_stock_count ? 'warn' : '',
        () => location.hash = '#/inventory?status=lowStock'),
      stat(data.out_of_stock_count, 'Out of stock', data.out_of_stock_count ? 'bad' : '',
        () => location.hash = '#/inventory?status=outOfStock'),
      stat(data.filaments_loaded, 'Filaments loaded', 'good',
        () => location.hash = '#/inventory?category=filament'),
      stat(UI.money(data.total_value), 'Inventory value', '', () => location.hash = '#/inventory'),
    );

    // Category breakdown
    const catRows = App.state.categories
      .filter((c) => data.category_counts[c.key])
      .map((c) => h('div.cat-row', { onclick: () => location.hash = `#/inventory?category=${c.key}` },
        h('div.cat-icon', { style: { background: hexSoft(c.color) } }, UI.categoryIcon(c)),
        h('span.cat-name', c.display_name),
        h('span.cat-count', String(data.category_counts[c.key])),
      ));

    // Loaded filaments
    const filamentRows = (data.loaded_filaments || []).map((f) =>
      h('div.filament-row',
        UI.swatch(f),
        h('div.f-name',
          h('div', f.name),
          h('div.f-material', `${f.material}${f.remaining_weight ? ` · ${Math.round(f.remaining_weight)}g left` : ''}`)),
        h('span.badge.ok', f.status === 'loadedInAMS' ? 'AMS' : 'External'),
      ));

    // Recent activity
    const activityRows = (data.recent_activity || []).map((a) => {
      const meta = UI.actionMeta(a.action);
      return h('div.activity-row',
        h('span.activity-action', { style: { color: meta.color } }, meta.label),
        h('span.activity-details', a.details || a.item_name || ''),
        h('span.activity-time', UI.relativeTime(a.timestamp)),
      );
    });

    main.replaceChildren(
      h('div.page-header',
        h('div', h('h1', 'Dashboard'), h('div.page-sub', 'Workshop inventory at a glance')),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('a.btn', { href: '#/reports' }, '📈 Reports'),
          h('button.btn.primary', { onclick: () => Views.inventory.openAddItem() }, '＋ Add Item')),
      ),
      stats,
      h('div.dash-columns',
        h('div',
          h('div.card',
            h('h3.section-title', 'By Category'),
            catRows.length ? h('div.cat-grid', catRows) : h('div.empty-state', 'No items yet')),
        ),
        h('div',
          data.filaments_loaded ? h('div.card', { style: { marginBottom: '16px' } },
            h('h3.section-title', 'Loaded Filament'),
            filamentRows) : null,
          h('div.card',
            h('h3.section-title', 'Recent Activity'),
            activityRows.length ? activityRows : h('div.empty-state', 'No activity yet'),
            h('div', { style: { textAlign: 'center', marginTop: '10px' } },
              h('a', { href: '#/activity' }, 'View all activity →'))),
        ),
      ),
    );

    function hexSoft(hex) {
      return hex ? hex + '2b' : 'var(--bg-inset)';
    }
  },
};
