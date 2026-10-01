/* Printers view — AMS units and external spool slots per printer, with
   filament swatches and load/unload workflows. */

window.Views = window.Views || {};

Views.printers = (() => {
  const { h } = UI;

  const AMS_LABEL = {
    amsLite: 'AMS Lite',
    ams2Pro: 'AMS 2 Pro',
    amsHT: 'AMS HT',
    externalManual: 'External Spool',
  };

  let listEl = null;

  async function render(main) {
    listEl = h('div', h('div.spinner'));
    main.replaceChildren(
      h('div.page-header',
        h('div', h('h1', 'Printers'),
          h('div.page-sub', 'AMS slots and loaded filament')),
        h('button.btn.primary', { onclick: () => printerForm(null) }, '＋ Add Printer')),
      listEl,
    );
    await refresh();
  }

  async function refresh() {
    try {
      const printers = await API.listPrinters();
      if (!printers.length) {
        listEl.replaceChildren(h('div.empty-state', h('div.big', '🖨️'), 'No printers yet'));
        return;
      }
      listEl.replaceChildren(...printers.map(printerCard));
    } catch (err) {
      listEl.replaceChildren(h('div.empty-state', '⚠️ ' + err.message));
    }
  }

  function printerCard(printer) {
    // Group slots into units: "amsLite #1", "amsHT #2", "external"
    const units = new Map();
    for (const slot of printer.slots) {
      const key = `${slot.ams_type}-${slot.ams_unit_number}`;
      if (!units.has(key)) units.set(key, { type: slot.ams_type, unit: slot.ams_unit_number, slots: [] });
      units.get(key).slots.push(slot);
    }

    const unitBlocks = [...units.values()].map((u) => {
      const label = AMS_LABEL[u.type] || u.type;
      const multi = [...units.values()].filter((x) => x.type === u.type).length > 1;
      return h('div.ams-unit',
        h('div.ams-unit-title', `${label}${multi ? ` #${u.unit}` : ''}`),
        h('div.slot-grid', u.slots.map((s) => slotCell(s, printer))),
      );
    });

    return h('div.card', { style: { marginBottom: '16px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' } },
        h('span', { style: { fontSize: '22px' } }, '🖨️'),
        h('div', { style: { flex: 1 } },
          h('div', { style: { fontWeight: 700, fontSize: '17px' } }, printer.name),
          h('div', { style: { color: 'var(--text-dim)', fontSize: '13px' } }, printer.model)),
        h('button.btn.small', { onclick: () => addUnitDialog(printer) }, '＋ AMS / slot'),
        h('button.btn.small', { onclick: () => printerForm(printer) }, 'Edit'),
        h('button.btn.small.danger', { onclick: () => deletePrinter(printer) }, 'Delete')),
      printer.notes ? h('p', { style: { color: 'var(--text-dim)', margin: '0 0 10px' } }, printer.notes) : null,
      unitBlocks,
    );
  }

  /** Add an AMS unit (or external spool holder) to an existing printer. */
  function addUnitDialog(printer) {
    const UNIT_TYPES = [
      ['amsLite', 'AMS Lite', 4],
      ['ams2Pro', 'AMS 2 Pro', 4],
      ['amsHT', 'AMS HT', 1],
      ['externalManual', 'External spool', 1],
    ];
    const m = UI.modal({
      title: `Add to ${printer.name}`,
      body: h('div',
        h('div', { style: { color: 'var(--text-dim)', fontSize: '13px', marginBottom: '12px' } },
          'Pick what to add — slots are created automatically.'),
        h('div.chip-row', UNIT_TYPES.map(([type, label, slotCount]) =>
          h('button.chip', {
            onclick: async (e) => {
              e.target.disabled = true;
              const unitNumber = Math.max(0, ...printer.slots
                .filter((s) => s.ams_type === type)
                .map((s) => s.ams_unit_number)) + 1;
              try {
                for (let n = 1; n <= slotCount; n++) {
                  await API.addPrinterSlot(printer.id, {
                    ams_type: type, ams_unit_number: unitNumber, slot_number: n,
                  });
                }
                UI.toast(`Added ${label}${unitNumber > 1 ? ' #' + unitNumber : ''}`);
                m.close();
                refresh();
              } catch (err) {
                UI.toast(err.message, true);
                e.target.disabled = false;
              }
            },
          }, `${AMS_LABEL[type]} (${slotCount} slot${slotCount === 1 ? '' : 's'})`))),
      ),
      footer: [h('button.btn', { onclick: () => m.close() }, 'Cancel')],
    });
  }

  function slotCell(slot, printer) {
    const fil = slot.filament;
    const title = slot.name || `Slot ${slot.slot_number}`;

    if (!fil) {
      return h('div.slot-cell.empty', { onclick: () => loadDialog(slot, printer) },
        h('div.slot-title', title),
        h('div.slot-swatch-empty', '＋'),
        h('div.slot-sub', 'Empty — tap to load'));
    }

    const pct = fil.remaining_weight && fil.spool_weight
      ? Math.max(0, Math.min(100, Math.round(fil.remaining_weight / fil.spool_weight * 100)))
      : null;

    return h('div.slot-cell', { onclick: () => slotDialog(slot, printer) },
      h('div.slot-title', title),
      UI.swatch(fil, true),
      h('div.slot-sub',
        h('div', { style: { fontWeight: 600, color: 'var(--text)' } }, fil.material),
        h('div', fil.color || fil.name),
        pct !== null ? h('div.slot-meter', h('div.slot-meter-fill', { style: { width: pct + '%' } })) : null,
        pct !== null ? h('div', `${Math.round(fil.remaining_weight)}g (${pct}%)`) : null),
    );
  }

  // ------------------------------------------------------------------

  async function loadDialog(slot, printer) {
    const listBox = h('div.item-list', { style: { maxHeight: '45vh', overflowY: 'auto' } }, h('div.spinner'));
    const search = h('input', {
      type: 'search', placeholder: 'Search filament…',
      oninput: UI.debounce((e) => loadRows(e.target.value.trim()), 250),
    });

    async function loadRows(q) {
      const items = await API.listItems({ query: q, category: 'filament', limit: 60 });
      const available = items.filter((it) => it.filament && it.filament.status !== 'empty');
      listBox.replaceChildren(...available.map((it) =>
        h('div.item-row', {
          onclick: async () => {
            try {
              await API.loadFilament(slot.id, it.id);
              UI.toast(`Loaded ${it.name}`);
              m.close();
              refresh();
            } catch (err) {
              UI.toast(err.message, true);
            }
          },
        },
          h('div.item-thumb', UI.swatch(it.filament)),
          h('div.item-main',
            h('div.item-name', it.name),
            h('div.item-sub', [
              it.filament.material, it.filament.color,
              it.filament.status !== 'inStock' ? '⚠ currently loaded elsewhere' : App.locationName(it.location_id),
            ].filter(Boolean).join(' · '))))));
      if (!available.length) listBox.replaceChildren(h('div.empty-state', 'No filament found'));
    }
    loadRows('');

    const m = UI.modal({
      title: `Load ${slot.name || 'Slot ' + slot.slot_number} — ${printer.name}`,
      body: h('div', search, h('div', { style: { height: '10px' } }), listBox),
      footer: [
        h('button.btn.small.danger', {
          onclick: async () => {
            const ok = await UI.confirmDialog('Delete slot',
              `Remove ${slot.name || 'slot ' + slot.slot_number} from ${printer.name}?`);
            if (!ok) return;
            try {
              await API.deletePrinterSlot(slot.id);
              UI.toast('Slot removed');
              m.close();
              refresh();
            } catch (err) {
              UI.toast(err.message, true);
            }
          },
        }, 'Delete slot'),
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
      ],
    });
  }

  function slotDialog(slot, printer) {
    const fil = slot.filament;

    const locOpts = [h('option', { value: '' }, 'Return to home location (default)')];
    const walk = (nodes, depth) => nodes.forEach((n) => {
      locOpts.push(h('option', { value: n.id }, `${' '.repeat(depth * 3)}${n.name}`));
      walk(n.children || [], depth + 1);
    });
    walk(App.state.locationTree, 0);
    const returnSelect = h('select', locOpts);

    const m = UI.modal({
      title: `${slot.name || 'Slot ' + slot.slot_number} — ${printer.name}`,
      body: h('div',
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px' } },
          UI.swatch(fil, true),
          h('div',
            h('div', { style: { fontWeight: 700 } }, fil.name),
            h('div', { style: { color: 'var(--text-dim)', fontSize: '13px' } },
              [fil.material, fil.color].filter(Boolean).join(' · ')),
            fil.remaining_weight ? h('div', { style: { color: 'var(--text-dim)', fontSize: '13px' } },
              `${Math.round(fil.remaining_weight)}g remaining`) : null)),
        h('label.field', h('span', 'Unload destination'), returnSelect),
      ),
      footer: [
        h('button.btn', { onclick: () => { m.close(); Views.inventory.openDetail(fil.id); } }, 'Item details'),
        h('button.btn', { onclick: () => { m.close(); loadDialog(slot, printer); } }, 'Swap spool'),
        h('button.btn.primary', {
          onclick: async () => {
            try {
              await API.unloadFilament(slot.id, returnSelect.value || null);
              UI.toast('Unloaded');
              m.close();
              refresh();
            } catch (err) {
              UI.toast(err.message, true);
            }
          },
        }, '⏏ Unload'),
      ],
    });
  }

  // ------------------------------------------------------------------

  function printerForm(printer) {
    const isEdit = !!printer;
    const f = {
      name: h('input', { type: 'text', value: printer ? printer.name : '' }),
      model: h('input', { type: 'text', value: printer ? printer.model : '', placeholder: 'e.g. Bambu Lab A1' }),
      notes: h('textarea', { rows: 2 }, printer ? (printer.notes || '') : ''),
    };
    const fld = (label, control) => h('label.field', h('span', label), control);

    // Slot builder (create only — existing printers manage slots via API later)
    let slotSpec = [];
    const slotSummary = h('div.chip-row');
    const redraw = () => {
      slotSummary.replaceChildren(...slotSpec.map((s, i) =>
        h('span.chip', `${AMS_LABEL[s.ams_type]} ×${s.count}`, ' ',
          h('span', { style: { cursor: 'pointer' }, onclick: () => { slotSpec.splice(i, 1); redraw(); } }, '✕'))));
    };
    const addUnit = (type, count) => {
      slotSpec.push({ ams_type: type, count });
      redraw();
    };

    const save = async () => {
      if (!f.name.value.trim() || !f.model.value.trim()) {
        UI.toast('Name and model are required', true);
        return;
      }
      const payload = {
        name: f.name.value.trim(),
        model: f.model.value.trim(),
        notes: f.notes.value.trim() || null,
      };
      if (!isEdit) {
        payload.slots = [];
        const unitCounter = {};
        for (const spec of slotSpec) {
          unitCounter[spec.ams_type] = (unitCounter[spec.ams_type] || 0) + 1;
          for (let n = 1; n <= spec.count; n++) {
            payload.slots.push({
              ams_type: spec.ams_type,
              ams_unit_number: unitCounter[spec.ams_type],
              slot_number: n,
            });
          }
        }
      }
      try {
        if (isEdit) await API.updatePrinter(printer.id, payload);
        else await API.createPrinter(payload);
        UI.toast(isEdit ? 'Printer updated' : 'Printer added');
        m.close();
        refresh();
      } catch (err) {
        UI.toast(err.message, true);
      }
    };

    const m = UI.modal({
      title: isEdit ? `Edit: ${printer.name}` : 'Add Printer',
      body: h('div',
        fld('Name *', f.name),
        fld('Model *', f.model),
        fld('Notes', f.notes),
        !isEdit ? h('div',
          h('h3.section-title', 'AMS Units'),
          h('div.chip-row', { style: { marginBottom: '8px' } },
            h('button.chip', { onclick: () => addUnit('amsLite', 4) }, '＋ AMS Lite (4)'),
            h('button.chip', { onclick: () => addUnit('ams2Pro', 4) }, '＋ AMS 2 Pro (4)'),
            h('button.chip', { onclick: () => addUnit('amsHT', 1) }, '＋ AMS HT (1)'),
            h('button.chip', { onclick: () => addUnit('externalManual', 1) }, '＋ External spool')),
          slotSummary) : null,
      ),
      footer: [
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn.primary', { onclick: save }, isEdit ? 'Save' : 'Add'),
      ],
    });
  }

  async function deletePrinter(printer) {
    const ok = await UI.confirmDialog('Delete printer',
      `Delete "${printer.name}"? Loaded filaments return to stock.`);
    if (!ok) return;
    try {
      await API.deletePrinter(printer.id);
      UI.toast('Printer deleted');
      refresh();
    } catch (err) {
      UI.toast(err.message, true);
    }
  }

  return { render };
})();
