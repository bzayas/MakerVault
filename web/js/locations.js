/* Locations view — hierarchical tree browser with an items panel,
   plus add/edit/delete location management. */

window.Views = window.Views || {};

Views.locations = (() => {
  const { h } = UI;

  const TYPE_META = {
    closetRack: ['🗄️', 'Closet Rack'],
    shelf: ['📚', 'Shelf'],
    rollingCart: ['🛒', 'Rolling Cart'],
    cartLayer: ['🧅', 'Cart Layer'],
    cabinet: ['🚪', 'Cabinet'],
    drawer: ['🗃️', 'Drawer'],
    gridfinityBin: ['🧩', 'Gridfinity Bin'],
    wallStorage: ['🧱', 'Wall Storage'],
    wallBin: ['📥', 'Wall Bin'],
    ikeaBin: ['🪣', 'IKEA Bin'],
    stanleySortmaster: ['🧰', 'Stanley Sortmaster'],
    sortmasterCompartment: ['🔲', 'Sortmaster Compartment'],
    toolBox: ['🧰', 'Tool Box'],
    amsUnit: ['🎛️', 'AMS Unit'],
    amsSlot: ['🎰', 'AMS Slot'],
    externalSpool: ['🧵', 'External Spool'],
    dryBox: ['📦', 'Dry Box'],
    printer: ['🖨️', 'Printer'],
    inUse: ['🔧', 'In Use'],
    custom: ['📍', 'Custom'],
  };

  const expanded = new Set(JSON.parse(localStorage.getItem('mv-loc-expanded') || '[]'));
  let selectedId = null;
  let treeEl = null;
  let panelEl = null;

  function saveExpanded() {
    localStorage.setItem('mv-loc-expanded', JSON.stringify([...expanded]));
  }

  async function render(main) {
    treeEl = h('div.loc-tree', h('div.spinner'));
    panelEl = h('div');

    main.replaceChildren(
      h('div.page-header',
        h('div', h('h1', 'Locations')),
        h('button.btn.primary', { onclick: () => locationForm(null) }, '＋ Add Location'),
      ),
      h('div.loc-layout',
        h('div.card', treeEl),
        panelEl,
      ),
    );

    await refreshTree();
  }

  async function refreshTree() {
    try {
      await App.refreshLocations();
      const tree = App.state.locationTree;
      treeEl.replaceChildren(
        tree.length
          ? h('div', tree.map((n) => renderNode(n)))
          : h('div.empty-state', h('div.big', '🗺️'), 'No locations yet'),
      );
    } catch (err) {
      treeEl.replaceChildren(h('div.empty-state', '⚠️ ' + err.message));
    }
  }

  function renderNode(node) {
    const hasKids = (node.children || []).length > 0;
    const isOpen = expanded.has(node.id);
    const [icon] = TYPE_META[node.type] || ['📍'];

    const childrenEl = h('div.loc-children', { style: { display: isOpen ? '' : 'none' } },
      (node.children || []).map((c) => renderNode(c)));

    const toggle = h('span.loc-toggle' + (hasKids ? (isOpen ? '.open' : '') : '.leaf'), {
      onclick: (e) => {
        e.stopPropagation();
        if (!hasKids) return;
        if (expanded.has(node.id)) {
          expanded.delete(node.id);
          toggle.classList.remove('open');
          childrenEl.style.display = 'none';
        } else {
          expanded.add(node.id);
          toggle.classList.add('open');
          childrenEl.style.display = '';
        }
        saveExpanded();
      },
    }, '▶');

    const row = h('div.loc-row' + (node.id === selectedId ? '.selected' : ''), {
      onclick: () => selectLocation(node, row),
    },
      toggle,
      h('span.loc-icon', icon),
      h('span.loc-name', node.name),
      node.item_count ? h('span.loc-count', `${node.item_count}`) : null,
    );

    return h('div.loc-node', row, childrenEl);
  }

  async function selectLocation(node, rowEl = null) {
    selectedId = node.id;
    // Re-highlight without a full tree rebuild
    treeEl.querySelectorAll('.loc-row.selected').forEach((el) => el.classList.remove('selected'));
    if (rowEl) rowEl.classList.add('selected');
    panelEl.replaceChildren(h('div.spinner'));

    let items = [];
    try {
      items = await API.locationItems(node.id);
    } catch (err) {
      panelEl.replaceChildren(h('div.card', '⚠️ ' + err.message));
      return;
    }

    const [icon, typeLabel] = TYPE_META[node.type] || ['📍', node.type];

    // Breadcrumb: full path with clickable ancestors
    const path = (App.locationPath(node.id) || node.name).split(' › ');
    const crumbs = h('div.breadcrumb',
      path.map((seg, i) => [
        i > 0 ? h('span.crumb-sep', '›') : null,
        i < path.length - 1
          ? h('a', {
              href: '#/locations',
              onclick: (e) => {
                e.preventDefault();
                const target = [...App.state.locationById.values()]
                  .find((l) => l.fullPath === path.slice(0, i + 1).join(' › '));
                if (target) selectLocation(target);
              },
            }, seg)
          : h('span', { style: { color: 'var(--text)' } }, seg),
      ]));

    panelEl.replaceChildren(
      h('div.card',
        crumbs,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '6px 0 8px' } },
          h('span', { style: { fontSize: '24px' } }, icon),
          h('div', { style: { flex: 1 } },
            h('div', { style: { fontWeight: 700, fontSize: '17px' } }, node.name),
            h('div', { style: { color: 'var(--text-dim)', fontSize: '13px' } },
              typeLabel
              + ` · ${items.length} item${items.length === 1 ? '' : 's'}`
              + (node.capacity ? ` · capacity ${node.capacity}` : ''))),
          h('button.btn.small', { onclick: () => locationForm(node) }, 'Edit'),
          h('button.btn.small.danger', { onclick: () => deleteLocation(node) }, 'Delete'),
        ),
        node.notes ? h('p', { style: { color: 'var(--text-dim)', margin: '4px 0 10px' } }, node.notes) : null,
        h('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' } },
          h('button.btn.small', {
            onclick: () => Views.labels.quickPrint({ locationId: node.id }),
          }, '🏷️ QR label'),
          (node.children || []).length ? h('button.btn.small', {
            onclick: () => {
              const ids = [];
              const walk = (n) => { ids.push(n.id); (n.children || []).forEach(walk); };
              walk(node);
              Views.labels.printLocationBatch(ids);
            },
          }, `🏷️ QR labels × ${(() => { let c = 0; const w = (n) => { c++; (n.children || []).forEach(w); }; w(node); return c; })()}`) : null,
          h('button.btn.small', {
            onclick: () => locationForm(null, node.id),
          }, '＋ Sub-location'),
          h('button.btn.small', {
            onclick: () => Views.inventory.openAddItem({ location_id: node.id }),
          }, '＋ Item here'),
        ),
        h('h3.section-title', `Items (${items.length})`),
        items.length
          ? h('div.item-list', items.map((item) =>
              h('div.item-row', { onclick: () => Views.inventory.openDetail(item.id) },
                h('div.item-main',
                  h('div.item-name', item.name, ' ', UI.stockBadge(item)),
                  h('div.item-sub', [item.brand, item.sku].filter(Boolean).join(' · '))),
                h('div.qty-value', String(item.quantity), h('span.unit', item.unit)))))
          : h('div.empty-state', 'No items stored here'),
      ),
    );
  }

  // ------------------------------------------------------------------

  function locationForm(node, parentIdPrefill = null) {
    const isEdit = !!node;
    const f = {};

    f.name = h('input', { type: 'text', value: node ? node.name : '' });
    f.type = h('select', Object.entries(TYPE_META).map(([v, [icon, label]]) =>
      h('option', { value: v, selected: node && node.type === v }, `${icon} ${label}`)));
    if (!node) f.type.value = 'custom';

    const parentOpts = [h('option', { value: '' }, '— Top level —')];
    const walk = (nodes, depth) => {
      nodes.forEach((n) => {
        if (node && n.id === node.id) return; // can't parent to self
        parentOpts.push(h('option', {
          value: n.id,
          selected: node ? n.id === node.parent_id : n.id === parentIdPrefill,
        }, `${' '.repeat(depth * 3)}${n.name}`));
        walk(n.children || [], depth + 1);
      });
    };
    walk(App.state.locationTree, 0);
    f.parent_id = h('select', parentOpts);

    f.capacity = h('input', { type: 'number', min: 0, value: node && node.capacity !== null ? node.capacity : '' });
    f.notes = h('textarea', { rows: 2 }, node ? (node.notes || '') : '');

    const fld = (label, control) => h('label.field', h('span', label), control);

    const save = async () => {
      const name = f.name.value.trim();
      if (!name) { UI.toast('Name is required', true); return; }
      const payload = {
        name,
        type: f.type.value,
        parent_id: f.parent_id.value || null,
        capacity: f.capacity.value === '' ? null : Number(f.capacity.value),
        notes: f.notes.value.trim() || null,
      };
      try {
        if (isEdit) {
          await API.updateLocation(node.id, payload);
        } else {
          const created = await API.createLocation(payload);
          if (payload.parent_id) expanded.add(payload.parent_id);
          saveExpanded();
          selectedId = created.id;
        }
        UI.toast(isEdit ? 'Location updated' : 'Location added');
        m.close();
        refreshTree();
      } catch (err) {
        UI.toast(err.message, true);
      }
    };

    const m = UI.modal({
      title: isEdit ? `Edit: ${node.name}` : 'Add Location',
      body: h('div',
        fld('Name *', f.name),
        h('div.field-row', fld('Type', f.type), fld('Parent', f.parent_id)),
        fld('Capacity (optional)', f.capacity),
        fld('Notes', f.notes),
      ),
      footer: [
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn.primary', { onclick: save }, isEdit ? 'Save' : 'Add'),
      ],
    });
  }

  async function deleteLocation(node) {
    const hasKids = (node.children || []).length > 0;
    const msg = hasKids
      ? `Delete "${node.name}"? Its sub-locations will move up one level; items here lose their location.`
      : `Delete "${node.name}"? Items here will lose their location.`;
    const ok = await UI.confirmDialog('Delete location', msg);
    if (!ok) return;
    try {
      await API.deleteLocation(node.id);
      UI.toast('Location deleted');
      selectedId = null;
      panelEl.replaceChildren();
      refreshTree();
    } catch (err) {
      UI.toast(err.message, true);
    }
  }

  return { render };
})();
