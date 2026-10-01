/* Settings view — backups, exports, server health. */

window.Views = window.Views || {};

Views.settings = (() => {
  const { h } = UI;

  function restoreButton() {
    const fileInput = h('input', {
      type: 'file', accept: '.json,application/json', style: { display: 'none' },
      onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        let backup;
        try {
          backup = JSON.parse(await file.text());
        } catch (_) {
          UI.toast('Not a valid JSON file', true);
          return;
        }
        if (backup.app !== 'MakerVault' || !backup.items) {
          UI.toast('Not a MakerVault backup file', true);
          return;
        }
        const ok = await UI.confirmDialog(
          'Restore backup',
          `Replace EVERYTHING with the backup from ${backup.exported_at || 'unknown date'} `
          + `(${backup.items.length} items, ${(backup.locations || []).length} locations)? `
          + 'Current data will be overwritten. This cannot be undone.',
          'Restore');
        if (!ok) return;
        try {
          const res = await API.restoreBackup(backup);
          UI.toast(`Restored ${res.counts.items} items`);
          await Promise.all([App.refreshCategories(), App.refreshLocations()]);
          render(document.getElementById('main'));
        } catch (err) {
          UI.toast(err.message, true);
        } finally {
          fileInput.value = '';
        }
      },
    });
    return h('span', fileInput,
      h('button.btn.danger', { onclick: () => fileInput.click() }, '⤴ Restore…'));
  }

  async function render(main) {
    const healthCard = h('div.card', h('div.spinner'));

    main.replaceChildren(
      h('div.page-header', h('div', h('h1', 'Settings'), h('div.page-sub', 'Backups, tools, and server status'))),

      h('div.settings-section',
        h('h3.section-title', 'Backup & Export'),
        h('div.card',
          h('div.settings-row',
            h('div',
              h('div', 'Full JSON backup'),
              h('div.desc', 'Every item, location, category, printer, label template, and the activity log')),
            h('a.btn', { href: API.backupJSONURL() }, '⬇ Download JSON')),
          h('div.settings-row',
            h('div',
              h('div', 'Items CSV export'),
              h('div.desc', 'Spreadsheet-friendly export of all items with location names')),
            h('a.btn', { href: API.backupCSVURL() }, '⬇ Download CSV')),
          h('div.settings-row',
            h('div',
              h('div', 'Restore from JSON backup'),
              h('div.desc', 'Replaces ALL items, locations, categories, printers, and label templates with the backup contents. Photos and the activity log are kept.')),
            restoreButton()),
          h('div.settings-row',
            h('div',
              h('div', 'Photos'),
              h('div.desc', 'Item photos are plain files in data/photos/ on the NAS — include that folder in Hyper Backup')),
            null),
        ),
      ),

      h('div.settings-section',
        h('h3.section-title', 'Tools'),
        h('div.card',
          h('div.settings-row',
            h('div',
              h('div', 'Categories'),
              h('div.desc', 'Add, rename, recolor, and reorder item categories')),
            h('a.btn', { href: '#/categories' }, 'Open')),
          h('div.settings-row',
            h('div',
              h('div', 'Duplicate finder'),
              h('div.desc', 'Fuzzy-match likely duplicate items and merge them')),
            h('a.btn', { href: '#/duplicates' }, 'Open')),
          h('div.settings-row',
            h('div',
              h('div', 'Label designer'),
              h('div.desc', 'Design and print labels with barcodes and QR codes')),
            h('a.btn', { href: '#/labels' }, 'Open')),
          h('div.settings-row',
            h('div',
              h('div', 'Printers & AMS'),
              h('div.desc', 'AMS slots and loaded filament, load/unload workflows')),
            h('a.btn', { href: '#/printers' }, 'Open')),
          h('div.settings-row',
            h('div',
              h('div', 'PDF import'),
              h('div.desc', 'Import items from Bambu Lab or Amazon invoices, or hardware kits')),
            h('a.btn', { href: '#/import' }, 'Open')),
          h('div.settings-row',
            h('div',
              h('div', 'BOM checker'),
              h('div.desc', 'Check a Makerworld BOM (.xlsx) against your inventory')),
            h('a.btn', { href: '#/bom' }, 'Open')),
          h('div.settings-row',
            h('div',
              h('div', 'Activity log'),
              h('div.desc', 'Full history of adds, edits, moves, and imports')),
            h('a.btn', { href: '#/activity' }, 'Open')),
        ),
      ),

      h('div.settings-section',
        h('h3.section-title', 'Server'),
        healthCard,
      ),

      h('div.settings-section',
        h('h3.section-title', 'About'),
        h('div.card',
          h('div.settings-row',
            h('div',
              h('div', 'MakerVault Web'),
              h('div.desc', 'Self-hosted inventory for makers — web edition, running on Synology Web Station')),
            null),
        ),
      ),
    );

    try {
      const health = await API.health();
      healthCard.replaceChildren(
        h('div.settings-row',
          h('div', h('div', 'Status'), h('div.desc', `PHP ${health.php} · ${health.database}`)),
          h('span.badge.ok', health.status)),
        h('div.settings-row',
          h('div', h('div', 'Contents')),
          h('span.desc', `${health.items} items · ${health.locations} locations · ${health.categories} categories`)),
        h('div.settings-row',
          h('div', h('div', 'Database writable'), h('div.desc', 'Both the .db file and the data/ folder must be writable by the http user')),
          health.db_writable ? h('span.badge.ok', 'yes') : h('span.badge.out', 'NO — fix permissions')),
        h('div.settings-row',
          h('div', h('div', 'App version')),
          h('span.desc', health.version)),
      );
    } catch (err) {
      healthCard.replaceChildren(h('div.settings-row', '⚠️ Health check failed: ' + err.message));
    }
  }

  return { render };
})();
