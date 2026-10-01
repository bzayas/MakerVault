/* Duplicate Finder view — scans the inventory for likely duplicate groups,
   lets you pick which item to keep and merges the rest into it. */

window.Views = window.Views || {};

Views.duplicates = (() => {
  const { h } = UI;

  const CONF_BADGE = {
    high: ['badge out', 'High'],
    medium: ['badge low', 'Medium'],
    low: ['badge ok', 'Low'],
  };

  let listEl = null;

  async function render(main) {
    listEl = h('div', h('div.spinner'));
    main.replaceChildren(
      h('div.page-header',
        h('div', h('h1', 'Duplicate Finder'),
          h('div.page-sub', 'Fuzzy-matched duplicate groups — merge to combine quantities')),
        h('button.btn', { onclick: refresh }, '↻ Rescan')),
      listEl,
    );
    await refresh();
  }

  async function refresh() {
    listEl.replaceChildren(h('div.spinner'));
    try {
      const res = await API.findDuplicates();
      // Older server shape was a bare array; new is {groups, hidden_pairs}
      const groups = Array.isArray(res) ? res : res.groups;
      const hidden = Array.isArray(res) ? 0 : res.hidden_pairs;
      const hiddenBar = hidden
        ? h('div', { style: { fontSize: '13px', color: 'var(--text-dim)', marginBottom: '12px' } },
            `🙈 ${hidden} pair${hidden === 1 ? '' : 's'} hidden as "not duplicates" — `,
            h('a', { href: '#', onclick: async (e) => {
              e.preventDefault();
              try {
                await API.restoreDismissedDuplicates();
                UI.toast('Hidden pairs restored');
                refresh();
              } catch (err) { UI.toast(err.message, true); }
            } }, 'restore them'))
        : null;
      if (!groups.length) {
        listEl.replaceChildren(hiddenBar,
          h('div.empty-state', h('div.big', '✨'), 'No duplicates found'));
        return;
      }
      listEl.replaceChildren(hiddenBar, ...groups.map(groupCard));
    } catch (err) {
      listEl.replaceChildren(h('div.empty-state', '⚠️ ' + err.message));
    }
  }

  function groupCard(group) {
    let keepId = group.items[0].id;
    const [badgeCls, badgeLabel] = CONF_BADGE[group.confidence] || CONF_BADGE.low;

    const rows = group.items.map((item) => {
      const radio = h('input', {
        type: 'radio', name: `keep-${group.items[0].id}`,
        checked: item.id === keepId,
        onchange: () => { keepId = item.id; },
      });
      return h('div.item-row', { onclick: () => radio.click() },
        radio,
        h('div.item-main',
          h('div.item-name', item.name),
          h('div.item-sub', [
            item.brand, item.sku,
            App.locationName(item.location_id),
            `added ${UI.relativeTime(item.created_at)}`,
          ].filter(Boolean).join(' · '))),
        h('div.qty-value', String(item.quantity), h('span.unit', item.unit)),
      );
    });

    const card = h('div.card', { style: { marginBottom: '14px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' } },
        h('strong', group.name),
        h('span', { className: badgeCls }, badgeLabel),
        h('span.desc', { style: { fontSize: '12px', color: 'var(--text-faint)' } },
          (group.reasons || []).join(' · '))),
      h('div', { style: { fontSize: '12px', color: 'var(--text-dim)', marginBottom: '8px' } },
        'Select the item to KEEP — the others merge into it (quantities added):'),
      h('div.item-list', rows),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' } },
        h('button.btn', {
          title: 'Hide this group — these are different items, never show them again',
          onclick: async () => {
            try {
              await API.dismissDuplicates(group.items.map((i) => i.id));
              UI.toast('Hidden — this group won’t be flagged again');
              card.remove();
            } catch (err) {
              UI.toast(err.message, true);
            }
          },
        }, '🙈 Not duplicates'),
        h('button.btn.danger', {
          onclick: async () => {
            const mergeIds = group.items.map((i) => i.id).filter((id) => id !== keepId);
            const keepName = group.items.find((i) => i.id === keepId).name;
            const ok = await UI.confirmDialog('Merge items',
              `Merge ${mergeIds.length} item(s) into "${keepName}"? Quantities will be added; the merged items are deleted.`,
              'Merge');
            if (!ok) return;
            try {
              await API.mergeItems(keepId, mergeIds, true);
              UI.toast('Merged');
              card.remove();
            } catch (err) {
              UI.toast(err.message, true);
            }
          },
        }, `Merge ${group.items.length - 1} into selected`)),
    );
    return card;
  }

  return { render };
})();
