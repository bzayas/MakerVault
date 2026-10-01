/* BOM Checker view — Makerworld/CyberBrick BOM .xlsx vs inventory.
 * SheetJS (lazy-loaded) parses the workbook client-side, porting
 * parsers/makerworld_bom.py; api/bom.php does the 3-tier matching. */

window.Views = window.Views || {};

Views.bom = (() => {
  const { h } = UI;

  const STATUS_META = {
    in_stock: ['badge ok', '✓ In stock'],
    partial: ['badge low', '◐ Partial'],
    out_of_stock: ['badge out', '✗ Out of stock'],
    not_found: ['badge out', '? Not found'],
  };
  const MATCH_LABEL = { sku_exact: 'SKU', name_exact: 'Name', name_fuzzy: 'Fuzzy' };

  let resultEl = null;
  let filter = 'all';
  let lastResult = null;

  // ------------------------------------------------------------------
  // SheetJS loading + BOM parsing (ports parse_bom)
  // ------------------------------------------------------------------

  let xlsxLoading = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    if (xlsxLoading) return xlsxLoading;
    xlsxLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/xlsx.min.js?v=5';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load the spreadsheet engine'));
      document.head.appendChild(s);
    });
    return xlsxLoading;
  }

  const FILAMENT_PREFIXES = ['a0', 'a1', 'g0', 'g1', 'u0', 'p0', 'f0'];

  async function parseBOMFile(file) {
    await loadXLSX();
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('Excel file has no sheets');

    // Rows as arrays; row 0 is the header
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) throw new Error('Empty spreadsheet');

    const header = rows[0].map((c) => String(c).toLowerCase().trim());
    const col = (name, fallback) => {
      const i = header.indexOf(name);
      return i >= 0 ? i : fallback;
    };
    if (!header.includes('name') || !header.includes('quantity')) {
      throw new Error('Unexpected BOM format — needs at least "Name" and "Quantity" columns');
    }

    const modelIdCol = col('model id', 0);
    const productIdCol = col('product id', 2);
    const nameCol = col('name', 3);
    const qtyCol = col('quantity', 4);
    const noteCol = col('note', 5);

    const items = [];
    for (let r = 1; r < rows.length; r++) {
      const name = String(rows[r][nameCol] ?? '').trim();
      if (!name) continue;
      const productId = String(rows[r][productIdCol] ?? '').trim();
      const qty = parseInt(rows[r][qtyCol], 10) || 1;
      items.push({
        product_id: productId,
        name,
        quantity: qty,
        note: String(rows[r][noteCol] ?? '').trim(),
        is_filament: FILAMENT_PREFIXES.some((p) => productId.toLowerCase().startsWith(p)),
      });
    }

    // Project name from filename: "BOM_Tower Crane - CyberBrick _20260407.xlsx"
    let project = file.name.replace(/^BOM_/, '').replace(/\.(xlsx|xls)$/i, '');
    project = project.replace(/_\d{8}$/, '').trim().replace(/[-_]+$/, '').trim();

    return {
      project_name: project || 'BOM',
      model_id: rows[1] ? String(rows[1][modelIdCol] ?? '') || null : null,
      items,
    };
  }

  // ------------------------------------------------------------------
  // View
  // ------------------------------------------------------------------

  async function render(main) {
    resultEl = h('div');

    const fileInput = h('input', {
      type: 'file',
      accept: '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      style: { display: 'none' },
      onchange: (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); },
    });

    const dropZone = h('div.card.drop-zone',
      {
        ondragover: (e) => { e.preventDefault(); dropZone.classList.add('drag'); },
        ondragleave: () => dropZone.classList.remove('drag'),
        ondrop: (e) => {
          e.preventDefault();
          dropZone.classList.remove('drag');
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        },
        onclick: () => fileInput.click(),
      },
      h('div.empty-state',
        h('div.big', '📋'),
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'Drop a Makerworld BOM (.xlsx) here, or click to choose'),
        h('div', { style: { fontSize: '13px' } }, 'Checks every part against your inventory — exact SKU, exact name, then fuzzy matching')),
      fileInput,
    );

    main.replaceChildren(
      h('div.page-header',
        h('div', h('h1', 'BOM Checker'),
          h('div.page-sub', 'Do I have the parts for this build?'))),
      dropZone,
      resultEl,
    );

    if (lastResult) renderResult();
  }

  async function handleFile(file) {
    resultEl.replaceChildren(h('div.card', { style: { marginTop: '16px' } }, h('div.spinner')));
    try {
      const bom = await parseBOMFile(file);
      if (!bom.items.length) {
        resultEl.replaceChildren(h('div.card', { style: { marginTop: '16px' } },
          h('div.empty-state', 'No BOM rows found in this file')));
        return;
      }
      lastResult = await API.checkBOM(bom);
      filter = 'all';
      renderResult();
    } catch (err) {
      resultEl.replaceChildren(h('div.card', { style: { marginTop: '16px' } }, '⚠️ ' + err.message));
    }
  }

  function renderResult() {
    const r = lastResult;
    const s = r.summary;
    const pct = s.total ? Math.round(((s.in_stock) / s.total) * 100) : 0;

    const chip = (value, label, count) =>
      h('button.chip' + (filter === value ? '.active' : ''), {
        onclick: () => { filter = value; renderResult(); },
      }, `${label} (${count})`);

    const filtered = r.items.filter((it) => {
      if (filter === 'all') return true;
      if (filter === 'have') return it.status === 'in_stock';
      if (filter === 'missing') return it.status !== 'in_stock';
      if (filter === 'filament') return it.is_filament;
      return true;
    });

    const hardware = filtered.filter((it) => !it.is_filament);
    const filament = filtered.filter((it) => it.is_filament);

    const section = (title, items) => !items.length ? null : h('div',
      h('h3.section-title', { style: { marginTop: '14px' } }, `${title} (${items.length})`),
      h('div.item-list', items.map(rowFor)));

    resultEl.replaceChildren(
      h('div.card', { style: { marginTop: '16px' } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' } },
          h('strong', { style: { fontSize: '17px' } }, r.project_name),
          h('span.desc', `${s.total} parts`),
          h('span', { className: pct === 100 ? 'badge ok' : (pct >= 60 ? 'badge low' : 'badge out') },
            `${pct}% ready`)),
        h('div.slot-meter', { style: { margin: '10px 0' } },
          h('div.slot-meter-fill', { style: { width: pct + '%' } })),
        h('div.chip-row',
          chip('all', 'All', s.total),
          chip('have', 'In stock', s.in_stock),
          chip('missing', 'Missing/short', s.partial + s.missing),
          chip('filament', 'Filament', r.items.filter((i) => i.is_filament).length)),
        section('Hardware', hardware),
        section('Filament', filament),
      ),
    );
  }

  function rowFor(it) {
    const [badgeCls, badgeLabel] = STATUS_META[it.status] || STATUS_META.not_found;
    return h('div.item-row', {
      onclick: it.matched_item_id ? () => Views.inventory.openDetail(it.matched_item_id) : undefined,
      style: it.matched_item_id ? {} : { cursor: 'default' },
    },
      h('div.item-main',
        h('div.item-name', it.bom_name, ' ', h('span', { className: badgeCls }, badgeLabel)),
        h('div.item-sub', [
          it.bom_product_id,
          `need ${it.bom_quantity}`,
          it.matched_item_id
            ? `have ${it.matched_quantity} ${it.matched_unit || ''} — ${it.matched_item_name}`
            : null,
          it.match_type ? `${MATCH_LABEL[it.match_type]}${it.match_type === 'name_fuzzy' ? ` ${Math.round(it.confidence * 100)}%` : ''} match` : null,
          it.quantity_short > 0 && it.status !== 'not_found' ? `short ${it.quantity_short}` : null,
        ].filter(Boolean).join(' · ')),
        it.bom_note ? h('div.item-sub', { style: { color: 'var(--text-faint)' } }, it.bom_note) : null),
      !it.matched_item_id
        ? h('button.btn.small', {
            onclick: (e) => {
              e.stopPropagation();
              Views.inventory.openAddItem({ name: it.bom_name, sku: it.bom_product_id });
            },
          }, '＋ Add')
        : null,
    );
  }

  return { render };
})();
