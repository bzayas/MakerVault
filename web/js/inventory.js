/* Inventory view — searchable/filterable list, item detail, add/edit forms
   with filament support, quantity steppers, photo upload. */

window.Views = window.Views || {};

Views.inventory = (() => {
  const { h } = UI;

  // Covers every material in the DB plus the Bambu lines the importers emit;
  // the form select also prepends an item's own value if it's not listed
  const FILAMENT_MATERIALS = [
    'PLA', 'PLA+', 'PLA Matte', 'PLA Silk', 'PLA Silk+', 'PLA Silk Multi-Color',
    'PLA Silk Duo-Color', 'PLA Gradient', 'PLA Galaxy', 'PLA Marble', 'PLA Sparkle',
    'PLA Wood', 'PLA-CF', 'PETG', 'PETG HF', 'PETG Translucent', 'PETG-CF',
    'ABS', 'ASA', 'ASA Aero', 'ASA Matte', 'TPU', 'TPU 85A', 'TPU 90A', 'TPU HF',
    'PC', 'PA', 'PA6-CF', 'PPA-CF', 'PET-CF', 'PAHT-CF', 'PVA', 'HIPS',
    'Support for PLA', 'Support for PLA/PETG', 'Support for ABS', 'Other',
  ];
  const FILAMENT_STATUSES = [
    ['inStock', 'In stock'], ['loadedInAMS', 'Loaded in AMS'],
    ['loadedExternal', 'Loaded external'], ['inUse', 'In use'], ['empty', 'Empty'],
  ];
  const COLOR_MODES = [
    ['solid', 'Solid'], ['gradient', 'Gradient'], ['split', 'Split'],
    ['sparkle', 'Sparkle'], ['silk', 'Silk'],
  ];
  const UNITS = ['pcs', 'packs', 'spools', 'sheets', 'sets', 'rolls', 'meters', 'grams'];

  let filters = { query: '', category: '', status: '', location_id: '', sort_by: 'name', sort_order: 'asc' };
  let listEl = null;

  // ------------------------------------------------------------------
  // Smart filters (saved views) — persisted in localStorage.
  // Built-ins are always shown; custom ones have a condition list that is
  // evaluated client-side over the fetched items.
  // ------------------------------------------------------------------

  const SMART_FIELDS = {
    name: { label: 'Name', type: 'text', get: (i) => i.name },
    brand: { label: 'Brand', type: 'text', get: (i) => i.brand },
    vendor: { label: 'Vendor', type: 'text', get: (i) => i.vendor },
    category: { label: 'Category', type: 'text', get: (i) => i.category },
    tags: { label: 'Tags', type: 'text', get: (i) => (i.tags || []).join(' ') },
    notes: { label: 'Notes', type: 'text', get: (i) => i.notes },
    quantity: { label: 'Quantity', type: 'number', get: (i) => i.quantity },
    purchase_price: { label: 'Price', type: 'number', get: (i) => i.purchase_price },
    material: { label: 'Filament material', type: 'text', get: (i) => i.filament?.material },
    has_photo: { label: 'Has photo', type: 'boolean', get: (i) => !!i.photo_path },
    low_stock: { label: 'Low stock', type: 'boolean',
      get: (i) => i.min_quantity !== null && i.quantity <= i.min_quantity },
  };
  const TEXT_OPS = { contains: 'contains', equals: 'is exactly', not_contains: "doesn't contain" };
  const NUM_OPS = { eq: '=', lt: '<', gt: '>' };

  const BUILTIN_FILTERS = [
    { id: 'lowStock', name: 'Low Stock', icon: '⚠️',
      test: (i) => i.min_quantity !== null && i.quantity <= i.min_quantity },
    { id: 'checkedOut', name: 'Checked Out', icon: '🔧',
      test: (i) => i.tool && i.tool.checked_out },
    { id: 'noLocation', name: 'No Location', icon: '❓',
      test: (i) => !i.location_id && !(i.filament && i.filament.printer_slot_id) },
  ];

  let smartFilters = JSON.parse(localStorage.getItem('mv-smart-filters') || '[]');
  let activeSmart = null; // id of active built-in or custom filter

  function saveSmartFilters() {
    localStorage.setItem('mv-smart-filters', JSON.stringify(smartFilters));
  }

  function evalCondition(item, cond) {
    const field = SMART_FIELDS[cond.field];
    if (!field) return true;
    const raw = field.get(item);
    if (field.type === 'boolean') {
      return String(cond.value) === 'true' ? !!raw : !raw;
    }
    if (field.type === 'number') {
      const v = Number(cond.value);
      const n = raw === null || raw === undefined ? null : Number(raw);
      if (n === null) return false;
      if (cond.op === 'lt') return n < v;
      if (cond.op === 'gt') return n > v;
      return n === v;
    }
    const s = String(raw ?? '').toLowerCase();
    const v = String(cond.value ?? '').toLowerCase();
    if (cond.op === 'equals') return s === v;
    if (cond.op === 'not_contains') return !s.includes(v);
    return s.includes(v);
  }

  function smartTest(item) {
    if (!activeSmart) return true;
    const builtin = BUILTIN_FILTERS.find((f) => f.id === activeSmart);
    if (builtin) return builtin.test(item);
    const custom = smartFilters.find((f) => f.id === activeSmart);
    if (!custom) return true;
    return custom.conditions.every((c) => evalCondition(item, c));
  }

  // ------------------------------------------------------------------
  // Multi-select / batch edit state
  // ------------------------------------------------------------------

  let selecting = false;
  let selected = new Set();
  let bulkBar = null;

  // ------------------------------------------------------------------
  // List rendering
  // ------------------------------------------------------------------

  async function render(main, params = {}) {
    // Apply deep-link params (#/inventory?category=x&status=y&location=z)
    filters = {
      ...filters,
      category: params.category ?? filters.category,
      status: params.status ?? filters.status,
      location_id: params.location ?? filters.location_id,
    };

    const search = h('input.search-box', {
      type: 'search', placeholder: 'Search name, SKU, barcode, notes…',
      value: filters.query,
      oninput: UI.debounce((e) => { filters.query = e.target.value; refreshList(); }, 250),
    });

    const catSelect = h('select', {
      onchange: (e) => { filters.category = e.target.value; refreshList(); },
    },
      h('option', { value: '' }, 'All categories'),
      App.state.categories.map((c) =>
        h('option', { value: c.key, selected: filters.category === c.key }, c.display_name)),
    );

    const statusSelect = h('select', {
      onchange: (e) => { filters.status = e.target.value; refreshList(); },
    },
      [['', 'Any stock'], ['inStock', 'In stock'], ['lowStock', 'Low stock'], ['outOfStock', 'Out of stock']]
        .map(([v, l]) => h('option', { value: v, selected: filters.status === v }, l)),
    );

    const sortSelect = h('select', {
      onchange: (e) => {
        const [by, order] = e.target.value.split(':');
        filters.sort_by = by;
        filters.sort_order = order;
        refreshList();
      },
    },
      [['name:asc', 'Name A→Z'], ['name:desc', 'Name Z→A'],
       ['quantity:asc', 'Qty low→high'], ['quantity:desc', 'Qty high→low'],
       ['updated_at:desc', 'Recently updated'], ['created_at:desc', 'Recently added']]
        .map(([v, l]) => h('option', { value: v, selected: `${filters.sort_by}:${filters.sort_order}` === v }, l)),
    );

    listEl = h('div.item-list', h('div.spinner'));
    bulkBar = h('div.bulk-bar', { style: { display: 'none' } });

    main.replaceChildren(
      h('div.page-header',
        h('div', h('h1', 'Inventory'), h('div.page-sub', 'Everything in the workshop, searchable')),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button.btn#select-btn', { onclick: toggleSelecting }, '☑ Select'),
          h('button.btn.primary', { onclick: () => openAddItem() }, '＋ Add Item')),
      ),
      buildSmartBar(),
      h('div.toolbar', search, catSelect, statusSelect, sortSelect),
      listEl,
      bulkBar,
    );

    await refreshList();
  }

  // ------------------------------------------------------------------
  // Smart filter bar
  // ------------------------------------------------------------------

  function buildSmartBar() {
    const bar = h('div.chip-row', { style: { marginBottom: '12px' } });
    const chipFor = (f, isCustom) => h('button.chip' + (activeSmart === f.id ? '.active' : ''), {
      onclick: () => {
        activeSmart = activeSmart === f.id ? null : f.id;
        render(document.getElementById('main'));
      },
      oncontextmenu: isCustom ? (e) => {
        e.preventDefault();
        smartFilterEditor(f);
      } : undefined,
      title: isCustom ? 'Right-click to edit' : undefined,
    }, `${f.icon} ${f.name}`);

    bar.append(
      ...BUILTIN_FILTERS.map((f) => chipFor(f, false)),
      ...smartFilters.map((f) => chipFor(f, true)),
      h('button.chip', { onclick: () => smartFilterEditor(null) }, '＋ Filter'),
    );
    return bar;
  }

  function smartFilterEditor(existing) {
    const filter = existing
      ? structuredClone(existing)
      : { id: 'sf-' + Date.now().toString(36), name: '', icon: '⭐', conditions: [{ field: 'name', op: 'contains', value: '' }] };

    const nameInput = h('input', { type: 'text', value: filter.name, placeholder: 'Filter name' });
    const iconInput = h('input', { type: 'text', value: filter.icon, maxLength: 4, style: { width: '64px' } });
    const condWrap = h('div');
    const countEl = h('span.desc', '');

    const updateCount = UI.debounce(async () => {
      try {
        const items = await API.listItems({ limit: 1000 });
        const n = items.filter((i) => filter.conditions.every((c) => evalCondition(i, c))).length;
        countEl.textContent = `Matches ${n} item${n === 1 ? '' : 's'}`;
      } catch (_) { /* preview only */ }
    }, 350);

    const opsFor = (field) => SMART_FIELDS[field]?.type === 'number' ? NUM_OPS
      : SMART_FIELDS[field]?.type === 'boolean' ? { is: 'is' } : TEXT_OPS;

    const redraw = () => {
      condWrap.replaceChildren(...filter.conditions.map((cond, idx) => {
        const fieldSel = h('select', { style: { width: 'auto' } },
          Object.entries(SMART_FIELDS).map(([k, f]) =>
            h('option', { value: k, selected: cond.field === k }, f.label)));
        const opSel = h('select', { style: { width: 'auto' } },
          Object.entries(opsFor(cond.field)).map(([k, l]) =>
            h('option', { value: k, selected: cond.op === k }, l)));
        const type = SMART_FIELDS[cond.field]?.type;
        const valInput = type === 'boolean'
          ? h('select', { style: { width: 'auto' } },
              h('option', { value: 'true', selected: String(cond.value) === 'true' }, 'yes'),
              h('option', { value: 'false', selected: String(cond.value) !== 'true' }, 'no'))
          : h('input', {
              type: type === 'number' ? 'number' : 'text',
              value: cond.value ?? '', style: { flex: 1, minWidth: '90px' },
            });

        fieldSel.onchange = () => { cond.field = fieldSel.value; cond.op = Object.keys(opsFor(cond.field))[0]; redraw(); updateCount(); };
        opSel.onchange = () => { cond.op = opSel.value; updateCount(); };
        valInput.oninput = valInput.onchange = () => { cond.value = valInput.value; updateCount(); };

        return h('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' } },
          fieldSel, opSel, valInput,
          h('button.qty-btn', {
            onclick: () => { filter.conditions.splice(idx, 1); redraw(); updateCount(); },
            disabled: filter.conditions.length === 1,
          }, '✕'));
      }));
    };
    redraw();
    updateCount();

    const m = UI.modal({
      title: existing ? `Edit Filter: ${existing.name}` : 'New Smart Filter',
      body: h('div',
        h('div.field-row',
          h('label.field', h('span', 'Name'), nameInput),
          h('label.field', h('span', 'Icon (emoji)'), iconInput)),
        h('h3.section-title', 'Match all of…'),
        condWrap,
        h('button.btn.small', {
          onclick: () => { filter.conditions.push({ field: 'name', op: 'contains', value: '' }); redraw(); },
        }, '＋ Condition'),
        h('div', { style: { marginTop: '10px' } }, countEl)),
      footer: [
        existing ? h('button.btn.danger', {
          onclick: () => {
            smartFilters = smartFilters.filter((f) => f.id !== existing.id);
            if (activeSmart === existing.id) activeSmart = null;
            saveSmartFilters();
            m.close();
            render(document.getElementById('main'));
          },
        }, 'Delete') : null,
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn.primary', {
          onclick: () => {
            filter.name = nameInput.value.trim() || 'Untitled';
            filter.icon = iconInput.value.trim() || '⭐';
            const idx = smartFilters.findIndex((f) => f.id === filter.id);
            if (idx >= 0) smartFilters[idx] = filter;
            else smartFilters.push(filter);
            activeSmart = filter.id;
            saveSmartFilters();
            m.close();
            render(document.getElementById('main'));
          },
        }, 'Save Filter'),
      ],
    });
  }

  async function refreshList() {
    if (!listEl) return;
    try {
      let items = await API.listItems({
        query: filters.query, category: filters.category, status: filters.status,
        location_id: filters.location_id,
        sort_by: filters.sort_by, sort_order: filters.sort_order, limit: 1000,
      });
      if (activeSmart) items = items.filter(smartTest);
      if (!items.length) {
        listEl.replaceChildren(h('div.empty-state', h('div.big', '📭'), 'No items match'));
        return;
      }
      listEl.replaceChildren(
        ...items.map(itemRow),
        h('div.list-footer', `${items.length} item${items.length === 1 ? '' : 's'}`),
      );
    } catch (err) {
      listEl.replaceChildren(h('div.empty-state', h('div.big', '⚠️'), err.message));
    }
  }

  // ------------------------------------------------------------------
  // Multi-select / batch actions
  // ------------------------------------------------------------------

  function toggleSelecting() {
    selecting = !selecting;
    if (!selecting) selected.clear();
    const btn = document.getElementById('select-btn');
    if (btn) btn.textContent = selecting ? '✕ Cancel' : '☑ Select';
    updateBulkBar();
    refreshList();
  }

  function updateBulkBar() {
    if (!bulkBar) return;
    if (!selecting) {
      bulkBar.style.display = 'none';
      return;
    }
    bulkBar.style.display = '';
    bulkBar.replaceChildren(
      h('span', { style: { fontWeight: 600 } }, `${selected.size} selected`),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button.btn.small', { onclick: batchEditModal, disabled: !selected.size }, '✏️ Edit'),
        h('button.btn.small', { onclick: batchMoveModal, disabled: !selected.size }, '📍 Move'),
        h('button.btn.small', {
          onclick: () => Views.labels.quickPrintItemBatch([...selected]),
          disabled: !selected.size,
        }, '🏷️ Labels'),
        h('button.btn.small.danger', { onclick: batchDelete, disabled: !selected.size }, '🗑 Delete')),
    );
  }

  async function afterBatch(message) {
    UI.toast(message);
    selected.clear();
    selecting = false;
    const btn = document.getElementById('select-btn');
    if (btn) btn.textContent = '☑ Select';
    updateBulkBar();
    refreshList();
  }

  function batchEditModal() {
    const ids = [...selected];
    const f = {};
    const enabled = {};

    const row = (key, label, control) => {
      f[key] = control;
      const toggle = h('input', { type: 'checkbox', onchange: (e) => { enabled[key] = e.target.checked; } });
      return h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' } },
        toggle,
        h('label.field', { style: { flex: 1, marginBottom: 0 } }, h('span', label), control));
    };

    const catSel = h('select', App.state.categories.map((c) => h('option', { value: c.key }, c.display_name)));
    const locSel = h('select', locationOptions(null));
    const brand = h('input', { type: 'text' });
    const vendor = h('input', { type: 'text' });
    const subcat = h('input', { type: 'text' });
    const minQty = h('input', { type: 'number', min: 0 });
    const tags = h('input', { type: 'text', placeholder: 'comma, separated (replaces existing)' });

    const m = UI.modal({
      title: `Batch Edit ${ids.length} Item${ids.length === 1 ? '' : 's'}`,
      body: h('div',
        h('div', { style: { color: 'var(--text-dim)', fontSize: '13px', marginBottom: '12px' } },
          'Tick the fields to apply — unticked fields are left untouched.'),
        row('category', 'Category', catSel),
        row('location_id', 'Location', locSel),
        row('brand', 'Brand', brand),
        row('vendor', 'Vendor', vendor),
        row('subcategory', 'Subcategory', subcat),
        row('min_quantity', 'Min quantity', minQty),
        row('tags', 'Tags', tags)),
      footer: [
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn.primary', {
          onclick: async () => {
            const updates = {};
            if (enabled.category) updates.category = catSel.value;
            if (enabled.location_id) updates.location_id = locSel.value || null;
            if (enabled.brand) updates.brand = brand.value.trim() || null;
            if (enabled.vendor) updates.vendor = vendor.value.trim() || null;
            if (enabled.subcategory) updates.subcategory = subcat.value.trim() || null;
            if (enabled.min_quantity) updates.min_quantity = minQty.value === '' ? null : Number(minQty.value);
            if (enabled.tags) updates.tags = tags.value.split(',').map((t) => t.trim()).filter(Boolean);
            if (!Object.keys(updates).length) { UI.toast('Tick at least one field', true); return; }
            try {
              const res = await API.batchUpdate(ids, updates);
              m.close();
              afterBatch(`Updated ${res.updated} item${res.updated === 1 ? '' : 's'}`);
            } catch (err) {
              UI.toast(err.message, true);
            }
          },
        }, 'Apply to Selected'),
      ],
    });
  }

  function batchMoveModal() {
    const ids = [...selected];
    const locSel = h('select', locationOptions(null));
    const m = UI.modal({
      title: `Move ${ids.length} Item${ids.length === 1 ? '' : 's'}`,
      body: h('label.field', h('span', 'Destination'), locSel),
      footer: [
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn.primary', {
          onclick: async () => {
            try {
              const res = await API.batchUpdate(ids, { location_id: locSel.value || null });
              m.close();
              afterBatch(`Moved ${res.updated} item${res.updated === 1 ? '' : 's'}`);
            } catch (err) {
              UI.toast(err.message, true);
            }
          },
        }, 'Move'),
      ],
    });
  }

  async function batchDelete() {
    const ids = [...selected];
    const ok = await UI.confirmDialog('Delete items',
      `Delete ${ids.length} item${ids.length === 1 ? '' : 's'}? This cannot be undone.`);
    if (!ok) return;
    try {
      await API.batchDelete(ids);
      afterBatch(`Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`);
    } catch (err) {
      UI.toast(err.message, true);
    }
  }

  function itemThumb(item) {
    if (item.photo_path) {
      return h('div.item-thumb', h('img', { src: API.photoURL(item.id, item.updated_at), loading: 'lazy', alt: '' }));
    }
    if (item.category === 'filament' && item.filament) {
      return h('div.item-thumb', UI.swatch(item.filament));
    }
    if (item.color_hex) {
      return h('div.item-thumb', UI.colorDot(item.color_hex));
    }
    const cat = App.state.categoryByKey.get(item.category);
    return h('div.item-thumb', UI.categoryIcon(cat));
  }

  function itemSubtitle(item) {
    const parts = [];
    if (item.filament) parts.push(item.filament.material);
    if (item.brand) parts.push(item.brand);
    if (item.sku) parts.push(item.sku);
    const loc = App.locationName(item.location_id);
    if (loc) parts.push('📍 ' + loc);
    return parts.join(' · ');
  }

  function itemRow(item) {
    // Selection mode: checkbox row, click toggles membership
    if (selecting) {
      const cb = h('input', { type: 'checkbox', checked: selected.has(item.id),
        onclick: (e) => e.stopPropagation(),
        onchange: (e) => {
          if (e.target.checked) selected.add(item.id); else selected.delete(item.id);
          row.classList.toggle('row-selected', e.target.checked);
          updateBulkBar();
        } });
      const row = h('div.item-row' + (selected.has(item.id) ? '.row-selected' : ''), {
        onclick: () => { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); },
      },
        cb,
        itemThumb(item),
        h('div.item-main',
          h('div.item-name', item.name, ' ', UI.stockBadge(item)),
          h('div.item-sub', itemSubtitle(item))),
        h('div.qty-value', String(item.quantity), h('span.unit', item.unit)),
      );
      return row;
    }

    const qtyValue = h('div.qty-value', String(item.quantity), h('span.unit', item.unit));

    const adjust = async (delta, ev) => {
      ev.stopPropagation();
      const next = Math.max(0, item.quantity + delta);
      if (next === item.quantity) return;
      try {
        const updated = await API.updateItem(item.id, { quantity: next });
        item.quantity = updated.quantity;
        qtyValue.replaceChildren(String(item.quantity), h('span.unit', item.unit));
      } catch (err) {
        UI.toast(err.message, true);
      }
    };

    return h('div.item-row', { onclick: () => openDetail(item.id) },
      itemThumb(item),
      h('div.item-main',
        h('div.item-name', item.name, ' ', UI.stockBadge(item)),
        h('div.item-sub', itemSubtitle(item))),
      h('div.item-qty',
        h('button.qty-btn', { onclick: (e) => adjust(-1, e), 'aria-label': 'Decrease' }, '−'),
        qtyValue,
        h('button.qty-btn', { onclick: (e) => adjust(1, e), 'aria-label': 'Increase' }, '+')),
    );
  }

  // ------------------------------------------------------------------
  // Item detail
  // ------------------------------------------------------------------

  async function openDetail(itemId) {
    let item;
    try {
      item = await API.getItem(itemId);
    } catch (err) {
      UI.toast(err.message, true);
      return;
    }

    const cat = App.state.categoryByKey.get(item.category);

    const field = (label, value) => (value === null || value === undefined || value === '') ? [] : [
      h('div.lbl', label), h('div.val', value),
    ];

    // Quantity: stepper + tap the number to type an exact count.
    // `done` guards the Escape path: detaching the input fires blur, which
    // must not commit after an explicit cancel.
    const qtyDisplay = h('div.big-qty', { title: 'Tap to type an exact quantity', onclick: () => {
      let done = false;
      const input = h('input', {
        type: 'number', min: 0, value: item.quantity,
        style: { width: '90px', fontSize: '22px', textAlign: 'center' },
        onkeydown: (e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        },
        onblur: () => commit(),
      });
      const finish = () => {
        if (done) return false;
        done = true;
        input.replaceWith(qtyDisplay);
        return true;
      };
      const cancel = () => finish();
      const commit = async () => {
        const next = Math.max(0, Math.trunc(Number(input.value) || 0));
        if (!finish()) return;
        if (next === item.quantity) return;
        try {
          const updated = await API.updateItem(item.id, { quantity: next });
          item.quantity = updated.quantity ?? next;
          qtyDisplay.textContent = String(item.quantity);
        } catch (err) {
          UI.toast(err.message, true);
        }
      };
      qtyDisplay.replaceWith(input);
      input.focus();
      input.select();
    } }, String(item.quantity));

    const adjust = async (delta) => {
      const next = Math.max(0, item.quantity + delta);
      if (next === item.quantity) return;
      try {
        const updated = await API.updateItem(item.id, { quantity: next });
        item.quantity = updated.quantity ?? next;
        qtyDisplay.textContent = String(item.quantity);
      } catch (err) {
        UI.toast(err.message, true);
      }
    };

    // ---- Action row (label / duplicate / copy id / location / check in-out)
    const copyText = async (text, what) => {
      try {
        await navigator.clipboard.writeText(text);
        UI.toast(`${what} copied`);
      } catch (_) {
        UI.toast('Clipboard unavailable', true);
      }
    };

    const actions = h('div.action-row',
      h('button.action-btn', {
        onclick: () => Views.labels.quickPrint({ itemId: item.id }),
      }, h('span.action-icon', '🏷️'), 'Label'),
      h('button.action-btn', {
        onclick: () => { m.close(); itemForm(null, { copyFrom: item }); },
      }, h('span.action-icon', '📄'), 'Duplicate'),
      item.location_id ? h('button.action-btn', {
        onclick: () => { m.close(); location.hash = `#/inventory?location=${item.location_id}`; },
      }, h('span.action-icon', '📍'), 'In location') : null,
      (item.barcode || item.sku) ? h('button.action-btn', {
        onclick: () => copyText(item.barcode || item.sku, item.barcode ? 'Barcode' : 'SKU'),
      }, h('span.action-icon', '📋'), 'Copy code') : null,
      item.category === 'tool' ? h('button.action-btn', {
        onclick: async () => {
          const out = !(item.tool && item.tool.checked_out);
          try {
            await API.updateItem(item.id, { tool: {
              checked_out: out,
              checked_out_at: out ? new Date().toISOString() : null,
            } });
            UI.toast(out ? 'Checked out' : 'Checked in');
            m.close();
            openDetail(item.id);
          } catch (err) {
            UI.toast(err.message, true);
          }
        },
      }, h('span.action-icon', item.tool && item.tool.checked_out ? '↩️' : '🔧'),
         item.tool && item.tool.checked_out ? 'Check in' : 'Check out') : null,
      item.reorder_url ? h('a.action-btn', { href: item.reorder_url, target: '_blank' },
        h('span.action-icon', '🛒'), 'Reorder') : null,
    );

    // ---- Attachments (datasheets/manuals/models)
    const attachmentsEl = h('div');
    const fmtSize = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB'
      : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B';
    const loadAttachments = () => {
      API.listAttachments(item.id).then((files) => {
        attachmentsEl.replaceChildren(
          ...files.map((a) => h('div.activity-row',
            h('a', { href: API.attachmentURL(item.id, a.name), target: '_blank' }, '📎 ' + a.name),
            h('span.activity-time', fmtSize(a.size)),
            h('button.btn.small', { title: 'Remove attachment',
              onclick: async () => {
                const ok = await UI.confirmDialog('Remove attachment', `Remove "${a.name}"?`, 'Remove');
                if (!ok) return;
                try {
                  await API.deleteAttachment(item.id, a.name);
                  loadAttachments();
                } catch (err) { UI.toast(err.message, true); }
              } }, '✕'))),
          files.length ? null : h('div', { style: { color: 'var(--text-faint)', fontSize: '13px' } },
            'No attachments — add datasheets, manuals, or models'),
        );
      }).catch(() => attachmentsEl.replaceChildren());
    };
    loadAttachments();
    const attachInput = h('input', { type: 'file', multiple: true, style: { display: 'none' },
      onchange: async (e) => {
        for (const f of e.target.files) {
          try {
            await API.uploadAttachment(item.id, f);
          } catch (err) {
            UI.toast(`${f.name}: ${err.message}`, true);
          }
        }
        e.target.value = '';
        loadAttachments();
      } });

    // ---- Per-item history timeline (Sortly-style activity log)
    const historyEl = h('div.item-history', h('div.spinner', { style: { margin: '16px auto' } }));
    API.activity({ item_id: item.id, limit: 8 }).then((entries) => {
      if (!entries.length) {
        historyEl.replaceChildren(h('div', { style: { color: 'var(--text-faint)', fontSize: '13px' } }, 'No history yet'));
        return;
      }
      historyEl.replaceChildren(...entries.map((a) => {
        const meta = UI.actionMeta(a.action);
        return h('div.activity-row',
          h('span.activity-action', { style: { color: meta.color } }, meta.label),
          h('span.activity-details', a.details || ''),
          h('span.activity-time', UI.relativeTime(a.timestamp)));
      }));
    }).catch(() => historyEl.replaceChildren());

    const body = h('div',
      item.photo_path ? h('img.detail-photo', { src: API.photoURL(item.id, item.updated_at), alt: item.name }) : null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        item.filament ? UI.swatch(item.filament, true)
          : (item.color_hex ? UI.colorDot(item.color_hex) : null),
        h('div',
          h('div', { style: { fontWeight: 700, fontSize: '18px' } }, item.name,
            item.tool && item.tool.checked_out ? h('span.badge.low', { style: { marginLeft: '8px' } }, 'Checked out') : null),
          h('div', { style: { color: 'var(--text-dim)', fontSize: '13px' } },
            `${UI.categoryIcon(cat)} ${cat ? cat.display_name : item.category}`)),
      ),
      (item.quantity === 0 || (item.min_quantity !== null && item.quantity <= item.min_quantity))
        ? h('div.low-warning', '⚠️',
            item.quantity === 0 ? 'Out of stock' : `Low stock — minimum is ${item.min_quantity}`,
            item.reorder_url ? h('a', { href: item.reorder_url, target: '_blank', style: { marginLeft: 'auto' } },
              `Reorder${item.vendor ? ' from ' + item.vendor : ''} →`) : null)
        : null,
      h('div.detail-qty',
        h('button.qty-btn', { onclick: () => adjust(-1) }, '−'),
        qtyDisplay,
        h('button.qty-btn', { onclick: () => adjust(1) }, '+'),
        h('span', { style: { color: 'var(--text-faint)' } }, item.unit)),
      actions,
      h('div.detail-grid',
        field('Description', item.description),
        field('Brand', item.brand),
        field('SKU', item.sku),
        field('UPC', item.upc),
        field('Barcode', item.barcode),
        field('Location', item.location_id
          ? h('a', { href: `#/inventory?location=${item.location_id}`,
              onclick: () => m.close() }, App.locationPath(item.location_id))
          : null),
        field('Whereabouts', item.whereabouts),
        field('Vendor', item.vendor),
        field('Purchase price', item.purchase_price !== null
          ? (item.pack_quantity > 1
              ? `${UI.money(item.purchase_price)} per ${item.pack_quantity} ${item.unit}`
                + ` (${UI.money(item.unit_cost)} each)`
              : UI.money(item.purchase_price))
          : null),
        field('Stock value', item.unit_cost != null
          ? UI.money(item.unit_cost * item.quantity) : null),
        field('Purchased', item.purchase_date),
        field('Min quantity', item.min_quantity),
        field('Color', item.color),
        item.filament ? [
          field('Material', item.filament.material),
          field('Filament color', item.filament.color),
          field('Diameter', item.filament.diameter ? item.filament.diameter + 'mm' : null),
          field('Spool weight', item.filament.spool_weight ? item.filament.spool_weight + 'g' : null),
          field('Remaining', item.filament.remaining_weight ? Math.round(item.filament.remaining_weight) + 'g' : null),
          field('Status', (FILAMENT_STATUSES.find(([v]) => v === item.filament.status) || [])[1]),
        ] : [],
        field('Notes', item.notes),
        ...Object.entries(item.custom_fields || {}).map(([k, v]) => field(k, String(v))),
      ),
      item.tags && item.tags.length
        ? h('div', item.tags.map((t) => h('span.tag', t)))
        : null,
      item.filament && item.filament.remaining_weight && item.filament.spool_weight
        ? h('div', { style: { margin: '10px 0' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-dim)' } },
              h('span', 'Filament remaining'),
              h('span', `${Math.round(item.filament.remaining_weight)}g / ${Math.round(item.filament.spool_weight)}g`)),
            h('div.slot-meter', h('div.slot-meter-fill', { style: {
              width: Math.max(0, Math.min(100, Math.round(item.filament.remaining_weight / item.filament.spool_weight * 100))) + '%',
            } })))
        : null,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '14px' } },
        h('h3.section-title', { style: { margin: 0 } }, 'Attachments'),
        h('button.btn.small', { onclick: () => attachInput.click() }, '＋ Add')),
      attachInput,
      attachmentsEl,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '14px' } },
        h('h3.section-title', { style: { margin: 0 } }, 'History'),
        h('a', { href: `#/activity?item=${item.id}`, style: { fontSize: '12.5px' },
          onclick: () => m.close() }, 'View all →')),
      historyEl,
      h('div', { style: { marginTop: '12px', color: 'var(--text-faint)', fontSize: '12px' } },
        `Added ${UI.relativeTime(item.created_at)} · Updated ${UI.relativeTime(item.updated_at)}`),
    );

    const m = UI.modal({
      title: 'Item Details',
      body,
      footer: [
        h('button.btn.danger', {
          onclick: async () => {
            const ok = await UI.confirmDialog('Delete item', `Delete "${item.name}"? This cannot be undone.`);
            if (!ok) return;
            try {
              await API.deleteItem(item.id);
              UI.toast('Item deleted');
              m.close();
              refreshList();
            } catch (err) {
              UI.toast(err.message, true);
            }
          },
        }, 'Delete'),
        h('button.btn', { onclick: () => { m.close(); openEditItem(item); } }, 'Edit'),
        h('button.btn.primary', { onclick: () => m.close() }, 'Done'),
      ],
      // Refresh only when the inventory list is actually on screen — the
      // detail modal also opens from the scanner and locations views
      onClose: () => { if (listEl && document.contains(listEl)) refreshList(); },
    });
  }

  // ------------------------------------------------------------------
  // Add / Edit form
  // ------------------------------------------------------------------

  function locationOptions(selectedId) {
    // Indent by depth using the flat list ordered as a tree walk
    const opts = [h('option', { value: '' }, '— No location —')];
    const walk = (nodes, depth) => {
      nodes.forEach((n) => {
        opts.push(h('option', { value: n.id, selected: n.id === selectedId },
          `${' '.repeat(depth * 3)}${n.name}`));
        walk(n.children || [], depth + 1);
      });
    };
    walk(App.state.locationTree, 0);
    return opts;
  }

  function openAddItem(prefill = {}) {
    itemForm(null, prefill);
  }

  function openEditItem(item) {
    itemForm(item);
  }

  function itemForm(item, prefill = {}) {
    const isEdit = !!item;
    // Duplicate: prefill the whole form from an existing item (barcode
    // excluded — those uniquely identify one physical thing)
    const copy = prefill.copyFrom
      ? { ...structuredClone(prefill.copyFrom), name: prefill.copyFrom.name + ' (copy)',
          barcode: null, photo_path: null }
      : null;
    const src = item || copy || {
      name: prefill.name || '',
      category: prefill.category || (filters.category || 'other'),
      quantity: 1, unit: 'pcs', tags: [],
      location_id: prefill.location_id || (filters.location_id || null),
      barcode: prefill.barcode || null,
      sku: prefill.sku || null,
      filament: null,
    };

    const f = {}; // form controls
    const input = (name, type, value, attrs = {}) =>
      (f[name] = h('input', { type, value: value ?? '', ...attrs }));
    const select = (name, options, value) =>
      (f[name] = h('select', options.map(([v, l]) =>
        h('option', { value: v, selected: v === String(value ?? '') }, l))));

    const fld = (label, control) => h('label.field', h('span', label), control);

    // --- General section
    input('name', 'text', src.name, { required: true, placeholder: 'Item name' });
    select('category', App.state.categories.map((c) => [c.key, c.display_name]), src.category);
    input('brand', 'text', src.brand);
    input('sku', 'text', src.sku);
    input('barcode', 'text', src.barcode);
    input('upc', 'text', src.upc);
    input('quantity', 'number', src.quantity, { min: 0 });
    select('unit', UNITS.map((u) => [u, u]), src.unit || 'pcs');
    input('min_quantity', 'number', src.min_quantity, { min: 0, placeholder: 'none' });
    f.location_id = h('select', locationOptions(src.location_id));
    input('color', 'text', src.color, { placeholder: 'e.g. Galaxy Black' });
    input('color_hex', 'text', src.color_hex, { placeholder: '#RRGGBB' });
    f.description = h('textarea', { rows: 2 }, src.description || '');
    f.notes = h('textarea', { rows: 2 }, src.notes || '');
    input('tags', 'text', (src.tags || []).join(', '), { placeholder: 'comma, separated' });

    // --- Custom fields: free-form label/value pairs stored per item
    const customRows = h('div');
    const addCustomRow = (label = '', value = '') => {
      const labelIn = h('input', { type: 'text', value: label, placeholder: 'Field name' });
      const valueIn = h('input', { type: 'text', value, placeholder: 'Value' });
      const row = h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } },
        labelIn, valueIn,
        h('button.btn.small', { type: 'button', title: 'Remove field',
          onclick: () => row.remove() }, '✕'));
      row._custom = { labelIn, valueIn };
      customRows.appendChild(row);
    };
    Object.entries(src.custom_fields || {}).forEach(([k, v]) => addCustomRow(k, String(v)));
    const collectCustomFields = () => {
      const out = {};
      customRows.querySelectorAll(':scope > div').forEach((row) => {
        const label = row._custom.labelIn.value.trim();
        const value = row._custom.valueIn.value.trim();
        if (label) out[label] = value;
      });
      return out;
    };

    // --- Purchase section
    input('vendor', 'text', src.vendor);
    input('purchase_price', 'number', src.purchase_price, { step: '0.01', min: 0 });
    // Pack size: how many units one purchase_price covers. Blank/1 = the
    // price is per unit. Without this a pack price meeting a piece count
    // inflates inventory value (a 2000-pack at $11.49 counted as $22,980).
    input('pack_quantity', 'number', src.pack_quantity, { min: 1, step: '1', placeholder: 'per unit' });
    // Legacy imports stored free-text dates ("Dec.19, 2023") — a date input
    // would render those blank and silently null them on save. Fall back to
    // a text input so the value stays visible and editable.
    {
      const pd = src.purchase_date || '';
      const isoMatch = pd.match(/^\d{4}-\d{2}-\d{2}/);
      if (!pd || (isoMatch && isoMatch[0] === pd)) {
        input('purchase_date', 'date', pd);
      } else if (isoMatch) {
        input('purchase_date', 'date', isoMatch[0]); // trim datetime → date
      } else {
        input('purchase_date', 'text', pd, { placeholder: 'YYYY-MM-DD' });
      }
    }
    input('reorder_url', 'url', src.reorder_url, { placeholder: 'https://…' });

    // --- Filament section
    const fil = src.filament || {};
    const materialOpts = fil.material && !FILAMENT_MATERIALS.includes(fil.material)
      ? [fil.material, ...FILAMENT_MATERIALS] : FILAMENT_MATERIALS;
    select('f_material', materialOpts.map((m) => [m, m]), fil.material || 'PLA');
    select('f_status', FILAMENT_STATUSES, fil.status || 'inStock');
    select('f_color_mode', COLOR_MODES, fil.color_mode || 'solid');
    input('f_color', 'text', fil.color);
    input('f_color_hex', 'text', fil.color_hex, { placeholder: '#RRGGBB' });
    input('f_color_hex2', 'text', fil.color_hex2, { placeholder: '#RRGGBB (2nd)' });
    input('f_diameter', 'number', fil.diameter ?? 1.75, { step: '0.05' });
    input('f_spool_weight', 'number', fil.spool_weight ?? 1000, { step: '1' });
    input('f_remaining_weight', 'number', fil.remaining_weight, { step: '1', placeholder: 'grams' });
    select('f_spool_type', [['withSpool', 'With spool'], ['refill', 'Refill']], fil.spool_type || 'withSpool');

    const filamentSection = h('div',
      h('h3.section-title', { style: { marginTop: '18px' } }, 'Filament'),
      h('div.field-row-3',
        fld('Material', f.f_material),
        fld('Status', f.f_status),
        fld('Spool type', f.f_spool_type)),
      h('div.field-row-3',
        fld('Color name', f.f_color),
        fld('Color mode', f.f_color_mode),
        fld('Hex', f.f_color_hex)),
      h('div.field-row-3',
        fld('Hex 2 (gradient/split)', f.f_color_hex2),
        fld('Diameter (mm)', f.f_diameter),
        fld('Spool weight (g)', f.f_spool_weight)),
      h('div.field-row',
        fld('Remaining (g)', f.f_remaining_weight),
        h('div')),
    );

    const syncFilamentVisibility = () => {
      filamentSection.style.display = f.category.value === 'filament' ? '' : 'none';
    };
    f.category.addEventListener('change', syncFilamentVisibility);

    // --- Photo section
    let photoFile = null;
    let removePhoto = false;
    const photoStatus = h('span.desc', item && item.photo_path ? 'Photo attached' : 'No photo');
    const onPhotoPicked = (e) => {
      photoFile = e.target.files[0] || null;
      removePhoto = false;
      photoStatus.textContent = photoFile ? photoFile.name : 'No photo';
    };
    const photoInput = h('input', {
      type: 'file', accept: 'image/*', style: { display: 'none' },
      onchange: onPhotoPicked,
    });
    // capture="environment" makes iOS open the rear camera directly
    const cameraInput = h('input', {
      type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' },
      onchange: onPhotoPicked,
    });
    const photoSection = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' } },
      photoInput,
      cameraInput,
      h('button.btn.small', { type: 'button', onclick: () => cameraInput.click() }, '📷 Camera'),
      h('button.btn.small', { type: 'button', onclick: () => photoInput.click() }, '🖼 Choose photo'),
      (item && item.photo_path) ? h('button.btn.small.danger', {
        type: 'button',
        onclick: () => { removePhoto = true; photoFile = null; photoStatus.textContent = 'Photo will be removed'; },
      }, 'Remove photo') : null,
      photoStatus,
    );

    // --- Import from a product URL (server-side scrape via api/scrape.php)
    const scrapeUrl = h('input', {
      type: 'url', placeholder: '🔗 Paste a product URL (Bambu Lab store, Amazon…) to pre-fill',
      style: { flex: '1', minWidth: '0' },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); scrapeBtn.click(); } },
    });
    const scrapePreview = h('div');
    const scrapeBtn = h('button.btn.small', {
      type: 'button',
      onclick: async () => {
        const url = scrapeUrl.value.trim();
        if (!url) { UI.toast('Paste a product URL first', true); return; }
        scrapeBtn.disabled = true;
        scrapeBtn.textContent = '…';
        try {
          const p = await API.scrapeProduct(url);
          if (!p.name) throw new Error(p.error || 'No product details found at that URL');
          // Run the shared invoice classifier when the store gave us a
          // title/variant split — same clean names, category, subcategory,
          // pack description, and filament fields the invoice import uses.
          // (typeof check: InvoiceParsers is a top-level const, not a
          // window property)
          const cls = typeof InvoiceParsers !== 'undefined' && p.product_title
            ? InvoiceParsers.classifyProduct(p.product_title, p.variant_name || '')
            : null;
          const filled = [];
          const fill = (el, val, label) => {
            if (val == null || val === '' || String(el.value || '').trim() !== '') return;
            el.value = val;
            filled.push(label);
          };
          fill(f.name, cls ? cls.name : p.name, 'name');
          fill(f.brand, p.brand, 'brand');
          fill(f.vendor, p.vendor, 'vendor');
          fill(f.sku, p.sku, 'SKU');
          fill(f.purchase_price, p.price, 'price');
          // Classified products get the concise description ("Pack of 20"),
          // not the store's marketing paragraph
          fill(f.description, cls ? cls.description : p.description, 'description');
          fill(f.reorder_url, p.product_url || url, 'reorder URL');
          if (cls && !isEdit) {
            if (App.state.categories.some((c) => c.key === cls.category)
              && f.category.value !== cls.category) {
              f.category.value = cls.category;
              filled.push('category');
            }
            if (cls.unit && cls.unit !== 'pcs') f.unit.value = cls.unit;
            const ensureOption = (el, v) => {
              if (v && ![...el.options].some((o) => o.value === v)) el.appendChild(h('option', { value: v }, v));
            };
            if (cls.filament) {
              const cf = cls.filament;
              ensureOption(f.f_material, cf.material);
              if (cf.material) f.f_material.value = cf.material;
              if (cf.color && !f.f_color.value) f.f_color.value = cf.color;
              if (cf.color_hex && !f.f_color_hex.value) f.f_color_hex.value = cf.color_hex;
              if (cf.spool_weight) f.f_spool_weight.value = cf.spool_weight;
              if (cf.spool_type) f.f_spool_type.value = cf.spool_type;
              filled.push('filament');
            }
            syncFilamentVisibility();
          }
          // Photo rides the normal upload path after save (proxied — the
          // store's CDN won't serve cross-origin to the browser)
          if (p.image_url && !photoFile && !removePhoto && !(item && item.photo_path)) {
            try {
              const resp = await fetch(API.scrapeImageURL(p.image_url));
              if (resp.ok) {
                // Downscale to ≤1200px JPEG before upload — product PNGs can
                // exceed PHP's upload_max_filesize, and the server would
                // resize to this anyway
                const bmp = await createImageBitmap(await resp.blob());
                const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(bmp.width * scale));
                canvas.height = Math.max(1, Math.round(bmp.height * scale));
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#fff'; // transparency → white, like the server
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
                const jpeg = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
                if (jpeg) {
                  photoFile = new File([jpeg], 'product.jpg', { type: 'image/jpeg' });
                  photoStatus.textContent = 'Product photo from URL';
                  filled.push('photo');
                }
              }
            } catch (_) { /* photo is best-effort */ }
          }
          scrapePreview.replaceChildren(h('div',
            { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px' } },
            p.image_url ? h('img', { src: API.scrapeImageURL(p.image_url), alt: '',
              style: { width: '54px', height: '54px', objectFit: 'cover', borderRadius: '8px',
                background: 'var(--border)', flexShrink: '0' } }) : null,
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontWeight: 600, fontSize: '13px' } }, p.name),
              h('div.desc', [p.sku, p.price != null ? UI.money(p.price) : null, p.brand]
                .filter(Boolean).join(' · ')))));
          UI.toast(filled.length ? `Filled: ${filled.join(', ')}` : 'Fields already had values — nothing overwritten');
          if (p.error) UI.toast(p.error, true);
        } catch (err) {
          UI.toast(err.message, true);
        } finally {
          scrapeBtn.disabled = false;
          scrapeBtn.textContent = 'Fetch';
        }
      },
    }, 'Fetch');
    const scrapeSection = h('div',
      { style: { marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' } },
      h('div', { style: { display: 'flex', gap: '6px' } }, scrapeUrl, scrapeBtn),
      scrapePreview);

    const body = h('div',
      scrapeSection,
      fld('Name *', f.name),
      h('div.field-row',
        fld('Category', f.category),
        fld('Location', f.location_id)),
      h('div.field-row-3',
        fld('Quantity', f.quantity),
        fld('Unit', f.unit),
        fld('Min quantity', f.min_quantity)),
      h('div.field-row-3',
        fld('Brand', f.brand),
        fld('SKU', f.sku),
        fld('Barcode', h('div', { style: { display: 'flex', gap: '6px' } },
          f.barcode,
          h('button.btn.small', {
            type: 'button', title: 'Generate a MakerVault barcode',
            onclick: async (e) => {
              if (f.barcode.value.trim()) { UI.toast('Item already has a barcode', true); return; }
              e.target.disabled = true;
              try {
                const res = await API.generateBarcode({ category: f.category.value });
                f.barcode.value = res.barcode;
                UI.toast(`Generated ${res.barcode}`);
              } catch (err) {
                UI.toast(err.message, true);
              } finally {
                e.target.disabled = false;
              }
            },
          }, '⚙'))),
      ),
      h('div.field-row-3',
        fld('UPC', f.upc),
        fld('Color name', f.color),
        fld('Color hex', f.color_hex)),
      fld('Description', f.description),
      filamentSection,
      h('h3.section-title', { style: { marginTop: '18px' } }, 'Purchase Info'),
      h('div.field-row-3',
        fld('Vendor', f.vendor),
        fld('Price', f.purchase_price),
        fld('Price covers (pack size)', f.pack_quantity)),
      h('div.field-row',
        fld('Date', f.purchase_date),
        h('div')),
      fld('Reorder URL', f.reorder_url),
      h('h3.section-title', { style: { marginTop: '18px' } }, 'Extras'),
      fld('Tags', f.tags),
      fld('Notes', f.notes),
      h('label.field', h('span', 'Custom fields'),
        customRows,
        h('button.btn.small', { type: 'button', onclick: () => addCustomRow() }, '＋ Add field')),
      photoSection,
    );

    syncFilamentVisibility();

    const save = async () => {
      const name = f.name.value.trim();
      if (!name) { UI.toast('Name is required', true); return; }

      const num = (el) => el.value === '' ? null : Number(el.value);
      const str = (el) => el.value.trim() === '' ? null : el.value.trim();

      const payload = {
        name,
        category: f.category.value,
        brand: str(f.brand), sku: str(f.sku), upc: str(f.upc), barcode: str(f.barcode),
        quantity: Math.max(0, Math.trunc(num(f.quantity) ?? 0)),
        unit: f.unit.value,
        min_quantity: num(f.min_quantity),
        location_id: f.location_id.value || null,
        color: str(f.color), color_hex: str(f.color_hex),
        description: str(f.description), notes: str(f.notes),
        vendor: str(f.vendor),
        purchase_price: num(f.purchase_price),
        pack_quantity: num(f.pack_quantity),
        purchase_date: str(f.purchase_date),
        reorder_url: str(f.reorder_url),
        tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
        custom_fields: collectCustomFields(),
      };
      if (payload.category === 'filament') {
        payload.filament = {
          material: f.f_material.value,
          status: f.f_status.value,
          spool_type: f.f_spool_type.value,
          color: str(f.f_color),
          color_mode: f.f_color_mode.value,
          color_hex: str(f.f_color_hex),
          color_hex2: str(f.f_color_hex2),
          diameter: num(f.f_diameter) ?? 1.75,
          spool_weight: num(f.f_spool_weight),
          remaining_weight: num(f.f_remaining_weight),
        };
      }

      try {
        const saved = isEdit
          ? await API.updateItem(item.id, payload)
          : await API.createItem(payload);

        if (photoFile) {
          await API.uploadPhoto(saved.id, photoFile);
        } else if (removePhoto) {
          await API.deletePhoto(saved.id);
        }

        UI.toast(isEdit ? 'Item updated' : 'Item added');
        m.close();
        refreshList();
      } catch (err) {
        UI.toast(err.message, true);
      }
    };

    const m = UI.modal({
      title: isEdit ? `Edit: ${item.name}` : 'Add Item',
      body,
      wide: true,
      footer: [
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn.primary', { onclick: save }, isEdit ? 'Save Changes' : 'Add Item'),
      ],
    });
  }

  return { render, openAddItem, openEditItem, openDetail };
})();
