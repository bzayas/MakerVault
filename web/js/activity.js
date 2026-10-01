/* Activity log view — action filter chips, search, load-more pagination. */

window.Views = window.Views || {};

Views.activity = (() => {
  const { h } = UI;

  const PAGE_SIZE = 50;
  const ACTIONS = [
    ['', 'All'], ['added', 'Added'], ['edited', 'Edited'], ['moved', 'Moved'],
    ['quantityChanged', 'Quantity'], ['deleted', 'Deleted'], ['imported', 'Imported'],
    ['merged', 'Merged'], ['checkedOut', 'Checked out'], ['checkedIn', 'Checked in'],
  ];

  let filter = { action: '', search: '', item_id: '' };
  let offset = 0;
  let listEl = null;
  let moreBtn = null;

  async function render(main, params = {}) {
    offset = 0;
    // Deep link: #/activity?item=<id> shows one item's full history
    filter.item_id = params.item || '';

    const chips = h('div.chip-row', ACTIONS.map(([value, label]) =>
      h('button.chip' + (filter.action === value ? '.active' : ''), {
        onclick: (e) => {
          filter.action = value;
          chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
          e.target.classList.add('active');
          reload();
        },
      }, label)));

    const search = h('input', {
      type: 'search', placeholder: 'Search activity…', value: filter.search,
      oninput: UI.debounce((e) => { filter.search = e.target.value; reload(); }, 250),
    });

    listEl = h('div.card', h('div.spinner'));
    moreBtn = h('button.btn', { style: { display: 'none' }, onclick: loadMore }, 'Load more');

    // When filtered by item, show a dismissible chip with the item's name
    const itemChip = h('div', { style: { marginBottom: '10px', display: filter.item_id ? '' : 'none' } });
    if (filter.item_id) {
      API.getItem(filter.item_id)
        .then((it) => itemChip.replaceChildren(
          h('button.chip.active', {
            onclick: () => { filter.item_id = ''; location.hash = '#/activity'; },
            title: 'Clear item filter',
          }, `📦 ${it.name} ✕`)))
        .catch(() => itemChip.replaceChildren(
          h('button.chip.active', {
            onclick: () => { filter.item_id = ''; location.hash = '#/activity'; },
          }, 'Filtered by item ✕')));
    }

    main.replaceChildren(
      h('div.page-header', h('div', h('h1', 'Activity'), h('div.page-sub', 'Every add, edit, move, and import'))),
      h('div.toolbar', h('div.search-box', search)),
      itemChip,
      chips,
      h('div', { style: { height: '12px' } }),
      listEl,
      h('div', { style: { textAlign: 'center', marginTop: '12px' } }, moreBtn),
    );

    await reload();
  }

  function row(a) {
    const meta = UI.actionMeta(a.action);
    return h('div.activity-row',
      h('span.activity-action', { style: { color: meta.color } }, meta.label),
      h('span.activity-details', a.details || a.item_name || ''),
      h('span.activity-time', UI.relativeTime(a.timestamp)),
    );
  }

  async function reload() {
    offset = 0;
    listEl.replaceChildren(h('div.spinner'));
    try {
      const entries = await API.activity({ ...filter, limit: PAGE_SIZE, offset: 0 });
      listEl.replaceChildren(
        entries.length ? h('div', entries.map(row)) : h('div.empty-state', 'No matching activity'),
      );
      offset = entries.length;
      moreBtn.style.display = entries.length === PAGE_SIZE ? '' : 'none';
    } catch (err) {
      listEl.replaceChildren(h('div.empty-state', '⚠️ ' + err.message));
    }
  }

  async function loadMore() {
    moreBtn.disabled = true;
    try {
      const entries = await API.activity({ ...filter, limit: PAGE_SIZE, offset });
      entries.forEach((a) => listEl.firstChild.append(row(a)));
      offset += entries.length;
      moreBtn.style.display = entries.length === PAGE_SIZE ? '' : 'none';
    } catch (err) {
      UI.toast(err.message, true);
    } finally {
      moreBtn.disabled = false;
    }
  }

  return { render };
})();
