import { initShell } from '../shell.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import {
  el, clear, money, moneyWithCurrency, toast, modal, confirmDialog, renderTable, paginationBar,
  field, tabs, downloadCsv,
} from '../ui.js';

const content = await initShell({ active: 'products', title: 'products.title' });
if (!content) throw new Error('unauthorized');

const state = { page: 1, q: '', status: '', category_id: '', categories: [], selectedEco: new Set() };

async function loadCategories() {
  try {
    const r = await api.categories();
    state.categories = r.categories || [];
  } catch { state.categories = []; }
}
await loadCategories();

clear(content);
const tabsHost = el('div', { class: 'card' });
content.appendChild(tabsHost);

const panels = tabs(tabsHost, [
  { id: 'products', label: t('products.tab_products'), render: renderProductsTab },
  { id: 'categories', label: t('products.tab_categories'), render: renderCategoriesTab },
  { id: 'eco', label: t('products.tab_ecotrack'), render: renderEcoTab },
]);

/* ══════════════════════ المنتجات ══════════════════════ */
function renderProductsTab() {
  const host = el('div', { class: 'card-body' });

  const q = el('input', { type: 'text', value: state.q, placeholder: `${t('common.search')}…` });
  q.addEventListener('input', () => { state.q = q.value; state.page = 1; load(); });

  const status = el('select');
  [['', t('common.all')], ['active', t('products.active')], ['inactive', '—'], ['low', t('products.low')], ['out', t('products.out')]].forEach(([v, l]) => {
    status.appendChild(el('option', { value: v, text: l, selected: state.status === v }));
  });
  status.addEventListener('change', () => { state.status = status.value; state.page = 1; load(); });

  const cat = el('select');
  cat.appendChild(el('option', { value: '', text: `${t('products.category')}: ${t('common.all')}` }));
  state.categories.forEach((c) => cat.appendChild(el('option', { value: c.id, text: c[`name_${getLang()}`] || c.name_ar })));
  cat.addEventListener('change', () => { state.category_id = cat.value; state.page = 1; load(); });

  host.appendChild(el('div', { class: 'filters' }, [
    field('', q),
    el('div', { class: 'field narrow' }, [status]),
    el('div', { class: 'field narrow' }, [cat]),
    el('div', { class: 'field narrow' }, [
      el('button', { class: 'btn btn-primary btn-sm', text: t('products.new'), onclick: () => openProductForm(null, load) }),
    ]),
    el('div', { class: 'field narrow' }, [
      el('button', { class: 'btn btn-sm', text: t('common.export'), onclick: () => exportCsv() }),
    ]),
  ]));

  const tableHost = el('div');
  const pager = el('div', { class: 'pagination' });
  host.appendChild(tableHost);
  host.appendChild(pager);

  let rows = [];

  async function load() {
    clear(tableHost);
    tableHost.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
    try {
      const params = { page: state.page, q: state.q, status: state.status, category_id: state.category_id, limit: 24 };
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      const res = await api.products(params);
      rows = res.products;
      renderTable(tableHost, { columns: columns(), rows: res.products, emptyText: t('common.no_data') });
      paginationBar(pager, { page: res.page, pages: res.pages, total: res.total, onChange: (p) => { state.page = p; load(); } });
    } catch (err) {
      clear(tableHost);
      tableHost.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
    }
  }

  function columns() {
    return [
      { key: 'sku', label: t('products.sku'), class: 'mono' },
      {
        key: 'name_ar', label: t('products.name_ar'),
        render: (r) => el('div', {}, [
          el('div', { text: r[`name_${getLang()}`] || r.name_ar }),
          r.image_url ? el('small', { class: 'muted truncate', text: r.image_url }) : null,
        ]),
      },
      { key: 'category_name', label: t('products.category') },
      { key: 'price', label: t('products.price'), class: 'num', render: (r) => moneyWithCurrency(r.price) },
      { key: 'cost', label: t('products.cost'), class: 'num', render: (r) => money(r.cost) },
      {
        key: 'stock', label: t('products.stock'),
        render: (r) => {
          const inp = el('input', {
            type: 'number', value: String(r.stock), style: { width: '80px' },
          });
          inp.addEventListener('change', async () => {
            try {
              await api.setStock(r.id, Number(inp.value) || 0);
              toast(t('common.success'), 'success', 1500);
            } catch (err) { toast(err.message, 'error'); }
          });
          return el('div', { class: 'flex' }, [
            inp,
            el('span', { class: `badge ${r.stock <= 0 ? 'bad' : r.stock <= 5 ? 'warn' : 'done'}`, text: String(r.stock) }),
          ]);
        },
      },
      {
        key: 'active', label: t('products.active'),
        render: (r) => el('span', { class: `badge ${r.active ? 'done' : 'gray'}`, text: r.active ? t('common.yes') : t('common.no') }),
      },
      {
        key: 'actions', label: t('common.actions'), class: 'end',
        render: (r) => el('div', { class: 'actions' }, [
          el('button', { class: 'btn btn-xs', text: t('common.edit'), onclick: () => openProductForm(r, load) }),
          el('button', {
            class: 'btn btn-xs btn-danger', text: t('common.delete'),
            onclick: async () => {
              if (!await confirmDialog(t('common.delete_confirm'))) return;
              try { await api.deleteProduct(r.id); toast(t('common.success'), 'success'); load(); } catch (err) { toast(err.message, 'error'); }
            },
          }),
        ]),
      },
    ];
  }

  function exportCsv() {
    const cols = [
      { label: t('products.sku'), key: 'sku' },
      { label: t('products.name_ar'), key: 'name_ar' },
      { label: t('products.name_fr'), key: 'name_fr' },
      { label: t('products.price'), key: 'price' },
      { label: t('products.cost'), key: 'cost' },
      { label: t('products.stock'), key: 'stock' },
      { label: t('products.ecotrack_ref'), key: 'ecotrack_reference' },
    ];
    downloadCsv('products.csv', cols, rows);
  }

  load();
  return host;
}

export function openProductForm(product, onDone) {
  const p = product || {};
  const nameOf = (prefix) => {
    const i = el('input', { type: 'text', value: p[prefix] ?? '' });
    i.dataset.k = prefix;
    return i;
  };
  const catSel = el('select');
  catSel.dataset.k = 'category_id';
  catSel.appendChild(el('option', { value: '', text: '—' }));
  state.categories.forEach((c) => catSel.appendChild(el('option', { value: c.id, text: c[`name_${getLang()}`] || c.name_ar, selected: Number(p.category_id) === c.id })));

  const activeBox = el('input', { type: 'checkbox' });
  activeBox.dataset.k = 'active';
  activeBox.checked = p.active === undefined ? true : Boolean(p.active);
  const fragileBox = el('input', { type: 'checkbox' });
  fragileBox.dataset.k = 'fragile';
  fragileBox.checked = Boolean(p.fragile);

  const body = el('div', {}, [
    el('div', { class: 'form-row' }, [
      field(t('products.name_ar'), nameOf('name_ar')),
      field(t('products.sku'), nameOf('sku')),
    ]),
    el('div', { class: 'form-row' }, [
      field(t('products.name_fr'), nameOf('name_fr')),
      field(t('products.name_en'), nameOf('name_en')),
    ]),
    el('div', { class: 'form-row' }, [
      field(t('products.price'), (() => { const i = el('input', { type: 'number', value: String(p.price ?? 0) }); i.dataset.k = 'price'; return i; })()),
      field(t('products.cost'), (() => { const i = el('input', { type: 'number', value: String(p.cost ?? 0) }); i.dataset.k = 'cost'; return i; })()),
    ]),
    el('div', { class: 'form-row' }, [
      field(t('products.stock'), (() => { const i = el('input', { type: 'number', value: String(p.stock ?? 0) }); i.dataset.k = 'stock'; return i; })()),
      field(t('products.category'), catSel),
    ]),
    el('div', { class: 'form-row' }, [
      field(t('products.image'), nameOf('image_url')),
      field(t('products.ecotrack_ref'), nameOf('ecotrack_reference')),
    ]),
    field(t('products.description'), (() => { const ta = el('textarea', { value: p.description ?? '' }); ta.dataset.k = 'description'; return ta; })()),
    el('div', { class: 'flex' }, [
      el('label', { class: 'checkbox' }, [activeBox, el('span', { text: t('products.active') })]),
      el('label', { class: 'checkbox' }, [fragileBox, el('span', { text: t('orders.fragile') })]),
      (() => { const i = el('input', { type: 'number', value: String(p.weight ?? 0), placeholder: t('orders.weight') }); i.dataset.k = 'weight'; return i; })(),
    ]),
  ]);

  modal({
    title: product ? `${t('common.edit')}: ${p.name_ar}` : t('products.new'),
    body,
    actions: [
      { label: t('common.cancel'), variant: 'btn-ghost' },
      {
        label: t('common.save'),
        variant: 'btn-primary',
        onClick: async (close) => {
          const payload = {};
          body.querySelectorAll('[data-k]').forEach((inp) => { payload[inp.dataset.k] = inp.value; });
          payload.active = activeBox.checked ? 1 : 0;
          payload.fragile = fragileBox.checked ? 1 : 0;
          try {
            await api.saveProduct(payload, product?.id);
            toast(t('common.success'), 'success');
            close();
            if (onDone) onDone();
          } catch (err) { toast(err.message, 'error'); }
        },
      },
    ],
  });
}

/* ══════════════════════ التصنيفات ══════════════════════ */
function renderCategoriesTab() {
  const host = el('div', { class: 'card-body' });
  const listHost = el('div');
  host.appendChild(el('div', { class: 'row-between mb-2' }, [
    el('h3', { class: 'mb-0', text: t('products.categories') }),
    el('button', { class: 'btn btn-primary btn-sm', text: t('products.cat_new'), onclick: () => openCategoryForm(null, load) }),
  ]));
  host.appendChild(listHost);

  async function load() {
    await loadCategories();
    renderTable(listHost, {
      columns: [
        { key: 'name_ar', label: t('products.name_ar') },
        { key: 'name_fr', label: t('products.name_fr') },
        { key: 'name_en', label: t('products.name_en') },
        {
          key: 'active', label: t('products.active'),
          render: (r) => el('span', { class: `badge ${r.active ? 'done' : 'gray'}`, text: r.active ? t('common.yes') : t('common.no') }),
        },
        {
          key: 'actions', label: t('common.actions'), class: 'end',
          render: (r) => el('div', { class: 'actions' }, [
            el('button', { class: 'btn btn-xs', text: t('common.edit'), onclick: () => openCategoryForm(r, load) }),
            el('button', {
              class: 'btn btn-xs btn-danger', text: t('common.delete'),
              onclick: async () => {
                if (!await confirmDialog(t('common.delete_confirm'))) return;
                try { await api.deleteCategory(r.id); load(); } catch (err) { toast(err.message, 'error'); }
              },
            }),
          ]),
        },
      ],
      rows: state.categories,
      emptyText: t('common.no_data'),
    });
  }

  load();
  return host;
}

function openCategoryForm(cat, onDone) {
  const c = cat || {};
  const mk = (k, v) => { const i = el('input', { type: 'text', value: v ?? '' }); i.dataset.k = k; return i; };
  const active = el('input', { type: 'checkbox' });
  active.checked = c.active === undefined ? true : Boolean(c.active);
  const body = el('div', {}, [
    field(t('products.name_ar'), mk('name_ar', c.name_ar)),
    field(t('products.name_fr'), mk('name_fr', c.name_fr)),
    field(t('products.name_en'), mk('name_en', c.name_en)),
    el('label', { class: 'checkbox' }, [active, el('span', { text: t('products.active') })]),
  ]);
  modal({
    title: cat ? t('common.edit') : t('products.cat_new'),
    body,
    actions: [
      { label: t('common.cancel'), variant: 'btn-ghost' },
      {
        label: t('common.save'), variant: 'btn-primary',
        onClick: async (close) => {
          const payload = {};
          body.querySelectorAll('[data-k]').forEach((i) => { payload[i.dataset.k] = i.value; });
          payload.active = active.checked ? 1 : 0;
          try { await api.saveCategory(payload, cat?.id); toast(t('common.success'), 'success'); close(); if (onDone) onDone(); }
          catch (err) { toast(err.message, 'error'); }
        },
      },
    ],
  });
}

/* ══════════════════════ منتجات Ecotrack ══════════════════════ */
function renderEcoTab() {
  const host = el('div', { class: 'card-body' });
  const listHost = el('div');
  host.appendChild(el('div', { class: 'alert alert-info' }, [
    el('span', { text: 'GET /api/v1/get/products/list — منتجات ومخزون حسابك عند شركة التوصيل' }),
  ]));
  host.appendChild(el('div', { class: 'row-between mb-2' }, [
    el('div', { class: 'flex' }, [
      el('button', {
        class: 'btn btn-sm btn-primary', text: t('products.sync_ecotrack'),
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const r = await api.syncProducts(5);
            toast(t('shipping.synced_ok', { n: r.count }), 'success');
            load();
          } catch (err) { toast(err.message, 'error', 6000); }
          btn.disabled = false;
        },
      }),
      el('button', { class: 'btn btn-sm', text: t('common.refresh'), onclick: () => load() }),
    ]),
    el('button', {
      class: 'btn btn-sm btn-success', text: t('products.import'),
      onclick: async () => {
        const rows = [...state.selectedEco];
        if (!rows.length) return toast(t('common.no_data'), 'warn');
        try {
          const r = await api.importEcotrackProducts(rows);
          toast(`${r.created} / ${r.updated}`, 'success');
          state.selectedEco.clear();
          load();
        } catch (err) { toast(err.message, 'error'); }
      },
    }),
  ]));
  host.appendChild(listHost);

  async function load() {
    clear(listHost);
    listHost.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
    try {
      const r = await api.geoEcotrackProducts();
      const rows = r.products || [];
      renderTable(listHost, {
        columns: [
          {
            key: 'sel', width: '34px',
            render: (row) => {
              const cb = el('input', { type: 'checkbox' });
              cb.checked = state.selectedEco.has(row);
              cb.addEventListener('change', () => {
                if (cb.checked) state.selectedEco.add(row); else state.selectedEco.delete(row);
              });
              return cb;
            },
          },
          { key: 'reference', label: t('products.sku'), class: 'mono' },
          { key: 'barcode', label: 'Barcode', class: 'mono' },
          { key: 'title', label: t('products.name_ar') },
          { key: 'stock_disponible', label: t('products.stock') },
          { key: 'stock_reserve', label: 'Réservé' },
          { key: 'stock_phisique', label: 'Physique' },
          { key: 'synced_at', label: t('shipping.last_sync'), render: (r2) => String(r2.synced_at || '').slice(0, 16) },
        ],
        rows,
        emptyText: t('common.no_data'),
      });
    } catch (err) {
      clear(listHost);
      listHost.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
    }
  }

  load();
  return host;
}
