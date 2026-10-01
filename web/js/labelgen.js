/* LabelGen — client-side label rendering engine.
 *
 * Canvas port of the Python pipeline (generators/label_renderer.py,
 * label_composer.py, barcode_generator.py):
 *   - token substitution ({name}, {sku}, {color}, {location}, …)
 *   - per-line proportional heights by font size, auto-fit shrink,
 *     word wrap, split rows, line background fills
 *   - filament color circle with gradient/split/sparkle/silk/marble overlays
 *   - Code 128 barcode (auto B/C subset) drawn as crisp rects — no
 *     interpolation, so the LANCZOS scan-damage bug from Phase 4 cannot recur
 *   - QR codes via the vendored qrcode-generator lib
 *   - composition layouts: text-only / text+barcode / text+QR / all three
 */

const LabelGen = (() => {

  const MM_TO_PX = (mm, dpi) => Math.max(1, Math.round(mm * dpi / 25.4));

  // ------------------------------------------------------------------
  // Token substitution (ports substitute_tokens)
  // ------------------------------------------------------------------

  const ITEM_TOKENS = [
    'name', 'sku', 'upc', 'barcode', 'category', 'brand', 'vendor',
    'quantity', 'unit', 'description', 'subcategory', 'color', 'color_hex',
  ];
  const LOCATION_TOKENS = { location: 'name', location_type: 'type', qr_code_value: 'qr_code_value' };

  function substituteTokens(text, item, location) {
    if (!text) return text || '';
    let out = text;
    if (item) {
      for (const t of ITEM_TOKENS) {
        out = out.replaceAll(`{${t}}`, String(item[t] ?? ''));
      }
    }
    if (location) {
      for (const [token, field] of Object.entries(LOCATION_TOKENS)) {
        out = out.replaceAll(`{${token}}`, String(location[field] ?? ''));
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Fonts
  // ------------------------------------------------------------------

  function fontString(family, weight, sizePt, dpi) {
    const px = Math.max(4, sizePt * dpi / 72);
    const fam = (family || 'Inter').toLowerCase().includes('mono')
      ? '"JetBrains Mono", ui-monospace, Menlo, monospace'
      : 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif';
    const w = (weight || 'regular').toLowerCase() === 'bold' ? '700' : '400';
    return `${w} ${px}px ${fam}`;
  }

  function measure(ctx, text) {
    const m = ctx.measureText(text);
    return {
      width: m.width,
      ascent: m.actualBoundingBoxAscent ?? m.fontBoundingBoxAscent ?? 10,
      descent: m.actualBoundingBoxDescent ?? m.fontBoundingBoxDescent ?? 3,
      lineHeight: (m.fontBoundingBoxAscent ?? 10) + (m.fontBoundingBoxDescent ?? 3),
    };
  }

  // ------------------------------------------------------------------
  // Filament color circle (ports the {color} circle + overlays)
  // ------------------------------------------------------------------

  const SPARKLE_POSITIONS = [
    [0.25, 0.20], [0.65, 0.30], [0.40, 0.55], [0.75, 0.70],
    [0.20, 0.75], [0.55, 0.15], [0.80, 0.45], [0.35, 0.85],
    [0.50, 0.40], [0.15, 0.45], [0.70, 0.55], [0.45, 0.70],
  ];
  const MARBLE_SPECS = [
    [0.15, 0.25, 0.08], [0.60, 0.15, 0.06], [0.35, 0.45, 0.10],
    [0.80, 0.55, 0.07], [0.25, 0.70, 0.09], [0.70, 0.35, 0.05],
    [0.45, 0.80, 0.06], [0.10, 0.50, 0.04], [0.55, 0.60, 0.08],
    [0.85, 0.20, 0.05], [0.30, 0.15, 0.04], [0.50, 0.30, 0.06],
    [0.20, 0.85, 0.05], [0.75, 0.75, 0.07], [0.40, 0.65, 0.04],
  ];

  function drawColorCircle(ctx, cx, cy, d, item) {
    const hex = item.color_hex;
    if (!hex) return;
    const mode = item.color_mode || 'solid';
    const material = (item.material || '').toLowerCase();
    const r = d / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx + r, cy + r, r, 0, Math.PI * 2);
    ctx.clip();

    if (mode === 'gradient' && item.color_hex2) {
      // Left half color1, right half color2 (pieslice equivalent)
      ctx.fillStyle = hex;
      ctx.fillRect(cx, cy, r, d);
      ctx.fillStyle = item.color_hex2;
      ctx.fillRect(cx + r, cy, r, d);
    } else if (mode === 'split') {
      const colors = [hex, item.color_hex2, item.color_hex3, item.color_hex4].filter(Boolean);
      const stripe = d / colors.length;
      colors.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(cx + i * stripe, cy, stripe + 1, d);
      });
    } else {
      ctx.fillStyle = hex;
      ctx.fillRect(cx, cy, d, d);
    }

    // Silk: diagonal sheen (gradient stops from the SwiftUI overlay)
    if (mode === 'silk' || material.includes('silk')) {
      const g = ctx.createLinearGradient(cx, cy, cx + d, cy + d);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
      g.addColorStop(0.65, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx, cy, d, d);
    }

    // Sparkle: 4-pointed stars at deterministic positions
    if (mode === 'sparkle' || material.includes('sparkle') || material.includes('galaxy')) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const s = Math.max(1.5, d * 0.06);
      for (const [xf, yf] of SPARKLE_POSITIONS) {
        const x = cx + xf * d, y = cy + yf * d;
        ctx.beginPath();
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s * 0.3, y - s * 0.3);
        ctx.lineTo(x + s, y);
        ctx.lineTo(x + s * 0.3, y + s * 0.3);
        ctx.lineTo(x, y + s);
        ctx.lineTo(x - s * 0.3, y + s * 0.3);
        ctx.lineTo(x - s, y);
        ctx.lineTo(x - s * 0.3, y - s * 0.3);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Marble: grey specs
    if (material.includes('marble')) {
      ctx.fillStyle = 'rgba(128,128,128,0.35)';
      for (const [xf, yf, sf] of MARBLE_SPECS) {
        ctx.beginPath();
        ctx.arc(cx + xf * d, cy + yf * d, sf * d / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Circle border
    ctx.strokeStyle = 'rgb(100,100,100)';
    ctx.lineWidth = Math.max(1, d / 20);
    ctx.beginPath();
    ctx.arc(cx + r, cy + r, r - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ------------------------------------------------------------------
  // Text block renderer (ports render_label onto a ctx region)
  // ------------------------------------------------------------------

  function renderTextRegion(ctx, region, tmpl, item, location, dpi) {
    const { x: rx, y: ry, w: wPx, h: hPx } = region;
    const padPx = MM_TO_PX(tmpl.padding_mm ?? 1.0, dpi);
    const borderPx = tmpl.border_enabled ? MM_TO_PX(tmpl.border_thickness ?? 0.5, dpi) : 0;
    const autoFit = tmpl.auto_fit !== false;

    const x0 = rx + padPx + borderPx;
    const y0 = ry + padPx + borderPx;
    const x1 = rx + wPx - padPx - borderPx;
    const availW = Math.max(1, x1 - x0);
    const availH = Math.max(1, hPx - 2 * (padPx + borderPx));

    const lines = tmpl.lines || [];
    if (!lines.length) return;

    // Resolve text per line; empty lines collapse to zero height
    const resolved = lines.map((cfg) => {
      const text = substituteTokens(cfg.text || '', item, location);
      const splitText = substituteTokens(cfg.split_text || '', item, location);
      const hasContent = !!text.trim() || (cfg.split && !!splitText.trim());
      return { cfg, text, splitText, hasContent, originalText: cfg.text || '' };
    });

    const visibleFontTotal = resolved
      .filter((r) => r.hasContent)
      .reduce((sum, r) => sum + (r.cfg.font_size ?? 12), 0) || 12;

    const lineHeights = resolved.map((r) =>
      r.hasContent ? availH * ((r.cfg.font_size ?? 12) / visibleFontTotal) : 0);

    resolved.forEach((r, idx) => {
      const cfg = r.cfg;
      const fontFamily = cfg.font_family || 'Inter';
      const fontWeight = cfg.font_weight || 'regular';
      const fontSize = cfg.font_size ?? 12;
      const fontColor = cfg.font_color || '#000000';
      const alignment = cfg.alignment || 'center';
      const ly = y0 + lineHeights.slice(0, idx).reduce((a, b) => a + b, 0);
      const lh = lineHeights[idx];

      // Line background: edge-to-edge cell fill
      if (cfg.background_color) {
        let bgTop = ly, bgBottom = ly + lh;
        if (idx === 0) bgTop = ry + borderPx;
        if (idx === resolved.length - 1) bgBottom = ry + hPx - borderPx;
        ctx.fillStyle = cfg.background_color;
        ctx.fillRect(rx + borderPx, bgTop, wPx - 2 * borderPx, bgBottom - bgTop);
      }

      // --- Split row: two texts side by side ---
      if (cfg.split) {
        const gapPx = MM_TO_PX(2, dpi);
        const halfW = (availW - gapPx) / 2;
        for (const [side, sideText] of [['left', r.text], ['right', r.splitText]]) {
          if (!sideText.trim()) continue;
          let size = fontSize;
          ctx.font = fontString(fontFamily, fontWeight, size, dpi);
          if (autoFit) {
            while (measure(ctx, sideText).width > halfW && size > 4) {
              size -= 0.5;
              ctx.font = fontString(fontFamily, fontWeight, size, dpi);
            }
          }
          const m = measure(ctx, sideText);
          const tx = side === 'left' ? x0 : x1 - m.width;
          const baseline = ly + (lh - (m.ascent + m.descent)) / 2 + m.ascent;
          ctx.fillStyle = fontColor;
          ctx.fillText(sideText, tx, baseline);
        }
        return;
      }

      if (!r.text.trim()) return;

      let size = fontSize;
      ctx.font = fontString(fontFamily, fontWeight, size, dpi);

      // Word-wrap path: wrap at original size, shrink only if the block
      // exceeds the line's cell height
      if (cfg.text_wrap && autoFit) {
        const wrap = () => {
          if (measure(ctx, r.text).width <= availW) return [r.text];
          const words = r.text.split(/\s+/);
          const out = [];
          let cur = '';
          for (const word of words) {
            const test = (cur + ' ' + word).trim();
            if (measure(ctx, test).width <= availW) {
              cur = test;
            } else {
              if (cur) out.push(cur);
              cur = word;
            }
          }
          if (cur) out.push(cur);
          return out;
        };

        let wrapped = wrap();
        let m = measure(ctx, 'Mg');
        let subLineH = m.ascent + m.descent;
        while (subLineH * wrapped.length > lh && size > 4) {
          size -= 0.5;
          ctx.font = fontString(fontFamily, fontWeight, size, dpi);
          wrapped = wrap();
          m = measure(ctx, 'Mg');
          subLineH = m.ascent + m.descent;
        }

        const startY = ly + (lh - subLineH * wrapped.length) / 2;
        ctx.fillStyle = fontColor;
        wrapped.forEach((wline, wi) => {
          const wm = measure(ctx, wline);
          const tx = alignment === 'left' ? x0
            : alignment === 'right' ? x1 - wm.width
            : x0 + (availW - wm.width) / 2;
          ctx.fillText(wline, tx, startY + wi * subLineH + wm.ascent);
        });
        return;
      }

      // Auto-fit: shrink until it fits the available width
      if (autoFit) {
        while (measure(ctx, r.text).width > availW && size > 4) {
          size -= 0.5;
          ctx.font = fontString(fontFamily, fontWeight, size, dpi);
        }
      }

      const m = measure(ctx, r.text);
      const tx = alignment === 'left' ? x0
        : alignment === 'right' ? x1 - m.width
        : x0 + (availW - m.width) / 2;
      const baseline = ly + (lh - (m.ascent + m.descent)) / 2 + m.ascent;
      ctx.fillStyle = fontColor;
      ctx.fillText(r.text, tx, baseline);

      // Color circle when the line uses the {color} token
      if (item && r.originalText.includes('{color}') && item.color_hex) {
        const d = Math.floor(lh * 0.7);
        drawColorCircle(ctx, x1 - d - padPx, ly + (lh - d) / 2, d, item);
      }
    });
  }

  // ------------------------------------------------------------------
  // Code 128 encoder (subset B with C optimization for digit runs)
  // ------------------------------------------------------------------

  // Bar/space widths for symbols 0-106, as 6-digit strings.
  const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
    '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
    '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
    '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
    '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
    '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
    '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
    '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
    '114131 311141 411131 211412 211214 211232 2331112').split(' ');

  function code128Encode(value) {
    // Choose codes: use subset C for runs of 4+ digits, else subset B
    const codes = [];
    let i = 0;
    let mode = null; // 'B' | 'C'
    const digitsAhead = (pos) => {
      let n = 0;
      while (pos + n < value.length && /\d/.test(value[pos + n])) n++;
      return n;
    };

    while (i < value.length) {
      const run = digitsAhead(i);
      const useC = run >= 4 && (run % 2 === 0 || run >= 6);
      if (useC) {
        if (mode !== 'C') {
          codes.push(mode === null ? 105 : 99); // Start C or switch C
          mode = 'C';
        }
        let take = run % 2 === 0 ? run : run - 1;
        for (let k = 0; k < take; k += 2) {
          codes.push(parseInt(value.substr(i + k, 2), 10));
        }
        i += take;
      } else {
        if (mode !== 'B') {
          codes.push(mode === null ? 104 : 100); // Start B or switch B
          mode = 'B';
        }
        const ch = value.charCodeAt(i);
        if (ch < 32 || ch > 126) {
          throw new Error(`Character not encodable in Code 128 B: "${value[i]}"`);
        }
        codes.push(ch - 32);
        i += 1;
      }
    }
    if (!codes.length) throw new Error('Empty barcode value');

    // Checksum
    let sum = codes[0];
    for (let k = 1; k < codes.length; k++) sum += codes[k] * k;
    codes.push(sum % 103);
    codes.push(106); // Stop

    // Expand to module widths
    const modules = [];
    for (const c of codes) {
      for (const d of C128[c]) modules.push(parseInt(d, 10));
    }
    return modules; // alternating bar/space widths, starting with a bar
  }

  /** Draw a Code 128 barcode into a region. Crisp integer-px modules. */
  function drawCode128(ctx, value, region, dpi, showText) {
    const { x, y, w, h } = region;
    const modules = code128Encode(value);
    const totalModules = modules.reduce((a, b) => a + b, 0);
    const quiet = 10; // quiet zone in modules each side

    // Integer module width for crisp bars (the NEAREST-interpolation lesson)
    const moduleW = Math.max(1, Math.floor(w / (totalModules + quiet * 2)));
    const barcodeW = totalModules * moduleW;
    const startX = Math.round(x + (w - barcodeW) / 2);

    let textH = 0;
    if (showText) {
      const fontPx = Math.max(8, Math.min(h * 0.22, 10 * dpi / 72));
      textH = fontPx * 1.3;
      ctx.font = `400 ${fontPx}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = '#000000';
      const tw = ctx.measureText(value).width;
      ctx.fillText(value, x + (w - tw) / 2, y + h - fontPx * 0.25);
    }

    const barH = Math.max(4, h - textH);
    ctx.fillStyle = '#000000';
    let cx = startX;
    modules.forEach((mw, idx) => {
      const wpx = mw * moduleW;
      if (idx % 2 === 0) ctx.fillRect(cx, y, wpx, barH);
      cx += wpx;
    });
  }

  // ------------------------------------------------------------------
  // QR (vendored qrcode-generator)
  // ------------------------------------------------------------------

  function drawQR(ctx, value, region) {
    const { x, y, w } = region;
    const qr = qrcode(0, 'M'); // auto version, M error correction
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const cell = Math.max(1, Math.floor(w / (count + 2))); // 1-module quiet zone each side
    const size = cell * count;
    const ox = Math.round(x + (w - size) / 2);
    const oy = Math.round(y + (w - size) / 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(ox - cell, oy - cell, size + 2 * cell, size + 2 * cell);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
      }
    }
  }

  // ------------------------------------------------------------------
  // Composer (ports compose_label layout rules)
  // ------------------------------------------------------------------

  /**
   * Render a full label onto a fresh canvas and return it.
   * opts: { template, item, location, includeBarcode, includeQR,
   *         barcodeHeightPercent, barcodeShowText, qrSizePercent, dpi }
   */
  function render(opts) {
    const tmpl = opts.template;
    const dpi = opts.dpi || 150;
    const item = opts.item || null;
    const location = opts.location || null;

    const wMm = tmpl.width_mm;
    const hMm = tmpl.height_mm;
    const wPx = MM_TO_PX(wMm, dpi);
    const hPx = MM_TO_PX(hMm, dpi);
    const padPx = MM_TO_PX(tmpl.padding_mm ?? 1.0, dpi);

    const canvas = document.createElement('canvas');
    canvas.width = wPx;
    canvas.height = hPx;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = tmpl.background_color || '#FFFFFF';
    ctx.fillRect(0, 0, wPx, hPx);

    const barcodeValue = opts.includeBarcode && item
      ? (item.barcode || item.sku || item.upc || null) : null;
    // qrValue override lets callers encode anything (e.g. an item QR);
    // default remains the bound location's QR value
    const qrValue = opts.includeQR
      ? (opts.qrValue || (location && location.qr_code_value) || null)
      : null;

    const bcPct = Math.min(70, Math.max(15, opts.barcodeHeightPercent ?? 35)) / 100;
    const qrPct = Math.min(50, Math.max(15, opts.qrSizePercent ?? 30)) / 100;

    let textRegion = { x: 0, y: 0, w: wPx, h: hPx };

    if (barcodeValue && qrValue) {
      const textH = hPx * (1 - bcPct);
      const qrSize = Math.min(wPx * qrPct, textH);
      textRegion = { x: 0, y: 0, w: wPx - qrSize - padPx, h: textH };
      renderTextRegion(ctx, textRegion, tmpl, item, location, dpi);
      drawQR(ctx, qrValue, { x: wPx - qrSize - padPx, y: padPx, w: qrSize });
      drawCode128(ctx, barcodeValue,
        { x: padPx, y: textH, w: wPx - 2 * padPx, h: hPx * bcPct - padPx },
        dpi, opts.barcodeShowText !== false);
    } else if (barcodeValue) {
      const textH = hPx * (1 - bcPct);
      textRegion = { x: 0, y: 0, w: wPx, h: textH };
      renderTextRegion(ctx, textRegion, tmpl, item, location, dpi);
      drawCode128(ctx, barcodeValue,
        { x: padPx, y: textH, w: wPx - 2 * padPx, h: hPx * bcPct - padPx },
        dpi, opts.barcodeShowText !== false);
    } else if (qrValue) {
      const qrSize = Math.min(wPx * qrPct, hPx - 2 * padPx);
      textRegion = { x: 0, y: 0, w: wPx - qrSize - padPx, h: hPx };
      renderTextRegion(ctx, textRegion, tmpl, item, location, dpi);
      drawQR(ctx, qrValue, { x: wPx - qrSize - padPx, y: padPx, w: qrSize });
    } else {
      renderTextRegion(ctx, textRegion, tmpl, item, location, dpi);
    }

    // Border last, on top
    if (tmpl.border_enabled) {
      const bw = Math.max(1, MM_TO_PX(tmpl.border_thickness ?? 0.5, dpi));
      ctx.strokeStyle = tmpl.border_color || '#000000';
      ctx.lineWidth = bw;
      ctx.strokeRect(bw / 2, bw / 2, wPx - bw, hPx - bw);
    }

    return canvas;
  }

  return { render, substituteTokens, code128Encode };
})();
