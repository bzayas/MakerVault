/* Import view — PDF invoice import (Bambu Lab + Amazon).
 * pdf.js extracts text lines client-side, InvoiceParsers builds line items,
 * a review table lets you edit/exclude before committing to import.php. */

window.Views = window.Views || {};

Views.import = (() => {
  const { h } = UI;

  let parsed = null;      // ParsedInvoice from InvoiceParsers
  let reviewEl = null;

  // ------------------------------------------------------------------
  // pdf.js text extraction: rebuild reading-order lines per page by
  // grouping text items on their y coordinate (PyMuPDF equivalent).
  // ------------------------------------------------------------------

  let pdfjsLoading = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve();
    if (pdfjsLoading) return pdfjsLoading;
    pdfjsLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/pdf.min.js?v=3';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js?v=3';
        resolve();
      };
      s.onerror = () => reject(new Error('Failed to load the PDF engine'));
      document.head.appendChild(s);
    });
    return pdfjsLoading;
  }

  async function extractLines(file) {
    await loadPdfJs();
    const data = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    // Shared with the parsers (and their test harness): returns
    // {lines, cells, pages} — pages carry x/y/font for the geometry parser
    return InvoiceParsers.extractFromPdf(pdf);
  }

  // ------------------------------------------------------------------
  // View
  // ------------------------------------------------------------------

  async function render(main) {
    reviewEl = h('div');

    const fileInput = h('input', {
      type: 'file', accept: 'application/pdf', style: { display: 'none' },
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
          if (f && f.type === 'application/pdf') handleFile(f);
          else UI.toast('Drop a PDF file', true);
        },
        onclick: () => fileInput.click(),
      },
      h('div.empty-state',
        h('div.big', '📄'),
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'Drop an invoice PDF here, or click to choose'),
        h('div', { style: { fontSize: '13px' } }, 'Bambu Lab invoices/order pages and Amazon order summaries')),
      fileInput,
    );

    const batchesEl = h('div');
    const kitsEl = h('div');

    main.replaceChildren(
      h('div.page-header',
        h('div', h('h1', 'Import'),
          h('div.page-sub', 'Import items from a PDF invoice or a hardware kit'))),
      dropZone,
      reviewEl,
      h('div', { style: { marginTop: '20px' } },
        h('h3.section-title', 'Hardware Kits'),
        kitsEl),
      h('div', { style: { marginTop: '20px' } },
        h('h3.section-title', 'Recent Imports'),
        batchesEl),
    );

    loadKits(kitsEl);

    try {
      const batches = await API.listImportBatches();
      batchesEl.replaceChildren(
        batches.length
          ? h('div.card', batches.slice(0, 10).map((b) =>
              h('div.activity-row',
                h('span.activity-action', b.vendor || b.source),
                h('span.activity-details',
                  `${b.item_count} item(s)${b.order_number ? ' · order ' + b.order_number : ''}${b.grand_total ? ' · ' + UI.money(b.grand_total) : ''}`),
                h('span.activity-time', UI.relativeTime(b.imported_at)))))
          : h('div.card', h('div.empty-state', 'No imports yet')),
      );
    } catch (_) { /* non-critical */ }
  }

  // ------------------------------------------------------------------
  // Hardware kits (CyberBrick etc. — definitions in assets/cyberbrick_kits.json)
  // ------------------------------------------------------------------

  async function loadKits(kitsEl) {
    try {
      const res = await fetch('assets/cyberbrick_kits.json');
      const data = await res.json();
      const kits = data.kits || [];
      kitsEl.replaceChildren(
        h('div.card', kits.map((kit) =>
          h('div.settings-row',
            h('div',
              h('div', kit.kit_name),
              h('div.desc', `${kit.brand} · ${kit.items.length} component types` +
                (kit.kit_sku ? ` · ${kit.kit_sku}` : ''))),
            h('button.btn', { onclick: () => openKit(kit) }, 'Import kit')))),
      );
    } catch (_) {
      kitsEl.replaceChildren(h('div.card', h('div.empty-state', 'No kit definitions found')));
    }
  }

  function openKit(kit) {
    // Reuse the invoice review flow: a kit is just a pre-parsed "invoice"
    parsed = {
      source: 'kit',
      vendor: kit.brand || 'Kit',
      order_number: kit.kit_sku || null,
      order_date: null,
      invoice_number: null,
      grand_total: null,
      line_items: kit.items.map((ki) => ({
        name: ki.name,
        category: ki.category || 'makersupply',
        brand: kit.brand || null,
        sku: null,
        quantity: ki.quantity || 1,
        unit: ki.unit || 'pcs',
        unit_price: null,
        line_total: null,
        subcategory: null,
        vendor: kit.brand || null,
        purchase_date: null,
        description: `Kit: ${kit.kit_name}`,
        filament: null,
        warnings: [],
      })),
    };
    renderReview();
    reviewEl.scrollIntoView({ behavior: 'smooth' });
  }

  async function handleFile(file) {
    reviewEl.replaceChildren(h('div.card', h('div.spinner'),
      h('div', { style: { textAlign: 'center', color: 'var(--text-dim)' } }, `Reading ${file.name}…`)));
    try {
      const lines = await extractLines(file);
      parsed = InvoiceParsers.parse(lines);
      if (!parsed.line_items.length) {
        reviewEl.replaceChildren(h('div.card', h('div.empty-state',
          h('div.big', '🤔'),
          'No line items recognized in this PDF. If this is a Bambu Lab or Amazon invoice, the layout may be new — export the text and open an issue in the project doc.')));
        return;
      }
      renderReview();
    } catch (err) {
      reviewEl.replaceChildren(h('div.card', '⚠️ ' + err.message));
    }
  }

  function renderReview() {
    const inv = parsed;
    const include = inv.line_items.map(() => true);

    // A parser category that isn't a real category key would leave the
    // select showing an arbitrary first option — pin unknowns to "other"
    const validKeys = new Set(App.state.categories.map((c) => c.key));
    inv.line_items.forEach((li) => { if (!validKeys.has(li.category)) li.category = 'other'; });

    const locOpts = [h('option', { value: '' }, '— No default location —')];
    const walk = (nodes, depth) => nodes.forEach((n) => {
      locOpts.push(h('option', { value: n.id }, `${' '.repeat(depth * 3)}${n.name}`));
      walk(n.children || [], depth + 1);
    });
    walk(App.state.locationTree, 0);
    const locSelect = h('select', locOpts);

    const strategySelect = h('select',
      h('option', { value: 'create' }, 'Always create new items'),
      h('option', { value: 'update' }, 'Add quantity to existing duplicates'),
      h('option', { value: 'skip' }, 'Skip duplicates'));
    // Kits re-imported over time should top up quantities, not duplicate
    if (inv.source === 'kit') strategySelect.value = 'update';

    const catOptions = () => App.state.categories.map((c) => [c.key, c.display_name]);

    const rows = inv.line_items.map((li, idx) => {
      const cb = h('input', { type: 'checkbox', checked: true,
        onchange: (e) => { include[idx] = e.target.checked; } });
      const nameInput = h('input', { type: 'text', value: li.name,
        oninput: (e) => { li.name = e.target.value; } });
      const catSelect = h('select', { onchange: (e) => { li.category = e.target.value; } },
        catOptions().map(([v, l]) => h('option', { value: v, selected: v === li.category }, l)));
      const qtyInput = h('input', { type: 'number', min: 0, value: li.quantity,
        style: { width: '70px' },
        oninput: (e) => { li.quantity = Math.max(0, parseInt(e.target.value || '0', 10)); } });
      const priceInput = h('input', { type: 'number', step: '0.01', min: 0,
        value: li.unit_price ?? '', style: { width: '90px' },
        oninput: (e) => { li.unit_price = e.target.value === '' ? null : Number(e.target.value); } });

      return h('div.import-row',
        h('div.import-row-main',
          cb,
          li.filament ? UI.swatch(li.filament) : null,
          h('div', { style: { flex: 1, minWidth: 0 } },
            nameInput,
            h('div', { style: { fontSize: '12px', color: 'var(--text-faint)', marginTop: '2px' } },
              [li.sku, li.description,
                li.quantity > 1 && li.line_total != null ? `line ${UI.money(li.line_total)}` : null,
                li.discount ? `−${UI.money(li.discount)} off list ${UI.money(li.list_price)}` : null,
              ].filter(Boolean).join(' · ') || null),
            li.warnings && li.warnings.length
              ? h('div', { style: { fontSize: '12px', color: 'var(--orange)' } }, '⚠ ' + li.warnings.join('; '))
              : null)),
        h('div.import-row-controls', catSelect, qtyInput, priceInput),
      );
    });

    reviewEl.replaceChildren(
      h('div.card', { style: { marginTop: '16px' } },
        h('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'baseline', marginBottom: '12px' } },
          h('strong', inv.vendor || inv.source),
          inv.order_number ? h('span.desc', `Order ${inv.order_number}`) : null,
          inv.order_date ? h('span.desc', inv.order_date) : null,
          inv.items_subtotal ? h('span.desc', `Subtotal ${UI.money(inv.items_subtotal)}`) : null,
          inv.grand_total ? h('span.desc', `Total ${UI.money(inv.grand_total)}`) : null,
          h('span.desc', `${inv.line_items.length} line item(s)`)),
        inv.warnings && inv.warnings.length
          ? h('div', { style: { background: 'color-mix(in srgb, var(--orange) 12%, transparent)',
              border: '1px solid var(--orange)', borderRadius: '8px', padding: '10px 12px',
              marginBottom: '12px', fontSize: '13px', color: 'var(--orange)' } },
              inv.warnings.map((w) => h('div', '⚠ ' + w)))
          : null,
        h('div.field-row',
          h('label.field', h('span', 'Default location'), locSelect),
          h('label.field', h('span', 'If an item already exists'), strategySelect)),
        h('div', rows),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' } },
          h('button.btn', { onclick: () => { parsed = null; reviewEl.replaceChildren(); } }, 'Cancel'),
          h('button.btn.primary', {
            onclick: async (e) => {
              const btn = e.target;
              const items = inv.line_items.filter((_, i) => include[i]);
              if (!items.length) { UI.toast('Nothing selected to import', true); return; }
              btn.disabled = true;
              try {
                const result = await API.confirmImport({
                  source: inv.source, vendor: inv.vendor,
                  order_number: inv.order_number, order_date: inv.order_date,
                  invoice_number: inv.invoice_number, grand_total: inv.grand_total,
                  default_location_id: locSelect.value || null,
                  duplicate_strategy: strategySelect.value,
                  items,
                });
                const s = result.stats;
                UI.toast(`Imported: ${s.created} created, ${s.updated} updated, ${s.skipped} skipped`);
                parsed = null;
                render(document.getElementById('main'));
              } catch (err) {
                UI.toast(err.message, true);
              } finally {
                btn.disabled = false;
              }
            },
          }, '📥 Import Selected')),
      ),
    );
  }

  return { render };
})();
