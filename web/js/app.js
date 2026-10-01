/* MakerVault web — app shell: hash router, shared state (categories +
   location tree caches), boot sequence. */

const App = (() => {
  const state = {
    categories: [],
    categoryByKey: new Map(),
    locationTree: [],
    locationById: new Map(),
  };

  async function refreshCategories() {
    state.categories = await API.listCategories();
    state.categoryByKey = new Map(state.categories.map((c) => [c.key, c]));
    return state.categories;
  }

  async function refreshLocations() {
    state.locationTree = await API.locationTree();
    state.locationById = new Map();
    const walk = (nodes, path) => {
      nodes.forEach((n) => {
        const fullPath = path ? `${path} › ${n.name}` : n.name;
        state.locationById.set(n.id, { ...n, fullPath });
        walk(n.children || [], fullPath);
      });
    };
    walk(state.locationTree, '');
    return state.locationTree;
  }

  function locationName(id) {
    if (!id) return null;
    const loc = state.locationById.get(id);
    return loc ? loc.name : null;
  }

  function locationPath(id) {
    if (!id) return null;
    const loc = state.locationById.get(id);
    return loc ? loc.fullPath : null;
  }

  // ---------- Router ----------

  function parseHash() {
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [view, queryString] = hash.split('?');
    const params = Object.fromEntries(new URLSearchParams(queryString || ''));
    return { view: view.replace(/\/$/, ''), params };
  }

  let activeView = null;

  // Views reachable only through Settings still light up a nav item
  const NAV_PARENT = { categories: 'settings', duplicates: 'settings' };

  async function route() {
    const { view, params } = parseHash();
    const main = document.getElementById('main');
    const handler = window.Views[view] || window.Views.dashboard;

    // Navigating away closes any open modals (nav tabs stay usable under them)
    UI.closeAllModals();

    // Let the previous view release resources (e.g. scanner camera)
    if (activeView && activeView !== handler && typeof activeView.cleanup === 'function') {
      activeView.cleanup();
    }
    activeView = handler;

    const navView = NAV_PARENT[view] || view;
    document.querySelectorAll('#nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.view === navView);
    });

    try {
      await handler.render(main, params);
    } catch (err) {
      main.replaceChildren(UI.h('div.empty-state',
        UI.h('div.big', '💥'),
        `Something went wrong: ${err.message}`));
      console.error(err);
    }
    main.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  // ---------- Boot ----------

  async function boot() {
    const main = document.getElementById('main');
    main.replaceChildren(UI.h('div.spinner'));
    try {
      await Promise.all([refreshCategories(), refreshLocations()]);
    } catch (err) {
      main.replaceChildren(UI.h('div.empty-state',
        UI.h('div.big', '🔌'),
        UI.h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'Cannot reach the MakerVault API'),
        UI.h('div', `${err.message}`),
        UI.h('div', { style: { marginTop: '10px', fontSize: '13px' } },
          'Check that the Web Station service is set to PHP (not static) and that data/ is writable.')));
      return;
    }

    updateFooter();
    window.addEventListener('hashchange', route);
    route();

    // ---------- Offline support ----------

    if ('serviceWorker' in navigator) {
      // Reload once when a NEW worker takes control so the fresh shell loads
      // immediately (skip the very first install, and don't yank the page
      // out from under an open modal or unsynced offline edits).
      let hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) { hadController = true; return; }
        if (reloaded) return;
        reloaded = true;
        const busy = document.getElementById('modal-root').childElementCount > 0
          || API.outboxCount() > 0;
        if (busy) {
          UI.toast('MakerVault updated — reload to get the new version');
        } else {
          location.reload();
        }
      });

      navigator.serviceWorker.register('sw.js').then((reg) => {
        // Check for a new version now, whenever the app returns to the
        // foreground (installed iOS apps resume from memory for days and
        // never re-check on their own), and hourly while open.
        const check = () => reg.update().catch(() => { /* offline — fine */ });
        check();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
        setInterval(check, 60 * 60 * 1000);
      }).catch(() => { /* http or unsupported — app works fine without it */ });
    }

    window.addEventListener('online', async () => {
      updateFooter();
      const { replayed } = await API.replayOutbox();
      if (replayed) route(); // re-render with the synced state
    });
    window.addEventListener('offline', () => {
      UI.toast('Offline — you can keep browsing and editing items');
      updateFooter();
    });
    API.onOutboxChange(updateFooter);

    // Flush anything queued from a previous offline session
    if (API.outboxCount()) API.replayOutbox().then(({ replayed }) => { if (replayed) route(); });
  }

  async function updateFooter() {
    const footer = document.getElementById('sidebar-footer');
    if (!footer) return;
    const pending = API.outboxCount();
    const net = navigator.onLine ? '' : ' · 📴 offline';
    const queue = pending ? ` · ⏳ ${pending} to sync` : '';
    try {
      if (!footer.dataset.version) {
        const health = await API.health();
        footer.dataset.version = `v${health.version} · ${health.items} items`;
      }
    } catch (_) {
      footer.dataset.version = footer.dataset.version || 'MakerVault';
    }
    footer.textContent = footer.dataset.version + net + queue;
  }

  document.addEventListener('DOMContentLoaded', boot);

  return { state, refreshCategories, refreshLocations, locationName, locationPath };
})();
