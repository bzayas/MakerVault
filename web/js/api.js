/* MakerVault web — API client. Thin wrapper over the PHP endpoints in /api. */

const API = (() => {
  const BASE = 'api';

  // ------------------------------------------------------------------
  // Offline outbox — item mutations that fail with a NETWORK error (not a
  // server 4xx/5xx) are queued in localStorage and replayed in order when
  // the connection returns. Item creates carry client-generated UUIDs so a
  // queued create replays with the same identity.
  // ------------------------------------------------------------------

  const OUTBOX_KEY = 'mv-outbox';
  // Only queue plain item edits — uploads/imports/restores need the server
  const QUEUEABLE = /^items\.php(\?(?!.*action=batch).*)?$/;

  const outbox = {
    read: () => JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'),
    write: (entries) => localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries)),
    push(entry) {
      const entries = outbox.read();
      entries.push(entry);
      outbox.write(entries);
      notify();
    },
    count: () => outbox.read().length,
  };

  let listeners = [];
  function notify() {
    listeners.forEach((fn) => fn(outbox.count()));
  }

  let replaying = false;
  async function replayOutbox() {
    if (replaying || !navigator.onLine) return { replayed: 0, dropped: 0 };
    replaying = true;
    let replayed = 0;
    let dropped = 0;
    try {
      let entries = outbox.read();
      while (entries.length) {
        const e = entries[0];
        let res;
        try {
          res = await fetch(`${BASE}/${e.path}`, {
            method: e.method,
            headers: { 'Content-Type': 'application/json' },
            body: e.body ?? undefined,
          });
        } catch (_) {
          break; // still offline — keep the queue and retry later
        }
        if (res.ok) {
          replayed++;
        } else {
          dropped++; // server rejected it (e.g. item deleted meanwhile) — don't retry forever
        }
        entries.shift();
        outbox.write(entries);
      }
    } finally {
      replaying = false;
      notify();
    }
    if (replayed || dropped) {
      UI.toast(`Synced ${replayed} offline change${replayed === 1 ? '' : 's'}`
        + (dropped ? ` (${dropped} rejected)` : ''), !!dropped);
    }
    return { replayed, dropped };
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  async function request(path, options = {}) {
    let res;
    try {
      res = await fetch(`${BASE}/${path}`, options);
    } catch (err) {
      // Network failure: queue eligible item writes for later replay
      const method = options.method || 'GET';
      if (method !== 'GET' && QUEUEABLE.test(path) && !(options.body instanceof FormData)) {
        outbox.push({ t: Date.now(), path, method, body: options.body ?? null });
        UI.toast('Offline — change saved locally, will sync when reconnected');
        return { queued: true };
      }
      throw new Error('You appear to be offline');
    }
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body.detail) detail = body.detail;
      } catch (_) { /* non-JSON error body */ }
      throw new Error(detail);
    }
    return res.json();
  }

  const json = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    health: () => request('health.php'),
    dashboard: () => request('dashboard.php'),
    reports: () => request('reports.php'),

    // Items
    listItems: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      return request(`items.php?${qs}`);
    },
    getItem: (id) => request(`items.php?id=${encodeURIComponent(id)}`),
    // Client-generated id: an offline-queued create replays with the same
    // identity (and an accidental double-replay collides instead of duping)
    createItem: (data) => request('items.php', json('POST', { id: uuid(), ...data })),
    updateItem: (id, data) => request(`items.php?id=${encodeURIComponent(id)}`, json('PUT', data)),
    deleteItem: (id) => request(`items.php?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

    // Photos — `ver` (the item's updated_at) keeps the URL stable so the
    // browser can cache; it changes only when the item changes
    photoURL: (id, ver = '') =>
      `${BASE}/photo.php?item_id=${encodeURIComponent(id)}&v=${encodeURIComponent(ver)}`,
    uploadPhoto: (id, file) => {
      const form = new FormData();
      form.append('photo', file);
      return request(`photo.php?item_id=${encodeURIComponent(id)}`, { method: 'POST', body: form });
    },
    deletePhoto: (id) => request(`photo.php?item_id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

    // Attachments (datasheets/manuals/models per item)
    listAttachments: (id) => request(`attachments.php?item_id=${encodeURIComponent(id)}`),
    attachmentURL: (id, name) =>
      `${BASE}/attachments.php?item_id=${encodeURIComponent(id)}&file=${encodeURIComponent(name)}`,
    uploadAttachment: (id, file) => {
      const form = new FormData();
      form.append('file', file);
      return request(`attachments.php?item_id=${encodeURIComponent(id)}`, { method: 'POST', body: form });
    },
    deleteAttachment: (id, name) =>
      request(`attachments.php?item_id=${encodeURIComponent(id)}&file=${encodeURIComponent(name)}`, { method: 'DELETE' }),

    // Locations
    locationTree: () => request('locations.php'),
    locationsFlat: () => request('locations.php?flat=1'),
    locationItems: (id) => request(`locations.php?id=${encodeURIComponent(id)}&items=1`),
    createLocation: (data) => request('locations.php', json('POST', data)),
    updateLocation: (id, data) => request(`locations.php?id=${encodeURIComponent(id)}`, json('PUT', data)),
    deleteLocation: (id, recursive = false) =>
      request(`locations.php?id=${encodeURIComponent(id)}${recursive ? '&recursive=1' : ''}`, { method: 'DELETE' }),

    // Categories
    listCategories: () => request('categories.php'),
    createCategory: (data) => request('categories.php', json('POST', data)),
    updateCategory: (key, data) => request(`categories.php?key=${encodeURIComponent(key)}`, json('PUT', data)),
    deleteCategory: (key) => request(`categories.php?key=${encodeURIComponent(key)}`, { method: 'DELETE' }),
    reorderCategories: (keys) => request('categories.php?action=reorder', json('POST', { keys })),

    // Activity
    activity: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      return request(`activity.php?${qs}`);
    },

    // Barcode auto-generation (MV-<PREFIX>-00001)
    generateBarcode: (opts) => request('items.php?action=barcode', json('POST', opts)),

    // Scanner lookups
    lookupItems: (code) => request(`items.php?lookup=${encodeURIComponent(code)}`),
    locationByQR: (qr) => request(`locations.php?qr=${encodeURIComponent(qr)}`),

    // Labels
    listLabelTemplates: () => request('labels.php'),
    createLabelTemplate: (data) => request('labels.php', json('POST', data)),
    updateLabelTemplate: (id, data) => request(`labels.php?id=${encodeURIComponent(id)}`, json('PUT', data)),
    deleteLabelTemplate: (id) => request(`labels.php?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    listLabelPresets: () => request('labels.php?presets=1'),
    createLabelPreset: (data) => request('labels.php?presets=1', json('POST', data)),
    deleteLabelPreset: (id) => request(`labels.php?presets=1&id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    labelItemData: (id) => request(`labels.php?data=item&id=${encodeURIComponent(id)}`),
    labelLocationData: (id) => request(`labels.php?data=location&id=${encodeURIComponent(id)}`),

    // Printers
    listPrinters: () => request('printers.php'),
    createPrinter: (data) => request('printers.php', json('POST', data)),
    updatePrinter: (id, data) => request(`printers.php?id=${encodeURIComponent(id)}`, json('PUT', data)),
    deletePrinter: (id) => request(`printers.php?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    addPrinterSlot: (printerId, slot) =>
      request(`printers.php?id=${encodeURIComponent(printerId)}&action=add_slot`, json('POST', slot)),
    deletePrinterSlot: (slotId) =>
      request(`printers.php?slot=${encodeURIComponent(slotId)}`, { method: 'DELETE' }),
    loadFilament: (slotId, filamentItemId) =>
      request(`printers.php?slot=${encodeURIComponent(slotId)}&action=load`, json('PUT', { filament_item_id: filamentItemId })),
    unloadFilament: (slotId, returnLocationId = null) =>
      request(`printers.php?slot=${encodeURIComponent(slotId)}&action=unload`, json('PUT', { return_location_id: returnLocationId })),

    // Imports
    confirmImport: (payload) => request('import.php', json('POST', payload)),

    // Product-page scraping (server-side — the browser can't cross-origin)
    scrapeProduct: (url) => request(`scrape.php?url=${encodeURIComponent(url)}`),
    scrapeImageURL: (url) => `${BASE}/scrape.php?image=${encodeURIComponent(url)}`,
    listImportBatches: () => request('import.php'),

    // Duplicates
    findDuplicates: () => request('duplicates.php'),
    dismissDuplicates: (itemIds) =>
      request('duplicates.php', json('POST', { action: 'dismiss', item_ids: itemIds })),
    restoreDismissedDuplicates: () =>
      request('duplicates.php', json('POST', { action: 'restore_all' })),
    mergeItems: (keepId, mergeIds, addQuantities = true) =>
      request('duplicates.php', json('POST', { keep_id: keepId, merge_ids: mergeIds, add_quantities: addQuantities })),

    // Batch operations
    batchUpdate: (ids, updates) => request('items.php?action=batch', json('POST', { ids, updates })),
    batchDelete: (ids) => request('items.php?action=batch', json('POST', { ids, delete: true })),

    // BOM checker
    checkBOM: (bom) => request('bom.php', json('POST', bom)),

    // Backup (direct downloads, not fetch) + restore
    backupJSONURL: () => `${BASE}/backup.php`,
    backupCSVURL: () => `${BASE}/backup.php?format=csv`,
    restoreBackup: (backupData) => request('backup.php?action=restore', json('POST', backupData)),

    // Offline sync
    outboxCount: () => outbox.count(),
    onOutboxChange: (fn) => listeners.push(fn),
    replayOutbox,
  };
})();
