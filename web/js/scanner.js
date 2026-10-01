/* Scanner view — camera barcode/QR scanning with two engines:
 *   1. Native BarcodeDetector API (Chrome/Edge desktop + Android)
 *   2. ZXing-JS fallback (iOS Safari/Edge/Chrome — all WebKit, no native API):
 *      lazily loads js/vendor/zxing.min.js and decodes video frames via canvas
 * Camera requires HTTPS on both paths. Manual entry works everywhere.
 * Scans resolve to items (barcode/SKU/UPC) or locations (makervault:// QR). */

window.Views = window.Views || {};

Views.scanner = (() => {
  const { h } = UI;

  let stream = null;
  let scanning = false;
  let video = null;
  let resultEl = null;
  let statusEl = null;

  // Audit mode: camera stays live, every scan adjusts stock in place —
  // the stocktake workflow. Session state resets when the view re-renders.
  let auditMode = JSON.parse(localStorage.getItem('mv-audit-mode') || 'false');
  let auditEl = null;
  const session = new Map();     // itemId → { item, scans }
  const recentReads = new Map(); // code → timestamp (duplicate-read cooldown)
  const READ_COOLDOWN_MS = 2500;

  // ------------------------------------------------------------------
  // Detection engines
  // ------------------------------------------------------------------

  let zxingLoading = null;

  function loadZXing() {
    if (typeof ZXing !== 'undefined') return Promise.resolve();
    if (zxingLoading) return zxingLoading;
    zxingLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/zxing.min.js?v=3';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load the barcode decoder'));
      document.head.appendChild(s);
    });
    return zxingLoading;
  }

  /** Returns { detect(video) -> Promise<string[]>, engine } or null. */
  async function createDetector() {
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const want = ['qr_code', 'code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39']
          .filter((f) => supported.includes(f));
        if (want.length) {
          const d = new window.BarcodeDetector({ formats: want });
          return {
            engine: 'native',
            detect: async (vid) => (await d.detect(vid)).map((b) => b.rawValue).filter(Boolean),
          };
        }
      } catch (_) { /* fall through to ZXing */ }
    }

    await loadZXing();
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.CODE_39,
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new ZXing.MultiFormatReader();
    reader.setHints(hints);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    return {
      engine: 'zxing',
      detect: async (vid) => {
        if (!vid.videoWidth) return [];
        // Downscale big frames — decoding is CPU-bound on iOS
        const scale = Math.min(1, 800 / vid.videoWidth);
        canvas.width = Math.round(vid.videoWidth * scale);
        canvas.height = Math.round(vid.videoHeight * scale);
        ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
        try {
          const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
          const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
          const result = reader.decode(bitmap);
          reader.reset();
          return [result.getText()];
        } catch (_) {
          return []; // NotFoundException — no code in this frame
        }
      },
    };
  }

  // ------------------------------------------------------------------
  // View
  // ------------------------------------------------------------------

  async function render(main) {
    stopCamera();
    session.clear();
    recentReads.clear();

    resultEl = h('div');
    auditEl = h('div');
    statusEl = h('div', { style: { color: 'var(--text-faint)', fontSize: '12px', marginTop: '6px' } });
    video = h('video', {
      autoplay: true, playsinline: true, muted: true,
      style: { width: '100%', maxHeight: '340px', borderRadius: '10px', background: '#000', objectFit: 'cover' },
    });
    // iOS Safari also wants the attribute form, not just the property
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');

    const manualInput = h('input', {
      type: 'search', placeholder: 'Or type/paste a barcode, SKU, or UPC…',
      onkeydown: (e) => { if (e.key === 'Enter') handleCode(e.target.value.trim()); },
    });

    const cameraArea = window.isSecureContext
      ? h('div.card',
          video,
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' } },
            h('button.btn.primary#scan-btn', { onclick: toggleCamera }, '📷 Start Camera'),
            h('button.btn#torch-btn', { onclick: toggleTorch, style: { display: 'none' } }, '🔦 Light'),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginLeft: 'auto', fontSize: '13px' } },
              h('input', { type: 'checkbox', checked: auditMode,
                onchange: (e) => {
                  auditMode = e.target.checked;
                  localStorage.setItem('mv-audit-mode', JSON.stringify(auditMode));
                  UI.toast(auditMode
                    ? 'Audit mode: camera keeps running, scans adjust stock in place'
                    : 'Audit mode off');
                } }),
              '📋 Audit mode')),
          statusEl)
      : h('div.card',
          h('div.empty-state',
            h('div.big', '🔒'),
            'Camera scanning needs HTTPS — open the site via your https:// portal, or type the code below.'));

    main.replaceChildren(
      h('div.page-header',
        h('div', h('h1', 'Scan'),
          h('div.page-sub', 'Scan an item barcode or a location QR label'))),
      cameraArea,
      auditEl,
      h('div', { style: { margin: '14px 0' } }, manualInput),
      resultEl,
    );
  }

  async function toggleCamera() {
    const btn = document.getElementById('scan-btn');
    if (scanning) {
      stopCamera();
      btn.textContent = '📷 Start Camera';
      statusEl.textContent = '';
      return;
    }
    try {
      btn.disabled = true;
      statusEl.textContent = 'Starting…';

      const detector = await createDetector();

      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play().catch(() => { /* autoplay policies — playsinline covers iOS */ });

      scanning = true;
      btn.textContent = '⏹ Stop Camera';
      statusEl.textContent = detector.engine === 'native'
        ? 'Scanning…' : 'Scanning… (compatibility decoder)';
      syncTorchButton();
      scanLoop(detector);
    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'Camera permission denied — allow camera access for this site in browser settings.'
        : 'Camera failed: ' + err.message;
      UI.toast(msg, true);
      statusEl.textContent = msg;
      stopCamera();
    } finally {
      btn.disabled = false;
    }
  }

  // Torch (flashlight) — offered only when the camera reports support
  let torchOn = false;

  function syncTorchButton() {
    const btn = document.getElementById('torch-btn');
    if (!btn) return;
    const track = stream?.getVideoTracks?.()[0];
    const supported = !!track?.getCapabilities?.().torch;
    btn.style.display = supported ? '' : 'none';
    btn.classList.toggle('primary', torchOn);
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      torchOn = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      syncTorchButton();
    } catch (_) {
      torchOn = false;
      UI.toast('Flashlight not available on this camera', true);
    }
  }

  function stopCamera() {
    scanning = false;
    torchOn = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (video) video.srcObject = null;
    syncTorchButton();
  }

  function scanLoop(detector) {
    // Native detection is cheap (run often); ZXing is CPU-bound (throttle)
    const interval = detector.engine === 'native' ? 120 : 280;
    const tick = async () => {
      if (!scanning || !video.srcObject) return;
      try {
        if (video.readyState >= 2) {
          const values = await detector.detect(video);
          if (values.length && values[0]) {
            const code = values[0];
            if (auditMode) {
              // Camera stays live; ignore re-reads of the same code briefly
              const last = recentReads.get(code) || 0;
              if (Date.now() - last > READ_COOLDOWN_MS) {
                recentReads.set(code, Date.now());
                if (navigator.vibrate) navigator.vibrate(60);
                handleAuditCode(code);
              }
            } else {
              stopCamera();
              const btn = document.getElementById('scan-btn');
              if (btn) btn.textContent = '📷 Start Camera';
              if (statusEl) statusEl.textContent = '';
              if (navigator.vibrate) navigator.vibrate(80);
              handleCode(code);
              return;
            }
          }
        }
      } catch (_) { /* detector hiccup — keep scanning */ }
      setTimeout(tick, interval);
    };
    tick();
  }

  // ------------------------------------------------------------------
  // Audit mode: resolve a scan to one item and adjust stock in place
  // ------------------------------------------------------------------

  async function resolveItem(code) {
    const m = code.match(/^makervault:\/\/item\/(.+)$/);
    if (m) {
      try { return [await API.getItem(m[1])]; } catch (_) { return []; }
    }
    if (code.startsWith('makervault://')) return 'location';
    return API.lookupItems(code);
  }

  async function handleAuditCode(code) {
    let items;
    try {
      items = await resolveItem(code);
    } catch (err) {
      UI.toast(err.message, true);
      return;
    }
    if (items === 'location') {
      try {
        const data = await API.locationByQR(code);
        UI.toast(`📍 ${data.location.name} — ${data.items.length} item(s)`);
      } catch (_) {
        UI.toast('Unknown location QR', true);
      }
      return;
    }
    if (!items.length) {
      UI.toast(`No item for "${code}"`, true);
      return;
    }
    if (items.length > 1) {
      UI.toast(`${items.length} items share "${code}" — use normal mode to pick`, true);
      return;
    }

    const item = items[0];
    const entry = session.get(item.id) || { item, scans: 0 };
    entry.scans++;
    entry.item = item;
    session.set(item.id, entry);
    renderAuditPanel(item.id);
  }

  function renderAuditPanel(currentId) {
    const entry = session.get(currentId);
    const item = entry.item;

    const qtyEl = h('span', { style: { fontSize: '24px', fontWeight: 700, minWidth: '56px', textAlign: 'center' } },
      String(item.quantity));

    const adjust = async (delta) => {
      const next = Math.max(0, item.quantity + delta);
      if (next === item.quantity) return;
      try {
        const updated = await API.updateItem(item.id, { quantity: next });
        item.quantity = updated.quantity ?? next;
        qtyEl.textContent = String(item.quantity);
        session.get(item.id).item = item;
      } catch (err) {
        UI.toast(err.message, true);
      }
    };

    const sessionRows = [...session.values()]
      .sort((a, b) => b.scans - a.scans)
      .map((e) => h('div.activity-row',
        h('span.activity-details', e.item.name),
        h('span.activity-action', `×${e.scans} scan${e.scans === 1 ? '' : 's'}`),
        h('span.activity-time', `qty ${e.item.quantity}`)));

    auditEl.replaceChildren(
      h('div.card', { style: { marginTop: '12px', borderColor: 'var(--accent)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
          h('div', { style: { flex: 1, minWidth: '140px' } },
            h('div', { style: { fontWeight: 700 } }, item.name),
            h('div', { style: { color: 'var(--text-dim)', fontSize: '12.5px' } },
              [item.brand, item.sku, App.locationName(item.location_id)].filter(Boolean).join(' · '))),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('button.qty-btn', { onclick: () => adjust(-1), style: { width: '38px', height: '38px', fontSize: '19px' } }, '−'),
            qtyEl,
            h('button.qty-btn', { onclick: () => adjust(1), style: { width: '38px', height: '38px', fontSize: '19px' } }, '+')),
          h('button.btn.small', { onclick: () => Views.inventory.openDetail(item.id) }, 'Details')),
        session.size ? h('div', { style: { marginTop: '10px' } },
          h('h3.section-title', `This session (${session.size} item${session.size === 1 ? '' : 's'})`),
          sessionRows) : null,
      ),
    );
  }

  // ------------------------------------------------------------------
  // Code resolution
  // ------------------------------------------------------------------

  async function handleCode(code) {
    if (!code) return;
    // Manual entry respects audit mode too
    if (auditMode) {
      handleAuditCode(code);
      return;
    }
    resultEl.replaceChildren(h('div.spinner'));

    try {
      // Item QR labels encode makervault://item/<id> — straight to the sheet
      const itemQR = code.match(/^makervault:\/\/item\/(.+)$/);
      if (itemQR) {
        resultEl.replaceChildren();
        Views.inventory.openDetail(itemQR[1]);
        return;
      }
      if (code.startsWith('makervault://')) {
        const data = await API.locationByQR(code);
        showLocationResult(data.location, data.items);
        return;
      }

      const items = await API.lookupItems(code);
      if (items.length) {
        showItemResults(items, code);
        return;
      }

      try {
        const data = await API.locationByQR(code);
        showLocationResult(data.location, data.items);
        return;
      } catch (_) { /* not a location either */ }

      resultEl.replaceChildren(
        h('div.card',
          h('div.empty-state',
            h('div.big', '🔍'),
            h('div', { style: { marginBottom: '10px' } }, `No match for "${code}"`),
            h('button.btn.primary', {
              onclick: () => Views.inventory.openAddItem({ barcode: code }),
            }, '＋ Add item with this barcode'))),
      );
    } catch (err) {
      resultEl.replaceChildren(h('div.card', '⚠️ ' + err.message));
    }
  }

  function showItemResults(items, code) {
    resultEl.replaceChildren(
      h('div.card',
        h('h3.section-title', `Scanned: ${code}`),
        h('div.item-list', items.map((item) =>
          h('div.item-row', { onclick: () => Views.inventory.openDetail(item.id) },
            h('div.item-main',
              h('div.item-name', item.name, ' ', UI.stockBadge(item)),
              h('div.item-sub', [item.brand, item.sku, App.locationName(item.location_id)].filter(Boolean).join(' · '))),
            h('div.qty-value', String(item.quantity), h('span.unit', item.unit))))),
      ),
    );
  }

  function showLocationResult(location, items) {
    resultEl.replaceChildren(
      h('div.card',
        h('h3.section-title', `Location: ${location.name}`),
        h('div', { style: { color: 'var(--text-dim)', marginBottom: '10px' } },
          `${items.length} item(s) stored here`),
        h('div.item-list', items.map((item) =>
          h('div.item-row', { onclick: () => Views.inventory.openDetail(item.id) },
            h('div.item-main',
              h('div.item-name', item.name),
              h('div.item-sub', [item.brand, item.sku].filter(Boolean).join(' · '))),
            h('div.qty-value', String(item.quantity), h('span.unit', item.unit))))),
      ),
    );
  }

  return { render, cleanup: stopCamera };
})();
