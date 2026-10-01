/* LabelExport — builds Bambu Suite print-then-cut projects (.lac) from label
 * PNGs, plus a dependency-free store-only ZIP writer.
 *
 * A .lac is an OPC-style ZIP: 2D/2dmodel.json (canvas objects: RasterImage +
 * StickerGroup with a rectangular cut path per label, in an AttachedGroup;
 * units are mm), Metadata2D/project_settings.json (material batch + per-object
 * "KCPrintThenCut"), machine/material/process .config files, and the label
 * PNGs under 2D/Objects/. Format reverse-engineered from Bryan's Bambu Suite
 * 01.03 projects and verified by opening generated files in the app; the
 * machine/material configs ship verbatim in assets/lac/ (Bambu Lab H2S-10W +
 * Vinyl Sticker Paper A4 — Bryan's setup).
 */

const LabelExport = (() => {

  // ------------------------------------------------------------------
  // Store-only ZIP writer
  // ------------------------------------------------------------------

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** entries: [{name: string, data: Uint8Array}] → Blob (application/zip) */
  function makeZip(entries) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;

    for (const { name, data } of entries) {
      const nameBytes = enc.encode(name);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);        // version needed
      local.setUint16(6, 0x0800, true);    // UTF-8 names
      local.setUint16(8, 0, true);         // method: store
      local.setUint16(10, 0, true);        // time
      local.setUint16(12, 0x5821, true);   // date (2024-01-01)
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, 0, true);
      cd.setUint16(14, 0x5821, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }

    let cdSize = 0;
    for (const p of central) cdSize += p.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    parts.push(...central, new Uint8Array(end.buffer));
    return new Blob(parts, { type: 'application/zip' });
  }

  // ------------------------------------------------------------------
  // .lac assembly
  // ------------------------------------------------------------------

  // Layout constants measured from Bryan's hand-built A4 sheets
  const GAP_X = 0.534, GAP_Y = 0.963;      // mm between cut rects
  const BASE_X = 299.585, BASE_Y = 587.821; // canvas-space origin (arbitrary)
  const USABLE_W = 244.0;                   // A4 print-then-cut area, mm
  const USABLE_H = 167.0;                   //   (his largest working sheet spans 167)
  const SHEET_SPACING = 220.0;              // design-space gap between sheets

  /**
   * Shelf-pack labels into A4 sheets. Mixed sizes pack tightly (sorted by
   * height then width, rows filled left→right, row height = tallest label
   * in the row) instead of a uniform grid sized by the largest label; when
   * a sheet's usable height is full, packing continues on the next sheet.
   * Returns [{label, x, y, sheet}] in mm; caller maps sheets to plates.
   */
  function packLabels(labels) {
    const order = labels.map((label, idx) => ({ label, idx }))
      .sort((a, b) => (b.label.hMm - a.label.hMm) || (b.label.wMm - a.label.wMm) || (a.idx - b.idx));
    const placed = [];
    let sheet = 0, x = 0, y = 0, rowH = 0;
    for (const { label } of order) {
      const w = Math.min(label.wMm, USABLE_W);
      if (x > 0 && x + w > USABLE_W) {       // wrap to next row
        x = 0;
        y += rowH + GAP_Y;
        rowH = 0;
      }
      if (y > 0 && y + label.hMm > USABLE_H) { // next sheet
        sheet += 1;
        x = 0; y = 0; rowH = 0;
      }
      placed.push({ label, x, y, sheet });
      x += w + GAP_X;
      rowH = Math.max(rowH, label.hMm);
    }
    return placed;
  }

  const CONFIG_FILES = [
    'Bambu Lab H2S-10W.config',
    'Custom Vinyl Sticker Paper A4 Process @Bambu Lab H2S-10W Plane.config',
    'Vinyl Sticker Paper A4.config',
    'Vinyl Sticker Paper A4.png',
  ];

  const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
    + ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
    + ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
    + ' <Default Extension="png" ContentType="image/png"/>\n'
    + ' <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n';

  const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
    + ' <Relationship Target="/2D/design_thumbnail.png" Id="rel-1" '
    + 'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n'
    + '</Relationships>\n';

  const ENTRY = JSON.stringify({ Application: 'Bambu Suite', FileVersion: '01.03.00.00' });

  const uuid4 = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      }));

  const f6 = (v) => Number(v.toFixed(6));

  /**
   * labels: [{name, pngBytes: Uint8Array, wPx, hPx, wMm, hMm}]
   * configs: [{name, data: Uint8Array}] — the four assets/lac files
   * thumbnailBytes: Uint8Array (PNG) for 2D/design_thumbnail.png
   * → Blob of the .lac
   */
  function buildLac(labels, configs, thumbnailBytes) {
    const objList = [];
    const objectSettings = [];
    const pngEntries = [];
    let imgId = 208, grpId = 1682;

    const placed = packLabels(labels);
    const sheetCount = Math.max(...placed.map((p) => p.sheet)) + 1;
    const stickersBySheet = Array.from({ length: sheetCount }, () => []);

    placed.forEach((p, i) => {
      const { label } = p;
      const safe = (label.name || `label-${i + 1}`).replace(/[^\w\-#."' ()+]/g, '_').slice(0, 80);
      const fileName = `${safe} ${uuid4()}.png`;
      const scale = label.wMm / label.wPx;
      // Sheets stack vertically in design space; each becomes its own plate
      const x = BASE_X + p.x;
      const y = BASE_Y + p.sheet * SHEET_SPACING + p.y;
      const x2 = x + label.wMm, y2 = y + label.hMm;

      objList.push({
        color: '0 0 0 255', file_name: fileName, flags: ['FreeAspectRatio'],
        height: label.hPx,
        image_settings: { classVersion: 3, flags: ['RequireModifiesOnLoad'], image_mode_visible: false },
        name: safe, obj_id: imgId, type: 'RasterImage', width: label.wPx,
      });
      objList.push({
        components: [{ obj_id: imgId, transform: `${Number(scale.toPrecision(7))} 0 0 ${Number(scale.toPrecision(7))} ${f6(x)} ${f6(y)}` }],
        creating_additional_frame: false, cut_backing_paper: true, cut_inner_shape: false,
        flags: ['FreeAspectRatio'], frame_fill_color: '255 255 255 255',
        frame_thickness: 0, frame_type: 0,
        name: `Sticker ${i + 1}`, obj_id: grpId,
        result_setting: {
          color: '0 0 0 255', flags: ['FreeAspectRatio'], is_closed: true, name: '',
          path_data: `M ${f6(x2)} ${f6(y2)} L ${f6(x)} ${f6(y2)} L ${f6(x)} ${f6(y)} `
            + `L ${f6(x2)} ${f6(y)} L ${f6(x2)} ${f6(y2)}`,
        },
        type: 'StickerGroup',
      });
      objectSettings.push({ obj_id: grpId, process_type: 'KCPrintThenCut' });
      objectSettings.push({ obj_id: imgId, process_type: 'KCPrintThenCut' });
      stickersBySheet[p.sheet].push(grpId);
      pngEntries.push({ name: '2D/Objects/' + fileName, data: label.pngBytes });
      imgId += 3;
      grpId += 12;
    });

    // One AttachedGroup per sheet, and one making plate per sheet whose
    // transform cancels the sheet's design-space offset (so every plate
    // lands at the same spot on the bed)
    const agIds = stickersBySheet.map((_, s) => 90000 + s);
    stickersBySheet.forEach((ids, s) => {
      objList.push({
        components: ids.map((id) => ({ obj_id: id, transform: '1 0 0 1 0 0' })),
        flags: ['FreeAspectRatio'], name: `Attach ${s + 1}`, obj_id: agIds[s], type: 'AttachedGroup',
      });
    });

    const model = {
      Application: 'Bambu Suite', FileVersion: '01.03.00.00',
      canvas_list: [{
        components: agIds.map((id) => ({ obj_id: id, transform: '1 0 0 1 -252.315 -508.657' })),
        index: 1, name: '', obj_list: objList,
        type_count: { AttachedGroup: sheetCount, StickerGroup: labels.length },
      }],
    };

    const projectSettings = {
      canvas_settings: [{
        index: 1,
        making_batch_list: [{
          auto_arranged: true,
          batch_settings: { classVersion: 3, material_thickness: 0.24, processing_mode: 'PLANE' },
          making_plate_list: agIds.map((id, s) => ({
            components: [{ obj_id: id, transform: `1 0 0 1 -272.658 ${f6(-566.293 - s * SHEET_SPACING)}` }],
            name: '', obj_id: 4506 + s, plate_mirror: false, plate_settings: { classVersion: 3 },
          })),
          material_id: 'PM_bf7086f1-fd13-4c5b-9dfb-4b048a01798e',
          material_name: 'Vinyl Sticker Paper A4',
          material_settings_name: 'Vinyl Sticker Paper A4',
          name: '', obj_id: 10, process_category: 8,
        }],
        object_settings: objectSettings,
      }],
      project_settings: { classVersion: 3, machine_settings_name: 'Bambu Lab H2S-10W', version: null },
    };

    const enc = new TextEncoder();
    const blob = makeZip([
      { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
      { name: '_rels/.rels', data: enc.encode(RELS) },
      { name: '2D/entry.json', data: enc.encode(ENTRY) },
      { name: '2D/design_thumbnail.png', data: thumbnailBytes },
      { name: '2D/2dmodel.json', data: enc.encode(JSON.stringify(model)) },
      { name: 'Metadata2D/project_settings.json', data: enc.encode(JSON.stringify(projectSettings)) },
      ...configs.map((c) => ({ name: 'Metadata2D/' + c.name, data: c.data })),
      ...pngEntries,
    ]);
    return { blob, sheets: sheetCount };
  }

  /** Fetch the bundled machine/material config files (assets/lac/). */
  async function fetchConfigs() {
    return Promise.all(CONFIG_FILES.map(async (name) => {
      const res = await fetch('assets/lac/' + encodeURIComponent(name));
      if (!res.ok) throw new Error(`Missing .lac config asset: ${name}`);
      return { name, data: new Uint8Array(await res.arrayBuffer()) };
    }));
  }

  // ------------------------------------------------------------------
  // .lac reading — pull the labels back out of existing projects
  // ------------------------------------------------------------------

  /** Minimal ZIP reader (store + deflate) → Map(name → Uint8Array). */
  async function readZip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a ZIP archive');
    const count = view.getUint16(eocd + 10, true);
    let off = view.getUint32(eocd + 16, true);
    const entries = [];
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(off, true) !== 0x02014b50) break;
      const method = view.getUint16(off + 10, true);
      const csize = view.getUint32(off + 20, true);
      const nameLen = view.getUint16(off + 28, true);
      const extraLen = view.getUint16(off + 30, true);
      const cmtLen = view.getUint16(off + 32, true);
      const lho = view.getUint32(off + 42, true);
      entries.push({ name: dec.decode(bytes.subarray(off + 46, off + 46 + nameLen)), method, csize, lho });
      off += 46 + nameLen + extraLen + cmtLen;
    }
    const out = new Map();
    for (const e of entries) {
      const lNameLen = view.getUint16(e.lho + 26, true);
      const lExtraLen = view.getUint16(e.lho + 28, true);
      const start = e.lho + 30 + lNameLen + lExtraLen;
      const comp = bytes.slice(start, start + e.csize);
      if (e.method === 0) {
        out.set(e.name, comp);
      } else if (e.method === 8) {
        const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        out.set(e.name, new Uint8Array(await new Response(stream).arrayBuffer()));
      } else {
        throw new Error(`Unsupported ZIP compression method ${e.method} in ${e.name}`);
      }
    }
    return out;
  }

  /**
   * Extract the sticker labels from a Bambu Suite .lac —
   * → [{name, pngBytes, wPx, hPx, wMm, hMm}] with exact mm sizes taken
   * from each sticker's image transform.
   */
  async function readLac(arrayBuffer) {
    const files = await readZip(arrayBuffer);
    const modelBytes = files.get('2D/2dmodel.json');
    if (!modelBytes) throw new Error('Not a Bambu Suite project (missing 2D/2dmodel.json)');
    const model = JSON.parse(new TextDecoder().decode(modelBytes));
    const labels = [];
    for (const canvas of model.canvas_list || []) {
      const imgs = new Map();
      for (const o of canvas.obj_list || []) {
        if (o.type === 'RasterImage') imgs.set(o.obj_id, o);
      }
      for (const o of canvas.obj_list || []) {
        if (o.type !== 'StickerGroup' || !o.components || !o.components.length) continue;
        const img = imgs.get(o.components[0].obj_id);
        if (!img) continue;
        const png = files.get('2D/Objects/' + img.file_name);
        if (!png || !img.width || !img.height) continue;
        const t = o.components[0].transform.trim().split(/\s+/).map(Number);
        const sx = t[0] || 1, sy = t[3] || sx;
        labels.push({
          name: String(img.name || img.file_name).replace(/\s+[0-9a-f-]{36}(\.png)?$/i, ''),
          pngBytes: png, wPx: img.width, hPx: img.height,
          wMm: img.width * sx, hMm: img.height * sy,
        });
      }
    }
    if (!labels.length) throw new Error('No sticker labels found in this .lac');
    return labels;
  }

  return { makeZip, buildLac, packLabels, fetchConfigs, readZip, readLac, CONFIG_FILES };
})();
