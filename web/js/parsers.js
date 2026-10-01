/* InvoiceParsers — JS port of Server/parsers/bambulab_invoice.py and
 * amazon_order.py. Operates on text lines extracted client-side via pdf.js.
 *
 * Bambu Lab supports three layouts: digital invoice (SKU: lines), web
 * order page (Order No: + "$price" lines), and printed table (fallback).
 */

const InvoiceParsers = (() => {

  // ------------------------------------------------------------------
  // Shared: filament materials + colors (from bambulab_invoice.py)
  // ------------------------------------------------------------------

  const FILAMENT_MATERIALS = {
    'PLA Basic Gradient': 'PLA Gradient',
    'PLA Silk Multi-Color': 'PLA Silk Multi-Color',
    'PLA Silk Duo-Color': 'PLA Silk Duo-Color',
    'PLA Silk+': 'PLA Silk+',
    'PLA Silk': 'PLA Silk',
    'PLA Sparkle': 'PLA Sparkle',
    'PLA Galaxy': 'PLA Galaxy',
    'PLA Matte': 'PLA Matte',
    'PLA Marble': 'PLA Marble',
    'PLA CMYK': 'PLA',
    'PLA Basic': 'PLA',
    'PLA-CF': 'PLA-CF',
    'PETG-CF': 'PETG-CF',
    'PETG Translucent': 'PETG Translucent',
    'PETG HF': 'PETG HF',
    'PETG Basic': 'PETG',
    'ASA Matte': 'ASA Matte',
    'ASA Aero': 'ASA Aero',
    'ASA': 'ASA',
    'ABS': 'ABS',
    'TPU 95A HF': 'TPU HF',
    'TPU 95A': 'TPU',
    'PA6-CF': 'PA6-CF',
    'PPA-CF': 'PPA-CF',
    'PET-CF': 'PET-CF',
    'PAHT-CF': 'PAHT-CF',
    'Support for ABS': 'Support for ABS',
    'Support for PLA/PETG': 'Support for PLA/PETG',
    'Support for PLA (New)': 'Support for PLA',
    'Support for PLA': 'Support for PLA',
    'PVA': 'PVA',
    'Support W': 'Support W',
    'Support G': 'Support G',
  };
  const MATERIAL_KEYS = Object.keys(FILAMENT_MATERIALS).sort((a, b) => b.length - a.length);

  const COLOR_KEYWORDS = [
    [['jade white', 'white'], '#F5F5F5'], [['ivory white'], '#FFFFF0'],
    [['bambu white'], '#FAFAFA'], [['charcoal', 'dark gray'], '#3D3D3D'],
    [['blue gray', 'blue grey'], '#6699AA'], [['gray', 'grey'], '#808080'],
    [['silver'], '#C0C0C0'], [['black'], '#1A1A1A'],
    [['blueberry bubblegum'], '#6A5ACD'], [['blue hawaii'], '#00BCD4'],
    [['navy blue', 'dark blue'], '#000080'], [['royal blue'], '#4169E1'],
    [['sky blue', 'light blue'], '#87CEEB'], [['blue'], '#0066CC'],
    [['azure'], '#007FFF'], [['cyan', 'teal'], '#00BCD4'],
    [['crimson', 'dark red'], '#8B0000'], [['scarlet'], '#FF2400'],
    [['coral'], '#FF7F50'], [['salmon'], '#FA8072'],
    [['wine', 'maroon'], '#722F37'], [['red'], '#CC0000'],
    [['fuchsia', 'magenta'], '#FF00FF'], [['hot pink'], '#FF69B4'],
    [['sakura', 'pink'], '#FFB7C5'], [['rose'], '#FF007F'],
    [['tangerine yellow'], '#FFCC00'], [['tangerine', 'dark orange'], '#FF6600'],
    [['orange'], '#FF8C00'], [['peach'], '#FFCBA4'],
    [['gold', 'golden'], '#FFD700'], [['lemon'], '#FFF44F'],
    [['cream', 'ivory'], '#FFFDD0'], [['savanna yellow'], '#F0C040'],
    [['yellow'], '#FFD700'],
    [['forest', 'dark green'], '#228B22'], [['bambu green'], '#00A550'],
    [['lime', 'neon green'], '#32CD32'], [['olive'], '#808000'],
    [['mint', 'seafoam'], '#98FF98'], [['army green', 'military'], '#4B5320'],
    [['green'], '#00A550'],
    [['purple'], '#800080'], [['lavender'], '#B57EDC'],
    [['violet'], '#7F00FF'], [['lilac'], '#C8A2C8'],
    [['chocolate', 'dark brown'], '#3E2723'], [['brown'], '#8B4513'],
    [['tan', 'khaki'], '#D2B48C'], [['wood', 'bambu'], '#DEB887'],
    [['copper'], '#B87333'], [['bronze'], '#CD7F32'],
    [['marble'], '#E8E8E8'],
    [['nature', 'natural', 'translucent'], '#F5F5DC'],
    [['ocean to meadow'], '#2E8B8B'], [['sunrise to sunset'], '#FF6347'],
    [['lava to ash'], '#B22222'], [['cmyk', 'lithophane'], '#F5F5F5'],
  ];

  const money = (s) => parseFloat(String(s).replace(/,/g, ''));

  // Normalize the date strings invoices use ("Dec.19, 2023 10:59",
  // "March 14, 2026", "2026-03-19 08:00") to plain YYYY-MM-DD so the item
  // form's date field can display them. Unrecognized strings pass through.
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function normalizeDate(s) {
    if (!s) return null;
    const str = String(s).trim();
    let m = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    m = str.match(/([A-Za-z]{3,9})\.?\s*(\d{1,2}),?\s*(\d{4})/);
    if (m) {
      const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mo) {
        return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
      }
    }
    return str;
  }

  function inferColorHex(colorName) {
    if (!colorName) return null;
    const text = colorName.toLowerCase();
    for (const [keywords, hex] of COLOR_KEYWORDS) {
      if (keywords.some((k) => text.includes(k))) return hex;
    }
    return null;
  }

  // Category KEYS must match the categories table (see api/_bootstrap.php
  // seeds + Bryan's customs: consumable, printerparts, makersupply). The
  // review table and item form fall back to "other" for unknown keys.
  function classifyBambu(name, variant) {
    const combined = (name.toLowerCase() + ' ' + (variant || '').toLowerCase());
    if (MATERIAL_KEYS.some((k) => combined.includes(k.toLowerCase()))) return 'filament';
    if (/screw|bhcs/.test(combined)) return 'screws';
    // Cables/wires before motors: "Servo Extension Cable" is a cable
    if (/cable|wire\b/.test(combined)) return 'electronic';
    if (/motor|servo/.test(combined)) return 'motor';
    if (/spring|torsion|bearing|magnet|nut|dowel pin|dowel/.test(combined)) return 'hardware';
    if (/cable|wire|connector|switch|led|lamp|light|battery|charger|module|shield|core board|joystick|receiver|transmitter/.test(combined)) return 'electronic';
    if (/ams|nozzle|build plate|inlet|pei|supertack|plate|wiper|footpad|adapter|hotend|extruder/.test(combined)) return 'printer_accessory';
    if (/cyberbrick|\bkit\b/.test(combined)) return 'makersupply';
    return 'other';
  }

  function parseFilamentVariant(name, variant) {
    const combined = (name + ' ' + (variant || '')).trim();
    const combinedLower = combined.toLowerCase();

    let material = 'PLA';
    for (const key of MATERIAL_KEYS) {
      if (combinedLower.includes(key.toLowerCase())) {
        material = FILAMENT_MATERIALS[key];
        break;
      }
    }

    let color = null;
    for (const searchText of [variant || '', combined]) {
      if (color) break;
      const m = searchText.match(/(?:^|\/\s*)([^/]+?)\s*\((\d{3,})\)/);
      if (m) {
        let raw = m[1].trim();
        for (const key of MATERIAL_KEYS) {
          if (raw.toLowerCase().startsWith(key.toLowerCase())) {
            raw = raw.slice(key.length).trim();
            break;
          }
        }
        raw = raw.replace(/^(?:Matte|Basic|HF)\s+/, '').trim();
        if (raw && !MATERIAL_KEYS.some((k) => k.toLowerCase() === raw.toLowerCase())) {
          color = raw;
        }
      }
    }

    let spoolType = 'withSpool';
    if (combinedLower.includes('refill')) spoolType = 'refill';

    let weight = 1000;
    const wm = combinedLower.match(/(\d+)\s*kg/);
    if (wm) weight = parseInt(wm[1], 10) * 1000;

    let colorHex = color ? inferColorHex(color) : null;
    if (!color && !colorHex) {
      const matLower = material.toLowerCase();
      if (matLower.includes('pva')) { color = 'Clear'; colorHex = '#F0F0F0'; }
      else if (matLower.includes('support')) { color = 'White'; colorHex = '#F5F5F5'; }
    }

    return {
      material, color, color_hex: colorHex, color_mode: 'solid',
      diameter: 1.75, spool_weight: weight, remaining_weight: weight,
      status: 'inStock', spool_type: spoolType,
    };
  }

  const packQty = (text) => {
    const m = (text || '').match(/\((\d+)\s*PCS\)/i);
    return m ? parseInt(m[1], 10) : null;
  };

  // Remove "(20PCS)" pack markers and "- AA058" part codes from a name or
  // variant string (the code may sit mid-string: "… Kit - ZK003 (2 Remotes)")
  const stripPackCode = (text) => (text || '')
    .replace(/\s*\(\d+\s*PCS\)/ig, '')
    .replace(/\s*-\s*[A-Z]{1,3}\d{2,4}(?=\s*\(|\s*$)/, '')
    .replace(/\s+/g, ' ').trim();

  function screwSubcategory(name, variant) {
    if (/self tapping/i.test(name) || /self tapping/i.test(variant || '')) {
      return 'Self Tapping (BHCS)';
    }
    if (/bhcs/i.test(name) || /bhcs/i.test(variant || '')) {
      return 'Button Head Cap (BHCS)';
    }
    return 'Machine Screw';
  }

  /**
   * Shared product classifier — used by the invoice parsers AND the
   * product-URL import so both produce the same category keys, clean names
   * (matching the naming conventions already in Bryan's inventory), pack
   * descriptions, and filament fields.
   *
   * Naming: screws take the variant minus pack/code ("M3x8 BHCS Machine
   * Screw"); other categories use the variant when it's the more specific
   * full name ("N20 Reduction Gear Motor 400rpm"), prefix size-only
   * variants ("6704ZZ Steel Deep Groove Ball Bearings", "0.4x3x10 mm
   * Extension Springs"), and push compatibility lists ("X1 Series/P1
   * Series…") into the description.
   */
  function classifyProduct(name, variant) {
    const category = classifyBambu(name, variant);
    const out = { name: name.trim(), category, subcategory: null,
      description: variant || null, filament: null, unit: 'pcs',
      pack_quantity: null, warnings: [] };

    if (category === 'filament') {
      out.filament = parseFilamentVariant(name, variant);
      out.unit = 'spools';
      if (!out.filament.color) out.warnings.push('Color not detected');
      else if (!out.filament.color_hex) out.warnings.push('Color hex not matched');
      return out;
    }

    const pq = packQty(variant) || packQty(name);
    const sv = stripPackCode(variant);
    let extraDesc = null;

    if (category === 'screws') {
      out.subcategory = screwSubcategory(name, variant);
      if (sv && /\d/.test(sv)) out.name = sv; // "M3x8 BHCS Machine Screw"
    } else if (sv) {
      const nameLower = out.name.toLowerCase();
      const svLower = sv.toLowerCase();
      if (nameLower.includes(svLower)) {
        // variant adds nothing beyond the product name
      } else {
        const nameWords = nameLower.split(/[^a-z0-9°]+/).filter((w) => w.length >= 4);
        if (nameWords.some((w) => svLower.includes(w))) {
          out.name = sv; // variant IS the fuller name
        } else if (/\d/.test(sv) && !sv.includes('/') && sv.length <= 24) {
          // Dimensions ("2x6mm") prefix; part codes ("MR52ZZ") suffix —
          // matching the normalized inventory conventions
          out.name = /\dx\d|×/.test(sv) ? `${sv} ${out.name}` : `${out.name} ${sv}`;
        } else {
          extraDesc = sv; // compatibility notes ("X1 Series/P1 Series…")
        }
      }
    }

    // Name hygiene shared with the 2026-07 inventory normalization:
    // no space before mm, singular Spring/Pin families
    // pack_quantity lets value math divide a pack price by its piece count
    if (pq && pq > 1) out.pack_quantity = pq;
    out.name = stripPackCode(out.name)
      .replace(/(\d)\s+mm\b/g, '$1mm')
      .replace(/\b(Spring|Pin)s$/, '$1');
    if (pq && (category === 'screws' || category === 'hardware')) out.unit = 'packs';
    const descParts = [];
    if (pq && pq > 1) descParts.push(`Pack of ${pq}`);
    if (extraDesc) descParts.push(extraDesc);
    out.description = descParts.length ? descParts.join(' — ') : null;
    return out;
  }

  function buildLineItem({ name, variant, sku, quantity, unitPrice, lineTotal,
    invoiceDate, listPrice, discount, tax }) {
    const cls = classifyProduct(name, variant);
    return {
      ...cls, brand: 'Bambu Lab', sku: sku || null,
      quantity,
      unit_price: unitPrice ?? null, line_total: lineTotal ?? null,
      list_price: listPrice ?? null, discount: discount ?? null, tax: tax ?? null,
      vendor: 'Bambu Lab', purchase_date: normalizeDate(invoiceDate),
    };
  }

  // ------------------------------------------------------------------
  // Bambu Lab: web order page format ("Order No:" / "$price" lines)
  // ------------------------------------------------------------------

  const ORDER_STOPS = new Set(['Subtotal', 'Grand Total', 'Shipping Address', 'Billing Address',
    'Fold', 'Show All', 'Net Payment', 'Shipping', 'Tax', 'Order Discount']);
  const ORDER_SKIP = new Set(['Order Details', 'Payment Details', 'Completed', 'Delivered',
    'Shipped', 'Processing', 'Pending', 'Menu', 'Confirm Receipt', 'Buy Again',
    'Cookie Settings', 'Privacy Notice', 'Terms of Service', 'Warranty Statement',
    'Payment Help', 'Contact Us', 'About Us', 'About Bambu Lab']);

  function parseBambuOrderPage(lines) {
    const hasOrderNo = lines.some((l) => l.startsWith('Order No:'));
    const hasDetails = lines.some((l) => l.trim() === 'Order Details');
    if (!hasOrderNo && !hasDetails) return null;

    const invoice = { source: 'bambulab', vendor: 'Bambu Lab', order_number: null,
      order_date: null, invoice_number: null, grand_total: null,
      items_subtotal: null, line_items: [], warnings: [] };

    lines.forEach((line, i) => {
      if (line.startsWith('Order No:')) invoice.order_number = line.split(':').slice(1).join(':').trim();
      else if (line.startsWith('Order Placed:')) invoice.order_date = line.split(':').slice(1).join(':').trim();
      else if ((line.trim() === 'Grand Total' || line.trim() === 'Subtotal') && lines[i + 1]) {
        const m = lines[i + 1].trim().match(/^\$?([\d,]+\.\d{2})/);
        if (m) invoice[line.trim() === 'Grand Total' ? 'grand_total' : 'items_subtotal'] = money(m[1]);
      }
    });

    // Item price lines are "$4.08" — or "$1.97 $2.19" / "$1.97$2.19" when the
    // page shows a discounted price next to the struck-through original.
    const PRICE_RE = /^\$([\d,]+\.\d{2})(?:\s*\$[\d,]+\.\d{2})?$/;

    let i = 0;
    let pendingQty = null; // order pages put the quantity on its own line above the name
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || ORDER_SKIP.has(line)) { pendingQty = null; i++; continue; }
      if (ORDER_STOPS.has(line)) break;
      if (/^\d{1,3}$/.test(line)) { pendingQty = parseInt(line, 10); i++; continue; }
      if (line.startsWith('Order No:') || line.startsWith('Order Placed:')
        || line.startsWith('The ') || line.startsWith('-$') || line.startsWith('$')
        || line.startsWith('order discount') || /^model ID/i.test(line)
        || /:\s*-\$[\d,]+\.\d{2}$/.test(line) || /^\d+$/.test(line)) { i++; continue; }

      // Look ahead for a "$price" line within 3 lines
      let priceIdx = null;
      for (let look = i + 1; look < Math.min(i + 4, lines.length); look++) {
        if (PRICE_RE.test(lines[look].trim())) { priceIdx = look; break; }
      }
      if (priceIdx === null) { i++; continue; }

      const price = money(lines[priceIdx].trim().match(PRICE_RE)[1]);
      const variantParts = [];
      for (let v = i + 1; v < priceIdx; v++) {
        const vl = lines[v].trim();
        if (vl && !vl.startsWith('$')) variantParts.push(vl);
      }
      let variant = variantParts.join(' / ');
      let name = line;
      if (line.includes(' - ')) {
        const idx = line.indexOf(' - ');
        name = line.slice(0, idx).trim();
        if (!variant) variant = line.slice(idx + 3).trim();
      } else if (variant && name.includes(variant)) {
        variant = '';
      }

      const qty = pendingQty || 1;
      pendingQty = null;
      invoice.line_items.push(buildLineItem({
        name, variant, sku: '', quantity: qty,
        unitPrice: qty > 1 ? Math.round((price / qty) * 100) / 100 : price,
        lineTotal: price, invoiceDate: invoice.order_date,
      }));
      i = priceIdx + 1;
    }

    return invoice.line_items.length ? checkSubtotal(invoice) : null;
  }

  // ------------------------------------------------------------------
  // Bambu Lab: digital invoice format ("SKU:" cells)
  //
  // Works on individual pdf.js text CELLS, not joined lines: the invoice
  // is a two-column table where the tax column ("FL STATE", "TAX(6%)")
  // shares rows with product cells. We filter the junk cells, then parse
  // item blocks anchored on "SKU:" cells.
  // ------------------------------------------------------------------

  const BAMBU_JUNK = [
    /^FL (STATE|COUNTY)$/, /^TAX\(/, /^#/, /^INVOICE( TO)?$/,
    /^(Product|Tax|Items|Qty|Price\(excl\.tax\)|discount|amount|SubTotal)$/,
  ];
  const BAMBU_FOOTER = new Set(['Items Subtotal', 'Shipping', 'Grand total',
    'Total exclude tax', 'Net payment', 'Thank you for your purchase!']);

  function headerValue(cells, i, prefix) {
    const rest = cells[i].slice(prefix.length).trim();
    if (rest) return rest;
    return (cells[i + 1] || '').trim() || null;
  }

  // Invoice metadata + footer totals from the raw cell stream (prefixes are
  // their own cells, so this works before any junk filtering).
  function scanBambuMeta(rawCells) {
    const invoice = { source: 'bambulab', vendor: 'Bambu Lab', order_number: null,
      order_date: null, invoice_number: null, invoice_date: null, grand_total: null,
      items_subtotal: null, line_items: [], warnings: [] };
    rawCells.forEach((c, i) => {
      if (c.startsWith('Order Number:')) invoice.order_number = headerValue(rawCells, i, 'Order Number:');
      else if (c.startsWith('Invoice Number:')) invoice.invoice_number = headerValue(rawCells, i, 'Invoice Number:');
      else if (c.startsWith('Invoice Date:')) invoice.invoice_date = headerValue(rawCells, i, 'Invoice Date:');
      else if (c.startsWith('Payment Date:')) invoice.order_date = headerValue(rawCells, i, 'Payment Date:');
      else if ((c === 'Grand total' || c === 'Items Subtotal') && rawCells[i + 1]) {
        const m = rawCells[i + 1].match(/^\$?([\d,]+\.\d{2})/);
        if (m) invoice[c === 'Grand total' ? 'grand_total' : 'items_subtotal'] = money(m[1]);
      }
    });
    return invoice;
  }

  // After parsing, check the line items actually add up to the invoice's own
  // "Items Subtotal" — the strongest signal that an item was missed.
  function checkSubtotal(invoice) {
    if (invoice.items_subtotal == null || !invoice.line_items.length) return invoice;
    const sum = invoice.line_items.reduce(
      (a, li) => a + (li.line_total ?? (li.unit_price != null ? li.unit_price * li.quantity : 0)), 0);
    if (Math.abs(sum - invoice.items_subtotal) > 0.011) {
      invoice.warnings.push(`Line items add up to $${sum.toFixed(2)} but the invoice subtotal is `
        + `$${invoice.items_subtotal.toFixed(2)} — an item may be missing or misparsed. Check against the PDF.`);
    }
    return invoice;
  }

  function parseBambuDigital(rawCells) {
    const invoice = scanBambuMeta(rawCells);

    // Items begin after the table header ("Product / Qty / Price… / SubTotal").
    // Find the last header cell in the leading section and parse from there —
    // everything before it is invoice/address boilerplate.
    const headerRe = /^(Product|Tax|Items|Qty|Price\(excl\.tax\)|discount|amount|SubTotal)$/;
    let regionStart = 0;
    for (let i = 0; i < Math.min(rawCells.length, 80); i++) {
      if (headerRe.test(rawCells[i])) regionStart = i + 1;
    }

    const cells = rawCells.slice(regionStart)
      .filter((c) => c && !BAMBU_JUNK.some((re) => re.test(c)));

    // Item blocks: each starts at a "SKU:" cell. Text cells between the end
    // of one block and the next "SKU:" are the next item's name.
    const skuIdx = [];
    cells.forEach((c, i) => { if (c.startsWith('SKU:')) skuIdx.push(i); });

    skuIdx.forEach((start, n) => {
      const end = n + 1 < skuIdx.length ? skuIdx[n + 1] : cells.length;

      let sku = cells[start].replace('SKU:', '').trim();
      let quantity = 1;
      let qtySeen = false;
      const amounts = [];
      const variantParts = [];
      const nameTail = []; // trailing text cells that belong to the NEXT item
      let inVariant = false;
      let variantEnded = false;

      // Hardware variants end with the item's own SKU code ("… - BC002" for
      // SKU "B-BC002") — a deterministic end-of-variant marker. Filament
      // SKUs end in size/spool suffixes (SPL, 1000…) which don't match.
      const skuCode = (() => {
        const tail = sku.includes('-') ? sku.split('-').pop() : '';
        return /^[A-Z]{2,3}\d{3,4}$/.test(tail) ? tail : null;
      })();
      const endsWithSkuCode = (cell) => skuCode && new RegExp(`[-\\s]${skuCode}$`).test(cell);

      for (let k = start + 1; k < end; k++) {
        const cell = cells[k];
        if (BAMBU_FOOTER.has(cell)) break;

        // Amounts and quantity can interleave with the variant rows in the
        // two-column layout — they do NOT end the variant.
        const priceM = cell.match(/^\$([\d,]+\.\d{2})$/);
        if (priceM) { amounts.push(money(priceM[1])); continue; }
        if (/^\d{1,3}$/.test(cell)) {
          if (!qtySeen) { quantity = parseInt(cell, 10); qtySeen = true; }
          continue;
        }
        if (cell.startsWith('Variant:')) {
          variantParts.push(cell.replace('Variant:', '').trim());
          inVariant = true;
          variantEnded = endsWithSkuCode(cell);
          continue;
        }
        // SKU continuation: short uppercase code right after a dangling SKU
        if (k === start + 1 && (sku.endsWith('-')
          || (cell.length < 20 && /[A-Z]/.test(cell) && /^[A-Z0-9-]+$/.test(cell)))) {
          sku += cell;
          continue;
        }
        if (inVariant && !variantEnded) {
          // Continuation of the variant — unless this text belongs to the
          // next item's name: it does when the next cell is "SKU:", or when
          // "SKU:" is two cells away and this cell reads like a plain name
          // (variant specs almost always contain digits or parentheses)
          const nextIsSku = cells[k + 1]?.startsWith('SKU:');
          const skuTwoAway = cells[k + 2]?.startsWith('SKU:');
          const looksLikeSpec = /[\d()]/.test(cell);
          if (nextIsSku || (skuTwoAway && !looksLikeSpec)) {
            nameTail.push(cell);
            inVariant = false;
          } else {
            variantParts.push(cell);
            if (endsWithSkuCode(cell)) variantEnded = true;
          }
          continue;
        }
        // Loose text cell (or text after the variant's SKU-code terminator):
        // name material for the next item
        nameTail.push(cell);
      }

      // Name: first item's name is the text between the table header and its
      // SKU; later items get theirs from the previous block's trailing text.
      let name = (n === 0
        ? cells.slice(0, start).filter((c) => !c.startsWith('$') && !/^\d{1,3}$/.test(c)).join(' ')
        : (invoice._pendingName || '')).trim();
      // A name never legitimately ends with the item's own SKU code — that's
      // a swallowed variant fragment like "(1PCS) - LA008". Strip it.
      if (skuCode) {
        name = name.replace(
          new RegExp(`\\s*(\\(\\d+\\s*PCS\\))?\\s*-\\s*${skuCode}$`, 'i'), ''
        ).trim();
      }
      invoice._pendingName = nameTail.join(' ').trim();

      if (!name || name.length < 3) return;

      const variant = variantParts.join(' ').replace(/\s*-\s*[A-Z]{1,3}\d{3,4}\s*$/, '').trim();

      let unitPrice = null, lineTotal = null;
      if (amounts.length >= 3) {
        unitPrice = amounts[0];
        lineTotal = amounts[amounts.length - 1];
      } else if (amounts.length === 2) {
        [unitPrice, lineTotal] = amounts;
      } else if (amounts.length === 1) {
        unitPrice = amounts[0];
      }

      invoice.line_items.push(buildLineItem({
        name, variant, sku, quantity,
        unitPrice, lineTotal, invoiceDate: invoice.invoice_date || invoice.order_date,
      }));
    });

    delete invoice._pendingName;
    return checkSubtotal(invoice);
  }

  // ------------------------------------------------------------------
  // Bambu Lab: digital invoice — geometry + font parser (primary).
  //
  // Works on positioned cells ({str, x, y, font} per page, reading order).
  // The invoice sets product names in the BOLD font (same font as the table
  // header) and everything else (SKU, variant, amounts) in the regular font,
  // and the amount columns sit at fixed x positions — so item boundaries and
  // amount roles are deterministic instead of guessed. This fixes items whose
  // qty/price row appears above their "SKU:" cell (previously swallowed by
  // the preceding item, e.g. XC011/XC003) and multi-cell bold names
  // (previously truncated, e.g. "…Clutch Protection").
  // ------------------------------------------------------------------

  const BAMBU_TAX_JUNK = /^(FL (STATE|COUNTY)|TAX\([\d.]+%\))$/;

  function parseBambuDigitalXY(pages, rawCells) {
    const invoice = scanBambuMeta(rawCells);

    // The bold font id = font of the "Price(excl.tax)" header cell
    let boldFont = null;
    for (const pageCells of pages) {
      const hdr = pageCells.find((c) => c.str === 'Price(excl.tax)');
      if (hdr) { boldFont = hdr.font; break; }
    }
    if (!boldFont) return null; // caller falls back to the heuristic parser

    const items = [];
    let cur = null;
    let stopped = false;
    const flush = () => { if (cur) items.push(cur); cur = null; };

    for (const pageCells of pages) {
      if (stopped) break;
      const priceHdr = pageCells.find((c) => c.str === 'Price(excl.tax)');
      if (!priceHdr) continue; // page without an items table

      // Column anchors from this page's header cells (3 header rows ≈ 14pt)
      const inHeader = (c) => Math.abs(c.y - priceHdr.y) <= 9;
      const anchor = (label) => {
        const c = pageCells.find((cc) => cc.str === label && Math.abs(cc.y - priceHdr.y) <= 9);
        return c ? c.x : null;
      };
      const xQty = anchor('Qty'), xDisc = anchor('discount'),
        xAmt = anchor('amount'), xSub = anchor('SubTotal');
      if (xQty == null || xSub == null) continue;
      const xPrice = priceHdr.x;
      const leftMax = xQty - 30;
      const qtyMax = (xQty + xPrice) / 2 + 10;
      const priceMax = xDisc != null ? (xPrice + xDisc) / 2 : xPrice + 60;
      const discMax = xDisc != null && xAmt != null ? (xDisc + xAmt) / 2 : priceMax + 70;
      const taxMax = xAmt != null ? (xAmt + xSub) / 2 : xSub - 25;

      for (const cell of pageCells) {
        const s = cell.str;
        // Header rows and everything above them (page-1 addresses/meta)
        if (cell.y >= priceHdr.y - 9 || inHeader(cell)) continue;
        if (BAMBU_TAX_JUNK.test(s)) continue;
        if (BAMBU_FOOTER.has(s)) { flush(); stopped = true; break; }

        if (cell.x >= leftMax) {
          // Numeric columns: role from x position
          if (!cur) continue;
          if (/^\d{1,4}$/.test(s) && cell.x < qtyMax) {
            if (cur.quantity == null) cur.quantity = parseInt(s, 10);
          } else {
            const m = s.match(/^-?\$([\d,]+\.\d{2})$/);
            if (!m) continue;
            const val = money(m[1]);
            if (cell.x < priceMax) { if (cur.price == null) cur.price = val; }
            else if (cell.x < discMax) { if (cur.discount == null) cur.discount = val; }
            else if (cell.x < taxMax) { if (cur.tax == null) cur.tax = val; }
            else if (cur.subtotal == null) cur.subtotal = val;
          }
          continue;
        }

        // Product column
        if (cell.font === boldFont) {
          // Bold = product name; first bold cell after non-name content opens
          // a new item (names may span several bold cells)
          if (!cur || cur.phase !== 'name') { flush(); cur = { nameParts: [], variantParts: [], phase: 'name', quantity: null, price: null, discount: null, tax: null, subtotal: null, sku: '', skuOpen: false, inVariant: false }; }
          cur.nameParts.push(s);
          continue;
        }
        if (!cur) continue;
        cur.phase = 'rest';
        if (s.startsWith('SKU:')) {
          cur.sku = s.slice(4).trim();
          cur.skuOpen = true;
        } else if (s.startsWith('Variant:')) {
          cur.variantParts.push(s.slice(8).trim());
          cur.skuOpen = false;
          cur.inVariant = true;
        } else if (cur.skuOpen && /^[A-Z0-9-]{1,24}$/.test(s)) {
          cur.sku += s; // wrapped SKU, e.g. "A01-P3-1.75-1000-" + "SPLFREE"
          cur.skuOpen = false;
        } else {
          cur.variantParts.push(s); // wrapped variant line (incl. across pages)
          cur.skuOpen = false;
        }
      }
    }
    flush();

    for (const it of items) {
      let name = it.nameParts.join(' ').trim();
      const skuTail = it.sku.includes('-') ? it.sku.split('-').pop() : '';
      const skuCode = /^[A-Z]{2,3}\d{3,4}$/.test(skuTail) ? skuTail : null;
      if (skuCode) {
        // Names like "N20 … Motor (1PCS) - LA008" repeat the variant tail
        name = name.replace(new RegExp(`\\s*(\\(\\d+\\s*PCS\\))?\\s*-\\s*${skuCode}$`, 'i'), '').trim();
      }
      if (!name || name.length < 3) continue;
      const variant = it.variantParts.join(' ').replace(/\s*-\s*[A-Z]{1,3}\d{3,4}\s*$/, '').trim();
      const quantity = it.quantity ?? 1;
      const lineTotal = it.subtotal ?? (it.price != null ? it.price * quantity : null);
      const unitPrice = it.subtotal != null && quantity > 0
        ? Math.round((it.subtotal / quantity) * 100) / 100
        : it.price;
      invoice.line_items.push(buildLineItem({
        name, variant, sku: it.sku, quantity,
        unitPrice, lineTotal, listPrice: it.price,
        discount: it.discount, tax: it.tax,
        invoiceDate: invoice.invoice_date || invoice.order_date,
      }));
    }

    return checkSubtotal(invoice);
  }

  function parseBambu(lines, cells, pages) {
    const orderPage = parseBambuOrderPage(lines);
    if (orderPage) return orderPage;
    if (pages && pages.length) {
      const inv = parseBambuDigitalXY(pages, cells || lines);
      if (inv && inv.line_items.length) return inv;
    }
    return parseBambuDigital(cells || lines);
  }

  // ------------------------------------------------------------------
  // Amazon order summary
  // ------------------------------------------------------------------

  const AMAZON_CATEGORIES = {
    paper: ['paper', 'vellum', 'sheets', 'printable vinyl', 'sticker paper', 'transfer paper'],
    adhesive: ['cork pad', 'adhesive', 'tape', 'glue', 'cork'],
    craft_supply: ['vinyl', 'htv', 'htvront', 'keychain', 'blank', 'resin', 'paint', 'craft'],
    filament: ['3d printer filament', 'pla filament', 'petg filament', 'abs filament', 'tpu filament'],
    tool: ['tool', 'cutter', 'scissors', 'wrench', 'screwdriver'],
    electronic: ['cable', 'connector', 'sensor', 'led', 'wire', 'bulb', 'zapper', 'lamp', 'light bulb'],
    screws: ['screw', 'bolt', 'nut', 'washer'],
    hardware: ['bearing', 'magnet', 'spring', 'dowel', 'pin'],
  };
  const KNOWN_BRANDS = ['HTVRONT', 'TECKWRAP', 'Dowsabel', 'Qualirey', 'Cricut', 'Silhouette',
    'VEVOR', 'SUNLU', 'eSUN', 'Overture', 'Polymaker', 'Bambu Lab'];

  function parseAmazon(lines) {
    const text = lines.join('\n');
    const invoice = { source: 'amazon', vendor: 'Amazon', order_number: null,
      order_date: null, invoice_number: null, grand_total: null,
      items_subtotal: null, line_items: [], warnings: [] };

    invoice.order_number = (text.match(/Order\s*#\s*([\d-]+)/) || [])[1] || null;
    invoice.order_date = (text.match(/Order placed\s+(\w+\s+\d{1,2},\s*\d{4})/) || [])[1] || null;
    const gt = text.match(/Grand Total:\s*\$?([\d,]+\.\d{2})/);
    if (gt) invoice.grand_total = money(gt[1]);

    // Item blocks anchor on "Sold by:"
    const positions = [];
    const re = /Sold by:/g;
    let m;
    while ((m = re.exec(text))) positions.push(m.index);

    for (const pos of positions) {
      const after = text.slice(pos);
      const seller = (after.match(/Sold by:\s*(.+?)(?:\n|$)/) || [, 'Unknown'])[1].trim();
      const priceM = after.match(/\$(\d+\.\d{2})/);
      const price = priceM ? parseFloat(priceM[1]) : null;

      // Title: last block of lines before "Sold by:"
      const before = text.slice(0, pos).trimEnd().split('\n');
      const titleLines = [];
      for (let j = before.length - 1; j >= 0; j--) {
        const line = before[j].trim();
        if (!line) break;
        if (['Delivered', 'Your package', 'Order placed', 'Ship to', 'Payment method',
          'Order Summary', 'Item(s)'].some((p) => line.startsWith(p))) break;
        if (line.startsWith('$') || line.startsWith('Return or replace')) break;
        titleLines.unshift(line);
      }
      let title = titleLines.join(' ').replace(/\s+/g, ' ').trim();
      if (!title || title.length < 5) continue;

      const lower = title.toLowerCase();
      let category = 'other';
      outer: for (const [cat, keywords] of Object.entries(AMAZON_CATEGORIES)) {
        for (const kw of keywords) {
          if (lower.includes(kw)) { category = cat; break outer; }
        }
      }

      let brand = KNOWN_BRANDS.find((b) => lower.includes(b.toLowerCase())) || null;
      if (!brand) {
        const first = title.split(' ')[0] || '';
        if (first === first.toUpperCase() && first.length > 2 && /^[A-Z]/.test(first)) brand = first;
      }

      let quantity = 1, unit = 'pcs';
      const sheets = title.match(/(\d+)\s*Sheets?/i);
      const pack = title.match(/(\d+)\s*Pack\b/i);
      const pcs = title.match(/(\d+)\s*Pcs\b/i);
      if (sheets) { quantity = parseInt(sheets[1], 10); unit = 'sheets'; }
      else if (pack) quantity = parseInt(pack[1], 10);
      else if (pcs) quantity = parseInt(pcs[1], 10);

      invoice.line_items.push({
        name: title, category, brand, sku: null, quantity, unit,
        unit_price: price, line_total: price, subcategory: null,
        vendor: `Amazon (${seller})`, purchase_date: normalizeDate(invoice.order_date),
        description: null, filament: null, warnings: [],
      });
    }

    return invoice;
  }

  // ------------------------------------------------------------------

  /**
   * Extract text from a loaded pdf.js document in the three shapes the
   * parsers consume: joined reading-order `lines` (Amazon/order pages),
   * flat `cells` (heuristic Bambu fallback), and per-page positioned
   * `pages` [{str, x, y, font}] (geometry parser). Lives here so the
   * import view and test harnesses share one extraction.
   */
  async function extractFromPdf(pdf) {
    const lines = [], cells = [], pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageCells = [];
      const rows = new Map();
      for (const it of content.items) {
        if (!it.str || !it.str.trim()) continue;
        const y = Math.round(it.transform[5] / 3) * 3;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push({ x: it.transform[4], y: it.transform[5], str: it.str.trim(), font: it.fontName });
      }
      const sortedY = [...rows.keys()].sort((a, b) => b - a);
      for (const y of sortedY) {
        const rowCells = rows.get(y).sort((a, b) => a.x - b.x);
        lines.push(rowCells.map((c) => c.str).join(' ').replace(/\s+/g, ' ').trim());
        cells.push(...rowCells.map((c) => c.str));
        pageCells.push(...rowCells);
      }
      lines.push('');
      pages.push(pageCells);
    }
    return { lines, cells, pages };
  }

  /**
   * Auto-detect vendor and parse.
   * `extracted` is {lines, cells, pages} from extractFromPdf (joined lines
   * for Amazon/order-page layouts, raw cells + positioned pages for the
   * Bambu invoice table), or a plain lines array.
   */
  function parse(extracted, vendorHint) {
    const lines = Array.isArray(extracted) ? extracted : extracted.lines;
    const cells = Array.isArray(extracted) ? null : extracted.cells;
    const pages = Array.isArray(extracted) ? null : extracted.pages;
    const text = lines.join('\n').toLowerCase();
    const vendor = vendorHint
      || (text.includes('bambu') ? 'bambulab'
        : (text.includes('amazon') || /order\s*#\s*[\d-]{10,}/.test(text)) ? 'amazon'
        : 'bambulab');
    const invoice = vendor === 'amazon' ? parseAmazon(lines) : parseBambu(lines, cells, pages);
    invoice.detected_vendor = vendor;
    return invoice;
  }

  return { parse, parseBambu, parseAmazon, extractFromPdf, classifyProduct };
})();
