/* Categories view — manage the dynamic category list: add, edit, delete,
   reorder (up/down). Icon names are SF Symbols keys carried over from the
   SwiftUI app; the web shows their emoji equivalents. */

window.Views = window.Views || {};

Views.categories = (() => {
  const { h } = UI;

  const ICON_CHOICES = [
    'shippingbox', 'circle.fill', 'wrench.and.screwdriver', 'gearshape.2',
    'engine.combustion', 'cable.connector', 'hammer', 'bag', 'doc.plaintext',
    'bandage', 'printer', 'screwdriver', 'wrench', 'paintpalette',
  ];
  const COLOR_CHOICES = [
    '#AF52DE', '#8E8E93', '#FF9500', '#007AFF', '#34C759', '#FF3B30',
    '#32ADE6', '#FFCC00', '#5856D6', '#FF2D55', '#8D99AE', '#3A5A40',
  ];

  let tableWrap = null;

  async function render(main) {
    tableWrap = h('div.card', h('div.spinner'));
    main.replaceChildren(
      h('div.page-header',
        h('div', h('h1', 'Categories'), h('div.page-sub', 'Organize items into groups with icons and colors')),
        h('button.btn.primary', { onclick: () => categoryForm(null) }, '＋ Add Category'),
      ),
      tableWrap,
    );
    await refresh();
  }

  async function refresh() {
    try {
      const cats = await App.refreshCategories();
      tableWrap.replaceChildren(
        h('table.mv-table',
          h('thead', h('tr',
            h('th', ''), h('th', 'Name'), h('th', 'Key'), h('th', 'Items'), h('th', 'Order'), h('th', ''))),
          h('tbody', cats.map((c, i) => rowFor(c, i, cats))),
        ),
      );
    } catch (err) {
      tableWrap.replaceChildren(h('div.empty-state', '⚠️ ' + err.message));
    }
  }

  function rowFor(c, index, all) {
    const move = async (dir) => {
      const target = index + dir;
      if (target < 0 || target >= all.length) return;
      const keys = all.map((x) => x.key);
      [keys[index], keys[target]] = [keys[target], keys[index]];
      try {
        await API.reorderCategories(keys);
        refresh();
      } catch (err) {
        UI.toast(err.message, true);
      }
    };

    return h('tr',
      h('td', h('div.cat-icon', { style: { background: c.color + '2b' } }, UI.categoryIcon(c))),
      h('td', h('strong', c.display_name), c.is_builtin ? h('span', { style: { color: 'var(--text-faint)', fontSize: '11px' } }, ' built-in') : null),
      h('td', h('code', { style: { fontSize: '12px', color: 'var(--text-dim)' } }, c.key)),
      h('td', String(c.item_count)),
      h('td',
        h('button.qty-btn', { onclick: () => move(-1), disabled: index === 0, title: 'Move up' }, '↑'),
        ' ',
        h('button.qty-btn', { onclick: () => move(1), disabled: index === all.length - 1, title: 'Move down' }, '↓')),
      h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
        h('button.btn.small', { onclick: () => categoryForm(c) }, 'Edit'),
        ' ',
        (!c.is_builtin && c.key !== 'other')
          ? h('button.btn.small.danger', { onclick: () => removeCategory(c) }, 'Delete')
          : null),
    );
  }

  function categoryForm(cat) {
    const isEdit = !!cat;
    const f = {};

    f.display_name = h('input', { type: 'text', value: cat ? cat.display_name : '' });
    f.key = h('input', {
      type: 'text', value: cat ? cat.key : '',
      placeholder: 'lowercase_key',
      disabled: isEdit && cat.is_builtin,
    });

    let selectedIcon = cat ? cat.icon : 'shippingbox';
    const iconRow = h('div.chip-row', ICON_CHOICES.map((icon) =>
      h('button.chip' + (icon === selectedIcon ? '.active' : ''), {
        onclick: (e) => {
          selectedIcon = icon;
          iconRow.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
          e.target.classList.add('active');
        },
      }, UI.categoryIcon({ icon }))));

    let selectedColor = cat ? cat.color : '#8E8E93';
    const colorRow = h('div.chip-row', COLOR_CHOICES.map((color) => {
      const dot = h('button.chip' + (color === selectedColor ? '.active' : ''), {
        onclick: (e) => {
          selectedColor = color;
          colorRow.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
        style: { display: 'inline-flex', alignItems: 'center', gap: '6px' },
      }, h('span', { style: { width: '14px', height: '14px', borderRadius: '50%', background: color, display: 'inline-block' } }));
      return dot;
    }));

    const fld = (label, control) => h('label.field', h('span', label), control);

    const save = async () => {
      const name = f.display_name.value.trim();
      if (!name) { UI.toast('Name is required', true); return; }
      try {
        if (isEdit) {
          const payload = { display_name: name, icon: selectedIcon, color: selectedColor };
          const newKey = f.key.value.trim();
          if (!cat.is_builtin && newKey && newKey !== cat.key) payload.new_key = newKey;
          await API.updateCategory(cat.key, payload);
        } else {
          const key = f.key.value.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          await API.createCategory({ key, display_name: name, icon: selectedIcon, color: selectedColor });
        }
        UI.toast(isEdit ? 'Category updated' : 'Category added');
        m.close();
        refresh();
      } catch (err) {
        UI.toast(err.message, true);
      }
    };

    const m = UI.modal({
      title: isEdit ? `Edit: ${cat.display_name}` : 'Add Category',
      body: h('div',
        fld('Display name *', f.display_name),
        fld('Key', f.key),
        fld('Icon', iconRow),
        fld('Color', colorRow),
      ),
      footer: [
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn.primary', { onclick: save }, isEdit ? 'Save' : 'Add'),
      ],
    });
  }

  async function removeCategory(cat) {
    const ok = await UI.confirmDialog(
      'Delete category',
      `Delete "${cat.display_name}"? Its ${cat.item_count} item(s) will move to "Other".`,
    );
    if (!ok) return;
    try {
      await API.deleteCategory(cat.key);
      UI.toast('Category deleted');
      refresh();
    } catch (err) {
      UI.toast(err.message, true);
    }
  }

  return { render };
})();
