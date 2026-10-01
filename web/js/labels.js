/* Label Designer view — template CRUD, line editor, live canvas preview,
   item/location data binding, PNG export, print (single + batch). */

window.Views = window.Views || {};

Views.labels = (() => {
  const { h } = UI;

  const TOKEN_HELP = '{name} {sku} {barcode} {brand} {vendor} {color} {color_hex} '
    + '{quantity} {unit} {category} {description} {location} {location_type}';

  // View state: gallery (template overview) or designer (editing one)
  let mode = 'gallery';
  let templates = [];
  let presets = [];
  let current = null;        // working template object (may be unsaved)
  let boundItem = null;      // item data dict for tokens
  let boundLocation = null;  // location data dict
  let codes = { barcode: false, qr: false, barcodePct: 35, showText: true, qrPct: 30 };
  let previewWrap = null;
  let els = {};              // form controls

  // Sample data so gallery previews show realistic labels without binding
  const SAMPLE_ITEM = {
    name: 'PLA Basic Gradient', brand: 'Bambu Lab', vendor: 'Bambu Lab',
    sku: 'A00-M5-1.75-1000', upc: '', barcode: 'A00-M5-1.75-1000',
    category: 'filament', subcategory: '', description: 'Sample item',
    quantity: 1, unit: 'spools', color: 'Jade White', color_hex: '#8ECFB8',
    color_mode: 'solid', material: 'PLA',
  };
  const SAMPLE_LOCATION = {
    name: 'Rolling Cart 2', type: 'rollingCart',
    qr_code_value: 'makervault://location/sample',
  };

  function blankTemplate() {
    return {
      id: null,
      name: 'New Label',
      width_mm: 48, height_mm: 20,
      background_color: '#FFFFFF',
      border_enabled: true, border_thickness: 0.5, border_color: '#000000',
      padding_mm: 1.0, auto_fit: true,
      lines: [
        { text: '{name}', font_family: 'Inter', font_size: 14, font_weight: 'bold',
          font_color: '#000000', alignment: 'left', background_color: null,
          split: false, split_text: null, text_wrap: false },
      ],
    };
  }

  // ------------------------------------------------------------------

  async function render(main, params) {
    // Router calls pass params — landing on the Labels tab always shows the
    // gallery. Internal re-renders (save, open designer) omit params.
    if (params !== undefined) mode = 'gallery';
    main.replaceChildren(h('div.spinner'));
    try {
      [templates, presets] = await Promise.all([API.listLabelTemplates(), API.listLabelPresets()]);
    } catch (err) {
      main.replaceChildren(h('div.empty-state', h('div.big', '⚠️'), err.message));
      return;
    }
    if (mode === 'designer') renderDesigner(main);
    else renderGallery(main);
  }

  // ------------------------------------------------------------------
  // Template gallery — the Labels landing view: every template as a card
  // with a live preview and Edit / Duplicate / Export / Delete.
  // ------------------------------------------------------------------

  function galleryPreview(t) {
    try {
      const canvas = LabelGen.render({
        template: t, item: SAMPLE_ITEM, location: SAMPLE_LOCATION,
        includeBarcode: false, includeQR: false, dpi: 120,
      });
      canvas.className = 'label-canvas';
      return canvas;
    } catch (_) {
      return h('div', { style: { color: 'var(--text-faint)', fontSize: '12px' } }, 'Preview unavailable');
    }
  }

  function renderGallery(main) {
    const openDesigner = (t) => {
      current = t ? structuredClone(t) : blankTemplate();
      mode = 'designer';
      render(main);
    };

    const cards = templates.map((t) => h('div.template-card',
      h('div.template-card-preview', { onclick: () => openDesigner(t) }, galleryPreview(t)),
      h('div.template-card-meta', { onclick: () => openDesigner(t) },
        h('div', { style: { fontWeight: 600 } }, t.name),
        h('div', { style: { color: 'var(--text-faint)', fontSize: '12px' } },
          `${t.width_mm} × ${t.height_mm} mm · ${t.lines.length} line${t.lines.length === 1 ? '' : 's'}`
          + ` · updated ${UI.relativeTime(t.updated_at)}`)),
      h('div.template-card-actions',
        h('button.btn.small', { onclick: () => openDesigner(t) }, 'Edit'),
        h('button.btn.small', {
          onclick: async () => {
            const copy = { ...structuredClone(t), name: t.name + ' (copy)' };
            delete copy.id;
            try {
              await API.createLabelTemplate(copy);
              UI.toast('Template duplicated');
              render(main);
            } catch (err) { UI.toast(err.message, true); }
          },
        }, 'Duplicate'),
        h('button.btn.small', { onclick: () => exportTemplates([t]) }, 'Export'),
        h('button.btn.small.danger', {
          onclick: async () => {
            const ok = await UI.confirmDialog('Delete template', `Delete "${t.name}"?`);
            if (!ok) return;
            try {
              await API.deleteLabelTemplate(t.id);
              UI.toast('Template deleted');
              render(main);
            } catch (err) { UI.toast(err.message, true); }
          },
        }, 'Delete')),
    ));

    main.replaceChildren(
      h('div.page-header',
        h('div', h('h1', 'Labels'),
          h('div.page-sub', `${templates.length} template${templates.length === 1 ? '' : 's'} — click one to edit, or start fresh`)),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          h('button.btn', { onclick: importTemplates }, '⬆ Import'),
          templates.length ? h('button.btn', { onclick: () => exportTemplates(templates) }, '⬇ Export All') : null,
          h('button.btn', { onclick: (e) => addStarterPack(e.target), title: 'Add common maker label templates (skips ones you already have)' }, '★ Starter Pack'),
          h('button.btn', { onclick: batchPrint }, '🖨 Batch Print'),
          h('button.btn.primary', { onclick: () => openDesigner(null) }, '＋ New Template')),
      ),
      templates.length
        ? h('div.template-grid', cards)
        : h('div.card', h('div.empty-state', h('div.big', '🏷️'),
            'No templates yet — create one or import a template file')),
      h('h3.section-title', { style: { marginTop: '20px' } }, 'Export From PNG Files'),
      (() => {
        const pngInput = h('input', { type: 'file', accept: 'image/png,.lac', multiple: true,
          style: { display: 'none' },
          onchange: (e) => { if (e.target.files.length) openPngExport(e.target.files); e.target.value = ''; } });
        const zone = h('div.card.drop-zone',
          {
            ondragover: (e) => { e.preventDefault(); zone.classList.add('drag'); },
            ondragleave: () => zone.classList.remove('drag'),
            ondrop: (e) => {
              e.preventDefault();
              zone.classList.remove('drag');
              openPngExport(e.dataTransfer.files);
            },
            onclick: () => pngInput.click(),
          },
          h('div.empty-state', { style: { padding: '24px 16px' } },
            h('div.big', '🖼️'),
            h('div', { style: { fontWeight: 600, marginBottom: '4px' } },
              'Drop label PNGs or existing .lac projects here, or click to choose'),
            h('div', { style: { fontSize: '13px' } },
              'Print at exact size, combine into a sheet, or build a Bambu Suite .lac cut project — .lac files bring their labels back in at exact size')),
          pngInput);
        return zone;
      })(),
    );
  }

  // ------------------------------------------------------------------
  // Template file import/export (JSON, compatible with the old FastAPI
  // /label-templates/export format: array of templates with `lines`)
  // ------------------------------------------------------------------

  function exportTemplates(list) {
    const payload = list.map((t) => {
      const { id, created_at, updated_at, ...rest } = structuredClone(t);
      return rest;
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const name = list.length === 1
      ? `label-template-${list[0].name.replace(/[^\w-]+/g, '_')}.json`
      : `makervault-label-templates-${new Date().toISOString().slice(0, 10)}.json`;
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    UI.toast(`Exported ${list.length} template${list.length === 1 ? '' : 's'}`);
  }

  // Curated maker templates from assets/starter_templates.json — creates
  // only the ones whose names don't exist yet (never overwrites)
  async function addStarterPack(btn) {
    btn.disabled = true;
    try {
      const res = await fetch('assets/starter_templates.json');
      if (!res.ok) throw new Error('Starter template pack not found');
      const pack = await res.json();
      const fresh = pack.filter((t) => !templates.some((x) => x.name === t.name));
      if (!fresh.length) {
        UI.toast('All starter templates are already in your library');
        return;
      }
      let created = 0;
      for (const t of fresh) {
        await API.createLabelTemplate(t);
        created++;
      }
      UI.toast(`Added ${created} starter template${created === 1 ? '' : 's'}`);
      render(document.getElementById('main'));
    } catch (err) {
      UI.toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  function importTemplates() {
    const input = h('input', {
      type: 'file', accept: '.json,application/json', style: { display: 'none' },
      onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        let data;
        try {
          data = JSON.parse(await file.text());
        } catch (_) {
          UI.toast('Not a valid JSON file', true);
          return;
        }
        const list = Array.isArray(data) ? data : [data];
        const valid = list.filter((t) => t && t.name && t.width_mm && t.height_mm);
        if (!valid.length) {
          UI.toast('No label templates found in this file', true);
          return;
        }

        // Same-name templates get updated (matches the old server behavior)
        const collisions = valid.filter((t) => templates.some((x) => x.name === t.name));
        if (collisions.length) {
          const ok = await UI.confirmDialog('Import templates',
            `${valid.length} template(s) in file — ${collisions.length} share a name with an existing template and will be OVERWRITTEN. Continue?`,
            'Import');
          if (!ok) return;
        }

        let created = 0;
        let updated = 0;
        let failed = 0;
        for (const t of valid) {
          const payload = {
            name: t.name, width_mm: t.width_mm, height_mm: t.height_mm,
            background_color: t.background_color ?? '#FFFFFF',
            border_enabled: !!t.border_enabled,
            border_thickness: t.border_thickness ?? 0.5,
            border_color: t.border_color ?? '#000000',
            padding_mm: t.padding_mm ?? 1.0,
            auto_fit: t.auto_fit !== false,
            lines: t.lines || [],
          };
          try {
            const existing = templates.find((x) => x.name === t.name);
            if (existing) {
              await API.updateLabelTemplate(existing.id, payload);
              updated++;
            } else {
              await API.createLabelTemplate(payload);
              created++;
            }
          } catch (_) {
            failed++;
          }
        }
        UI.toast(`Imported: ${created} new, ${updated} updated`
          + (failed ? `, ${failed} failed` : ''), !!failed);
        render(document.getElementById('main'));
      },
    });
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  }

  // ------------------------------------------------------------------
  // Designer (edit mode)
  // ------------------------------------------------------------------

  function renderDesigner(main) {
    if (!current) current = blankTemplate();

    previewWrap = h('div.label-preview-wrap');

    main.replaceChildren(
      h('div.page-header',
        h('div',
          h('div', { style: { marginBottom: '4px' } },
            h('a', { href: '#/labels', onclick: (e) => {
              e.preventDefault();
              mode = 'gallery';
              render(main);
            }, style: { fontSize: '13px' } }, '← All templates')),
          h('h1', current.id ? `Edit: ${current.name}` : 'New Template'),
          h('div.page-sub', 'Design, preview, and print labels for items and locations')),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button.btn', { onclick: batchPrint }, '🖨 Batch Print'),
          h('button.btn.primary', { onclick: saveTemplate }, '💾 Save Template')),
      ),
      h('div.label-layout',
        h('div', buildControls()),
        h('div',
          h('div.card',
            h('h3.section-title', 'Preview'),
            previewWrap,
            h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
              h('button.btn', { onclick: () => exportPNG() }, '⬇ PNG (300 DPI)'),
              h('button.btn', { onclick: () => printLabels([currentRenderOpts()]) }, '🖨 Print'),
            ),
          ),
          h('div.card', { style: { marginTop: '16px' } },
            h('h3.section-title', 'Label Data'),
            buildDataBinding()),
        ),
      ),
    );

    refreshPreview();
  }

  // ------------------------------------------------------------------
  // Controls column
  // ------------------------------------------------------------------

  function buildControls() {
    els = {};

    const presetSelect = h('select', {
      onchange: (e) => {
        const p = presets.find((x) => x.id === e.target.value);
        if (p) {
          current.width_mm = p.width_mm;
          current.height_mm = p.height_mm;
          els.width.value = p.width_mm;
          els.height.value = p.height_mm;
          refreshPreview();
        }
        e.target.value = '';
      },
    },
      h('option', { value: '' }, 'Apply size preset…'),
      presets.map((p) => h('option', { value: p.id }, `${p.name} (${p.width_mm}×${p.height_mm})`)),
    );

    const bind = (key, control, parse = (v) => v) => {
      control.addEventListener('input', () => {
        current[key] = parse(control.type === 'checkbox' ? control.checked : control.value);
        refreshPreview();
      });
      return control;
    };

    els.name = bind('name', h('input', { type: 'text', value: current.name }));
    els.width = bind('width_mm', h('input', { type: 'number', step: '0.1', min: 5, value: current.width_mm }), Number);
    els.height = bind('height_mm', h('input', { type: 'number', step: '0.1', min: 5, value: current.height_mm }), Number);
    els.padding = bind('padding_mm', h('input', { type: 'number', step: '0.1', min: 0, value: current.padding_mm }), Number);
    els.bg = bind('background_color', h('input', { type: 'color', value: current.background_color || '#FFFFFF' }));
    els.borderOn = bind('border_enabled', h('input', { type: 'checkbox', checked: current.border_enabled }));
    els.borderColor = bind('border_color', h('input', { type: 'color', value: current.border_color || '#000000' }));
    els.autoFit = bind('auto_fit', h('input', { type: 'checkbox', checked: current.auto_fit }));

    const fld = (label, control) => h('label.field', h('span', label), control);
    const check = (label, control) => h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' } }, control, label);

    const linesWrap = h('div');
    const redrawLines = () => {
      linesWrap.replaceChildren(...current.lines.map((line, i) => lineEditor(line, i, redrawLines)));
    };
    redrawLines();

    // Barcode / QR controls
    const bcToggle = h('input', { type: 'checkbox', checked: codes.barcode,
      oninput: (e) => { codes.barcode = e.target.checked; refreshPreview(); } });
    const bcSlider = h('input', { type: 'range', min: 15, max: 70, value: codes.barcodePct,
      oninput: (e) => { codes.barcodePct = Number(e.target.value); refreshPreview(); } });
    const bcText = h('input', { type: 'checkbox', checked: codes.showText,
      oninput: (e) => { codes.showText = e.target.checked; refreshPreview(); } });
    const qrToggle = h('input', { type: 'checkbox', checked: codes.qr,
      oninput: (e) => { codes.qr = e.target.checked; refreshPreview(); } });
    const qrSlider = h('input', { type: 'range', min: 15, max: 50, value: codes.qrPct,
      oninput: (e) => { codes.qrPct = Number(e.target.value); refreshPreview(); } });

    return h('div',
      h('div.card',
        h('h3.section-title', 'Template'),
        fld('Name', els.name),
        h('div.field-row-3',
          fld('Width (mm)', els.width),
          fld('Height (mm)', els.height),
          fld('Padding (mm)', els.padding)),
        h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '12px' } },
          h('div', { style: { flex: 1 } }, presetSelect),
          h('button.btn.small', { onclick: managePresets, title: 'Manage size presets' }, '⚙')),
        h('div.field-row-3',
          fld('Background', els.bg),
          fld('Border color', els.borderColor),
          h('div',
            check('Border', els.borderOn),
            check('Auto-fit text', els.autoFit))),
        current.id ? h('button.btn.small.danger', { onclick: deleteTemplate }, 'Delete template') : null,
      ),
      h('div.card', { style: { marginTop: '16px' } },
        h('h3.section-title', 'Lines'),
        h('div', { style: { fontSize: '11.5px', color: 'var(--text-faint)', marginBottom: '10px' } },
          'Tokens: ' + TOKEN_HELP),
        linesWrap,
        h('button.btn.small', {
          onclick: () => {
            current.lines.push({ text: '', font_family: 'Inter', font_size: 10,
              font_weight: 'regular', font_color: '#000000', alignment: 'left',
              background_color: null, split: false, split_text: null, text_wrap: false });
            redrawLines();
            refreshPreview();
          },
        }, '＋ Add line'),
      ),
      h('div.card', { style: { marginTop: '16px' } },
        h('h3.section-title', 'Barcode & QR'),
        check('Include barcode (item barcode/SKU/UPC)', bcToggle),
        h('div.field-row',
          fld('Barcode height %', bcSlider),
          check('Text below barcode', bcText)),
        check('Include QR (location)', qrToggle),
        fld('QR size %', qrSlider),
      ),
    );
  }

  function lineEditor(line, index, redrawLines) {
    const upd = (key, parse = (v) => v) => (e) => {
      line[key] = parse(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      refreshPreview();
    };

    return h('div.line-editor',
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        h('input', { type: 'text', value: line.text || '', placeholder: 'Text or {token}',
          style: { flex: 1 }, oninput: upd('text') }),
        h('button.qty-btn', { title: 'Move up', disabled: index === 0,
          onclick: () => { [current.lines[index - 1], current.lines[index]] = [current.lines[index], current.lines[index - 1]]; redrawLines(); refreshPreview(); } }, '↑'),
        h('button.qty-btn', { title: 'Move down', disabled: index === current.lines.length - 1,
          onclick: () => { [current.lines[index + 1], current.lines[index]] = [current.lines[index], current.lines[index + 1]]; redrawLines(); refreshPreview(); } }, '↓'),
        h('button.qty-btn', { title: 'Remove line',
          onclick: () => { current.lines.splice(index, 1); redrawLines(); refreshPreview(); } }, '✕')),
      h('div.line-editor-row',
        h('input', { type: 'number', min: 4, max: 72, step: 0.5, value: line.font_size ?? 12,
          title: 'Font size (pt)', style: { width: '64px' }, oninput: upd('font_size', Number) }),
        h('select', { oninput: upd('font_weight') },
          h('option', { value: 'regular', selected: line.font_weight !== 'bold' }, 'Regular'),
          h('option', { value: 'bold', selected: line.font_weight === 'bold' }, 'Bold')),
        h('select', { oninput: upd('alignment') },
          ['left', 'center', 'right'].map((a) =>
            h('option', { value: a, selected: (line.alignment || 'center') === a }, a))),
        h('input', { type: 'color', value: line.font_color || '#000000', title: 'Text color',
          oninput: upd('font_color') }),
        h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center', fontSize: '12px' } },
          h('input', { type: 'checkbox', checked: !!line.background_color,
            oninput: (e) => { line.background_color = e.target.checked ? '#000000' : null; redrawLines(); refreshPreview(); } }),
          'BG',
          line.background_color !== null && line.background_color !== undefined
            ? h('input', { type: 'color', value: line.background_color || '#000000',
                oninput: upd('background_color') })
            : null),
        h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center', fontSize: '12px' } },
          h('input', { type: 'checkbox', checked: !!line.text_wrap, oninput: upd('text_wrap') }), 'Wrap'),
        h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center', fontSize: '12px' } },
          h('input', { type: 'checkbox', checked: !!line.split,
            oninput: (e) => { line.split = e.target.checked; redrawLines(); refreshPreview(); } }), 'Split')),
      line.split
        ? h('input', { type: 'text', value: line.split_text || '', placeholder: 'Right-side text or {token}',
            style: { marginTop: '6px' }, oninput: upd('split_text') })
        : null,
    );
  }

  // ------------------------------------------------------------------
  // Data binding
  // ------------------------------------------------------------------

  function buildDataBinding() {
    const itemStatus = h('span.desc', boundItem ? boundItem.name : 'No item bound');
    const locStatus = h('span.desc', boundLocation ? boundLocation.name : 'No location bound');

    // Always in the DOM, shown whenever an item is bound (it used to render
    // only if the item was bound BEFORE the panel built — binding via the
    // search left no way to clear)
    const clearBtn = h('button.btn.small', {
      style: { marginLeft: '8px', display: boundItem ? '' : 'none' },
      onclick: () => {
        boundItem = null;
        itemStatus.textContent = 'No item bound';
        clearBtn.style.display = 'none';
        refreshPreview();
      },
    }, 'Clear');

    const itemSearch = h('input', {
      type: 'search', placeholder: 'Search items to bind…',
      oninput: UI.debounce(async (e) => {
        const q = e.target.value.trim();
        results.replaceChildren();
        if (q.length < 2) return;
        const items = await API.listItems({ query: q, limit: 8 });
        results.replaceChildren(...items.map((it) =>
          h('button.chip', {
            onclick: async () => {
              boundItem = await API.labelItemData(it.id);
              itemStatus.textContent = boundItem.name;
              clearBtn.style.display = '';
              results.replaceChildren();
              itemSearch.value = '';
              refreshPreview();
            },
          }, it.name)));
      }, 250),
    });
    const results = h('div.chip-row', { style: { marginTop: '6px' } });

    const locOpts = [h('option', { value: '' }, '— Bind a location —')];
    const walk = (nodes, depth) => nodes.forEach((n) => {
      locOpts.push(h('option', { value: n.id }, `${' '.repeat(depth * 3)}${n.name}`));
      walk(n.children || [], depth + 1);
    });
    walk(App.state.locationTree, 0);

    const locSelect = h('select', {
      onchange: async (e) => {
        boundLocation = e.target.value ? await API.labelLocationData(e.target.value) : null;
        locStatus.textContent = boundLocation ? boundLocation.name : 'No location bound';
        refreshPreview();
      },
    }, locOpts);

    return h('div',
      h('div', { style: { marginBottom: '4px' } }, itemStatus, clearBtn),
      itemSearch, results,
      h('div', { style: { margin: '12px 0 4px' } }, locStatus),
      locSelect,
    );
  }

  // ------------------------------------------------------------------
  // Preview / output
  // ------------------------------------------------------------------

  function currentRenderOpts(dpi = 150) {
    return {
      template: current,
      item: boundItem,
      location: boundLocation,
      includeBarcode: codes.barcode,
      includeQR: codes.qr,
      barcodeHeightPercent: codes.barcodePct,
      barcodeShowText: codes.showText,
      qrSizePercent: codes.qrPct,
      dpi,
    };
  }

  const refreshPreview = UI.debounce(() => {
    if (!previewWrap) return;
    try {
      const canvas = LabelGen.render(currentRenderOpts(150));
      canvas.className = 'label-canvas';
      previewWrap.replaceChildren(
        canvas,
        h('div', { style: { color: 'var(--text-faint)', fontSize: '12px', marginTop: '6px' } },
          `${current.width_mm} × ${current.height_mm} mm`),
      );
    } catch (err) {
      previewWrap.replaceChildren(h('div.empty-state', '⚠️ ' + err.message));
    }
  }, 120);

  /** Manage the label size presets (name + dimensions). */
  function managePresets() {
    const listEl = h('div');
    const nameIn = h('input', { type: 'text', placeholder: 'Preset name' });
    const wIn = h('input', { type: 'number', step: '0.1', min: 5, placeholder: 'W mm', style: { width: '90px' } });
    const hIn = h('input', { type: 'number', step: '0.1', min: 5, placeholder: 'H mm', style: { width: '90px' } });

    const redraw = () => {
      listEl.replaceChildren(...presets.map((p) =>
        h('div.settings-row',
          h('div', h('div', p.name), h('div.desc', `${p.width_mm} × ${p.height_mm} mm`)),
          h('button.btn.small.danger', {
            onclick: async () => {
              try {
                await API.deleteLabelPreset(p.id);
                presets = presets.filter((x) => x.id !== p.id);
                redraw();
              } catch (err) { UI.toast(err.message, true); }
            },
          }, 'Delete'))));
      if (!presets.length) listEl.replaceChildren(h('div.empty-state', 'No presets yet'));
    };
    redraw();

    const m = UI.modal({
      title: 'Label Size Presets',
      body: h('div',
        listEl,
        h('h3.section-title', { style: { marginTop: '14px' } }, 'Add preset'),
        h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
          h('div', { style: { flex: 1 } }, nameIn), wIn, hIn,
          h('button.btn.small.primary', {
            onclick: async () => {
              const name = nameIn.value.trim();
              const w = Number(wIn.value);
              const hgt = Number(hIn.value);
              if (!name || !w || !hgt) { UI.toast('Name, width, and height required', true); return; }
              try {
                const created = await API.createLabelPreset({ name, width_mm: w, height_mm: hgt });
                presets.push(created);
                nameIn.value = ''; wIn.value = ''; hIn.value = '';
                redraw();
              } catch (err) { UI.toast(err.message, true); }
            },
          }, 'Add'))),
      footer: [h('button.btn.primary', {
        onclick: () => { m.close(); renderDesigner(document.getElementById('main')); },
      }, 'Done')],
    });
  }

  async function saveTemplate() {
    if (!current.name.trim()) { UI.toast('Template needs a name', true); return; }
    try {
      const payload = { ...current };
      delete payload.id;
      const saved = current.id
        ? await API.updateLabelTemplate(current.id, payload)
        : await API.createLabelTemplate(payload);
      current = structuredClone(saved);
      UI.toast('Template saved');
      render(document.getElementById('main'));
    } catch (err) {
      UI.toast(err.message, true);
    }
  }

  async function deleteTemplate() {
    const ok = await UI.confirmDialog('Delete template', `Delete "${current.name}"?`);
    if (!ok) return;
    try {
      await API.deleteLabelTemplate(current.id);
      current = null;
      mode = 'gallery';
      UI.toast('Template deleted');
      render(document.getElementById('main'));
    } catch (err) {
      UI.toast(err.message, true);
    }
  }

  function exportPNG() {
    try {
      const canvas = LabelGen.render(currentRenderOpts(300));
      const a = h('a', {
        href: canvas.toDataURL('image/png'),
        download: `label-${(boundItem?.name || current.name).replace(/[^\w-]+/g, '_')}.png`,
      });
      a.click();
    } catch (err) {
      UI.toast(err.message, true);
    }
  }

  /** Open a print window with labels at exact physical size (CSS mm units).
   * Entries are LabelGen render opts, or pre-rendered {canvas, w_mm, h_mm}. */
  function printLabels(optsList) {
    let imgs;
    try {
      imgs = optsList.map((o) => {
        if (o.canvas) return { data: o.canvas.toDataURL('image/png'), w: o.w_mm, h: o.h_mm };
        const canvas = LabelGen.render({ ...o, dpi: 300 });
        return { data: canvas.toDataURL('image/png'), w: o.template.width_mm, h: o.template.height_mm };
      });
    } catch (err) {
      UI.toast(err.message, true);
      return;
    }
    const win = window.open('', '_blank');
    if (!win) { UI.toast('Popup blocked — allow popups to print', true); return; }
    win.document.write(`<!DOCTYPE html><html><head><title>MakerVault Labels</title>
      <style>
        @page { margin: 5mm; }
        body { margin: 0; font-family: sans-serif; }
        img { display: block; margin: 0 0 3mm 0; }
      </style></head><body>
      ${imgs.map((i) => `<img src="${i.data}" style="width:${i.w}mm;height:${i.h}mm">`).join('')}
      <script>window.onload = () => setTimeout(() => window.print(), 250);<\/script>
      </body></html>`);
    win.document.close();
  }

  // ------------------------------------------------------------------
  // Shared export helpers (print sheet composition, .lac download)
  // ------------------------------------------------------------------

  const canvasToBlob = (c) => new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));

  /** Lay canvases out on a white sheet — shelf-packed so mixed label sizes
   * sit tightly in rows instead of a uniform largest-label grid. */
  function composeSheetCanvas(canvases) {
    const gap = 12;
    const area = canvases.reduce((a, c) => a + (c.width + gap) * (c.height + gap), 0);
    const targetW = Math.max(...canvases.map((c) => c.width + 2 * gap), Math.ceil(Math.sqrt(area)));
    const order = [...canvases].sort((a, b) => (b.height - a.height) || (b.width - a.width));
    const pos = [];
    let x = gap, y = gap, rowH = 0, usedW = 0;
    for (const c of order) {
      if (x > gap && x + c.width + gap > targetW) {
        x = gap;
        y += rowH + gap;
        rowH = 0;
      }
      pos.push([c, x, y]);
      x += c.width + gap;
      rowH = Math.max(rowH, c.height);
      usedW = Math.max(usedW, x);
    }
    const sheet = document.createElement('canvas');
    sheet.width = usedW;
    sheet.height = y + rowH + gap;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    pos.forEach(([c, px, py]) => ctx.drawImage(c, px, py));
    return sheet;
  }

  /** Build and download a Bambu Suite project from label entries
   * ({name, canvas, pngBytes, wPx, hPx, wMm, hMm}). */
  async function downloadLac(entries, filename) {
    const configs = await LabelExport.fetchConfigs();
    // Thumbnail: the first label, downscaled — cosmetic only
    const first = entries[0].canvas;
    const ts = Math.min(1, 480 / first.width);
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(first.width * ts));
    thumb.height = Math.max(1, Math.round(first.height * ts));
    thumb.getContext('2d').drawImage(first, 0, 0, thumb.width, thumb.height);
    const thumbBytes = new Uint8Array(await (await canvasToBlob(thumb)).arrayBuffer());

    const { blob, sheets } = LabelExport.buildLac(entries, configs, thumbBytes);
    const url = URL.createObjectURL(blob);
    h('a', { href: url, download: filename }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    UI.toast(`Bambu Suite project exported — ${entries.length} label${entries.length === 1 ? '' : 's'}`
      + (sheets > 1 ? ` across ${sheets} A4 sheets (one plate each)` : ''));
  }

  // ------------------------------------------------------------------
  // Export from existing PNG files — drop already-generated label PNGs
  // and print / sheet / .lac them without rebuilding from templates.
  // Sizes assume the PNGs are 300 dpi exports (editable in the dialog).
  // ------------------------------------------------------------------

  async function openPngExport(fileList) {
    const pngFiles = [...fileList].filter((f) => f.type === 'image/png' || /\.png$/i.test(f.name));
    const lacFiles = [...fileList].filter((f) => /\.lac$/i.test(f.name));
    if (!pngFiles.length && !lacFiles.length) { UI.toast('Drop PNG or .lac files', true); return; }

    const bytesToCanvas = async (bytes) => {
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext('2d').drawImage(bmp, 0, 0);
      return canvas;
    };

    let entries = [];
    try {
      entries = await Promise.all(pngFiles.map(async (f) => {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const canvas = await bytesToCanvas(bytes);
        return { name: f.name.replace(/\.png$/i, ''), pngBytes: bytes, canvas,
          wPx: canvas.width, hPx: canvas.height, wMm: 0, hMm: 0, fixedMm: false };
      }));
      // .lac files carry their labels' exact mm sizes — the dpi field
      // doesn't apply to them
      for (const f of lacFiles) {
        const labels = await LabelExport.readLac(await f.arrayBuffer());
        for (const l of labels) {
          entries.push({ ...l, canvas: await bytesToCanvas(l.pngBytes), fixedMm: true });
        }
      }
    } catch (err) {
      UI.toast('Could not read a file: ' + err.message, true);
      return;
    }

    const sizeNote = h('div.desc');
    const applyDpi = (dpi) => {
      entries.forEach((e) => {
        if (e.fixedMm) return;
        e.wMm = (e.wPx / dpi) * 25.4;
        e.hMm = (e.hPx / dpi) * 25.4;
      });
      sizeNote.textContent = entries.length === 1
        ? `${entries[0].wMm.toFixed(1)} × ${entries[0].hMm.toFixed(1)} mm`
        : `${entries.length} labels, e.g. ${entries[0].wMm.toFixed(1)} × ${entries[0].hMm.toFixed(1)} mm`;
    };
    const dpiInput = h('input', { type: 'number', min: 72, value: 300, style: { width: '90px' },
      oninput: (e) => applyDpi(Math.max(72, Number(e.target.value) || 300)) });
    applyDpi(300);

    const listEl = h('div', { style: { maxHeight: '30vh', overflowY: 'auto' } },
      entries.map((e) => h('div.activity-row',
        h('span.activity-details', e.name),
        h('span.activity-time', `${e.wPx}×${e.hPx}px`))));

    const stamp = () => new Date().toISOString().slice(0, 10);
    const m = UI.modal({
      title: `Export ${entries.length} PNG label${entries.length === 1 ? '' : 's'}`,
      body: h('div',
        listEl,
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '12px' } },
          h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } },
            'PNG resolution (dpi)', dpiInput),
          sizeNote)),
      footer: [
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn', {
          onclick: () => {
            h('a', { href: composeSheetCanvas(entries.map((e) => e.canvas)).toDataURL('image/png'),
              download: `labels-sheet-${entries.length}-${stamp()}.png` }).click();
          },
        }, '⬇ PNG sheet'),
        h('button.btn', {
          onclick: async (e) => {
            const btn = e.target;
            btn.disabled = true;
            try {
              await downloadLac(entries, `makervault-labels-${stamp()}.lac`);
            } catch (err) {
              UI.toast(err.message, true);
            } finally {
              btn.disabled = false;
            }
          },
          title: 'Bambu Suite print-then-cut project (A4 vinyl sticker sheet)',
        }, '⬇ .lac'),
        h('button.btn.primary', {
          onclick: () => {
            m.close();
            printLabels(entries.map((e) => ({ canvas: e.canvas, w_mm: e.wMm, h_mm: e.hMm })));
          },
        }, '🖨 Print'),
      ],
    });
  }

  // ------------------------------------------------------------------
  // Batch print
  // ------------------------------------------------------------------

  async function batchPrint() {
    const selected = new Map(); // id -> item
    const listEl = h('div.item-list', { style: { maxHeight: '40vh', overflowY: 'auto' } });
    const countEl = h('span.desc', '0 selected');
    const copiesInput = h('input', { type: 'number', min: 1, value: 1, style: { width: '70px' } });

    const search = h('input', {
      type: 'search', placeholder: 'Search items…',
      oninput: UI.debounce(async (e) => loadRows(e.target.value.trim()), 250),
    });

    async function loadRows(q) {
      const items = await API.listItems({ query: q, limit: 50 });
      listEl.replaceChildren(...items.map((it) => {
        const cb = h('input', { type: 'checkbox', checked: selected.has(it.id),
          onclick: (e) => {
            e.stopPropagation();
            if (e.target.checked) selected.set(it.id, it); else selected.delete(it.id);
            countEl.textContent = `${selected.size} selected`;
          } });
        return h('div.item-row', { onclick: () => cb.click() }, cb,
          h('div.item-main', h('div.item-name', it.name),
            h('div.item-sub', [it.brand, it.sku].filter(Boolean).join(' · '))));
      }));
    }
    loadRows('');

    const m = UI.modal({
      title: 'Batch Print Labels',
      wide: true,
      body: h('div',
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' } },
          h('div', { style: { flex: 1 } }, search), countEl,
          h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } },
            'Copies', copiesInput)),
        listEl),
      footer: [
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn.primary', {
          onclick: async () => {
            if (!selected.size) { UI.toast('Select at least one item', true); return; }
            const copies = Math.max(1, Number(copiesInput.value) || 1);
            const optsList = [];
            for (const id of selected.keys()) {
              const data = await API.labelItemData(id);
              for (let c = 0; c < copies; c++) {
                optsList.push({ ...currentRenderOpts(), item: data, location: boundLocation });
              }
            }
            m.close();
            printLabels(optsList);
          },
        }, '🖨 Print Selected'),
      ],
    });
  }

  // ------------------------------------------------------------------
  // Quick print — a compact modal usable from the item detail sheet and
  // the locations panel (Sortly/Homebox-style "print label from the thing").
  // Remembers the last template used per binding kind.
  // ------------------------------------------------------------------

  const FALLBACK_ITEM_TEMPLATE = {
    name: 'Quick Item Label', width_mm: 48, height_mm: 20,
    background_color: '#FFFFFF', border_enabled: true, border_thickness: 0.5,
    border_color: '#000000', padding_mm: 1.0, auto_fit: true,
    lines: [
      { text: '{name}', font_size: 13, font_weight: 'bold', alignment: 'left', font_color: '#000000' },
      { text: '{brand}', font_size: 9, alignment: 'left', font_color: '#666666' },
    ],
  };
  const FALLBACK_LOCATION_TEMPLATE = {
    name: 'Quick Location Label', width_mm: 48, height_mm: 25,
    background_color: '#FFFFFF', border_enabled: true, border_thickness: 0.5,
    border_color: '#000000', padding_mm: 1.0, auto_fit: true,
    lines: [
      { text: '{location}', font_size: 15, font_weight: 'bold', alignment: 'left', font_color: '#000000' },
      { text: '{location_type}', font_size: 9, alignment: 'left', font_color: '#666666' },
    ],
  };

  /**
   * Open the quick-print modal.
   * binding: { itemId } or { locationId }
   */
  async function quickPrint(binding) {
    const kind = binding.itemId ? 'item' : 'location';
    let item = null;
    let location = null;
    let templateList = [];
    try {
      [templateList, item, location] = await Promise.all([
        API.listLabelTemplates(),
        binding.itemId ? API.labelItemData(binding.itemId) : null,
        binding.locationId ? API.labelLocationData(binding.locationId) : null,
      ]);
      // An item's QR encodes its location — bind it so the toggle works
      if (item && !location && item.location_id) {
        location = await API.labelLocationData(item.location_id);
      }
    } catch (err) {
      UI.toast(err.message, true);
      return;
    }

    const fallback = kind === 'item' ? FALLBACK_ITEM_TEMPLATE : FALLBACK_LOCATION_TEMPLATE;
    const lastKey = `mv-quick-template-${kind}`;
    let template = templateList.find((t) => t.id === localStorage.getItem(lastKey))
      || templateList[0] || fallback;

    const qp = {
      barcode: kind === 'item' && !!(item && (item.barcode || item.sku || item.upc)),
      qr: kind === 'location',
      qrContent: 'location', // item labels can encode the item itself instead
    };
    const copies = h('input', { type: 'number', min: 1, value: 1, style: { width: '70px' } });
    const previewWrapQ = h('div.label-preview-wrap');

    const opts = (dpi) => ({
      template, item, location,
      includeBarcode: qp.barcode, includeQR: qp.qr,
      qrValue: (kind === 'item' && qp.qrContent === 'item' && item)
        ? `makervault://item/${item.id}` : null,
      barcodeHeightPercent: 35, barcodeShowText: true, qrSizePercent: 32,
      dpi,
    });

    const redraw = () => {
      try {
        const canvas = LabelGen.render(opts(150));
        canvas.className = 'label-canvas';
        previewWrapQ.replaceChildren(canvas,
          h('div', { style: { color: 'var(--text-faint)', fontSize: '12px', marginTop: '6px' } },
            `${template.width_mm} × ${template.height_mm} mm — ${template.name}`));
      } catch (err) {
        previewWrapQ.replaceChildren(h('div.empty-state', '⚠️ ' + err.message));
      }
    };

    const templateSel = h('select', {
      onchange: (e) => {
        template = templateList.find((t) => t.id === e.target.value) || fallback;
        if (template.id) localStorage.setItem(lastKey, template.id);
        redraw();
      },
    },
      templateList.map((t) => h('option', { value: t.id, selected: t.id === template.id },
        `${t.name} (${t.width_mm}×${t.height_mm}mm)`)),
      h('option', { value: '', selected: !template.id }, `${fallback.name} (built-in)`),
    );

    const check = (label, key) => h('label', {
      style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' } },
      h('input', { type: 'checkbox', checked: qp[key],
        oninput: (e) => { qp[key] = e.target.checked; redraw(); } }),
      label);

    redraw();

    // Item labels: choose what the QR encodes — the item itself (scan →
    // opens its sheet) or the location it lives in
    const qrContentSel = kind === 'item' ? h('select', {
      onchange: (e) => { qp.qrContent = e.target.value; redraw(); },
      style: { width: 'auto' },
    },
      h('option', { value: 'location', disabled: !location },
        location ? `Location (${location.name})` : 'Location (none bound)'),
      h('option', { value: 'item', selected: !location }, 'This item'),
    ) : null;
    if (kind === 'item' && !location) qp.qrContent = 'item';

    const subject = kind === 'item' ? item.name : location.name;
    const m = UI.modal({
      title: `Print Label — ${subject}`,
      body: h('div',
        h('label.field', h('span', 'Template'), templateSel),
        kind === 'item' ? check('Barcode (item barcode/SKU/UPC)', 'barcode') : null,
        check('QR code', 'qr'),
        qrContentSel ? h('label.field', h('span', 'QR encodes'), qrContentSel) : null,
        h('label.field', h('span', 'Copies'), copies),
        previewWrapQ),
      footer: [
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn', {
          onclick: () => {
            const canvas = LabelGen.render(opts(300));
            const a = h('a', { href: canvas.toDataURL('image/png'),
              download: `label-${subject.replace(/[^\w-]+/g, '_')}.png` });
            a.click();
          },
        }, '⬇ PNG'),
        h('button.btn.primary', {
          onclick: () => {
            const n = Math.max(1, Number(copies.value) || 1);
            m.close();
            printLabels(Array.from({ length: n }, () => opts(300)));
          },
        }, '🖨 Print'),
      ],
    });
  }

  /**
   * Print labels for many ITEMS in one job — the bulk-bar action on the
   * inventory's select mode. Same compact controls as quickPrint (template
   * picker with last-used memory, barcode/QR toggles, copies), previewing
   * the first selected item; each label renders with its own item data and
   * bound location.
   */
  async function quickPrintItemBatch(itemIds) {
    if (!itemIds || !itemIds.length) { UI.toast('Select at least one item', true); return; }
    let templateList = [];
    let items = [];
    const locById = new Map();
    try {
      [templateList, items] = await Promise.all([
        API.listLabelTemplates(),
        Promise.all(itemIds.map((id) => API.labelItemData(id))),
      ]);
      const locIds = [...new Set(items.map((it) => it.location_id).filter(Boolean))];
      await Promise.all(locIds.map(async (lid) => {
        locById.set(lid, await API.labelLocationData(lid));
      }));
    } catch (err) {
      UI.toast(err.message, true);
      return;
    }

    const lastKey = 'mv-quick-template-item';
    let template = templateList.find((t) => t.id === localStorage.getItem(lastKey))
      || templateList[0] || FALLBACK_ITEM_TEMPLATE;

    const qp = { barcode: true, qr: false, qrContent: 'location' };
    const copies = h('input', { type: 'number', min: 1, value: 1, style: { width: '70px' } });
    const previewWrapB = h('div.label-preview-wrap');

    const optsFor = (it, dpi) => ({
      template,
      item: it,
      location: it.location_id ? locById.get(it.location_id) || null : null,
      // Skip the barcode on items that have no code rather than failing the job
      includeBarcode: qp.barcode && !!(it.barcode || it.sku || it.upc),
      includeQR: qp.qr,
      qrValue: qp.qrContent === 'item' ? `makervault://item/${it.id}` : null,
      barcodeHeightPercent: 35, barcodeShowText: true, qrSizePercent: 32,
      dpi,
    });

    const redraw = () => {
      try {
        const canvas = LabelGen.render(optsFor(items[0], 150));
        canvas.className = 'label-canvas';
        previewWrapB.replaceChildren(canvas,
          h('div', { style: { color: 'var(--text-faint)', fontSize: '12px', marginTop: '6px' } },
            `${template.width_mm} × ${template.height_mm} mm — ${template.name}`
            + ` · previewing "${items[0].name}"`));
      } catch (err) {
        previewWrapB.replaceChildren(h('div.empty-state', '⚠️ ' + err.message));
      }
    };

    const templateSel = h('select', {
      onchange: (e) => {
        template = templateList.find((t) => t.id === e.target.value) || FALLBACK_ITEM_TEMPLATE;
        if (template.id) localStorage.setItem(lastKey, template.id);
        redraw();
      },
    },
      templateList.map((t) => h('option', { value: t.id, selected: t.id === template.id },
        `${t.name} (${t.width_mm}×${t.height_mm}mm)`)),
      h('option', { value: '', selected: !template.id }, `${FALLBACK_ITEM_TEMPLATE.name} (built-in)`),
    );

    const check = (label, key) => h('label', {
      style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' } },
      h('input', { type: 'checkbox', checked: qp[key],
        oninput: (e) => { qp[key] = e.target.checked; redraw(); } }),
      label);

    const qrContentSel = h('select', {
      onchange: (e) => { qp.qrContent = e.target.value; redraw(); },
      style: { width: 'auto' },
    },
      h('option', { value: 'location' }, "Each item's location"),
      h('option', { value: 'item' }, 'The item itself'),
    );

    redraw();

    const stamp = () => new Date().toISOString().slice(0, 10);

    // One composite PNG: every label (× copies) on a white sheet, laid out
    // in a near-A4-proportioned grid at print resolution (300 dpi)
    const exportSheet = () => {
      try {
        const n = Math.max(1, Number(copies.value) || 1);
        const canvases = items.flatMap((it) =>
          Array.from({ length: n }, () => LabelGen.render(optsFor(it, 300))));
        h('a', { href: composeSheetCanvas(canvases).toDataURL('image/png'),
          download: `labels-sheet-${canvases.length}-${stamp()}.png` }).click();
      } catch (err) {
        UI.toast(err.message, true);
      }
    };

    // Bambu Suite print-then-cut project (see js/labexport.js)
    const exportLac = async (btn) => {
      btn.disabled = true;
      try {
        const n = Math.max(1, Number(copies.value) || 1);
        const list = items.flatMap((it) =>
          Array.from({ length: n }, () => ({ it, canvas: LabelGen.render(optsFor(it, 300)) })));
        const entries = await Promise.all(list.map(async ({ it, canvas }) => ({
          name: it.name, canvas,
          pngBytes: new Uint8Array(await (await canvasToBlob(canvas)).arrayBuffer()),
          wPx: canvas.width, hPx: canvas.height,
          wMm: template.width_mm, hMm: template.height_mm,
        })));
        await downloadLac(entries, `makervault-labels-${stamp()}.lac`);
      } catch (err) {
        UI.toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    };

    // One PNG per item (for label-printer apps). Copies are skipped —
    // duplicate files add nothing. Browsers may ask to allow multiple
    // downloads on the first run.
    const exportEach = async () => {
      try {
        for (const it of items) {
          const canvas = LabelGen.render(optsFor(it, 300));
          h('a', { href: canvas.toDataURL('image/png'),
            download: `label-${(it.name || it.id).replace(/[^\w-]+/g, '_').slice(0, 60)}.png` }).click();
          // Pace the downloads so the browser doesn't drop any
          await new Promise((r) => setTimeout(r, 350));
        }
        UI.toast(`Exported ${items.length} PNG${items.length === 1 ? '' : 's'}`);
      } catch (err) {
        UI.toast(err.message, true);
      }
    };

    const m = UI.modal({
      title: `Print Labels — ${items.length} item${items.length === 1 ? '' : 's'}`,
      body: h('div',
        h('label.field', h('span', 'Template'), templateSel),
        check('Barcode (item barcode/SKU/UPC)', 'barcode'),
        check('QR code', 'qr'),
        h('label.field', h('span', 'QR encodes'), qrContentSel),
        h('label.field', h('span', 'Copies of each'), copies),
        previewWrapB),
      footer: [
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn', { onclick: exportSheet, title: 'All labels on one PNG sheet' }, '⬇ PNG sheet'),
        h('button.btn', { onclick: exportEach, title: 'One PNG file per item' }, '⬇ PNGs'),
        h('button.btn', { onclick: (e) => exportLac(e.target),
          title: 'Bambu Suite print-then-cut project (A4 vinyl sticker sheet)' }, '⬇ .lac'),
        h('button.btn.primary', {
          onclick: () => {
            const n = Math.max(1, Number(copies.value) || 1);
            const optsList = items.flatMap((it) =>
              Array.from({ length: n }, () => optsFor(it, 300)));
            m.close();
            printLabels(optsList);
          },
        }, `🖨 Print ${items.length} label${items.length === 1 ? '' : 's'}`),
      ],
    });
  }

  /**
   * Print QR labels for many locations in one job (location + descendants).
   * Uses the last-used location template, falling back to the built-in.
   */
  async function printLocationBatch(locationIds) {
    try {
      const [templateList, ...locations] = await Promise.all([
        API.listLabelTemplates(),
        ...locationIds.map((id) => API.labelLocationData(id)),
      ]);
      const template = templateList.find((t) => t.id === localStorage.getItem('mv-quick-template-location'))
        || FALLBACK_LOCATION_TEMPLATE;
      printLabels(locations.map((loc) => ({
        template, item: null, location: loc,
        includeBarcode: false, includeQR: true,
        barcodeHeightPercent: 35, barcodeShowText: true, qrSizePercent: 32,
        dpi: 300,
      })));
    } catch (err) {
      UI.toast(err.message, true);
    }
  }

  return { render, quickPrint, quickPrintItemBatch, printLocationBatch };
})();
