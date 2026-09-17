import { initShell } from '../shell.js';
import { t, STATUSES, statusLabel } from '../i18n.js';
import { api, downloadBlob } from '../api.js';
import {
  el, clear, money, moneyWithCurrency, fmtDay, fmtDate, statusBadge, toast, modal, confirmDialog,
  promptDialog, renderTable, paginationBar, timeline, field, downloadCsv, withLoading, selectValue,
} from '../ui.js';

const content = await initShell({ active: 'orders', title: 'orders.title' });
if (content) {
  const state = {
    page: 1,
    q: '',
    status: 'all',
    wilaya_id: '',
    start_date: '',
    end_date: '',
    pushed: '',
    delivery: '',
    selected: new Set(),
    orders: [],
    total: 0,
    pages: 1,
    wilayas: [],
  };
  window.__ordersState = state;

  api.geoWilayas().then((r) => { state.wilayas = r.wilayas || []; build(); }).catch(() => build());
}

function build() {
  clear(content);
  const s = window.__ordersState;

  // ── الفلاتر ─────────────────────────────────────────────
  const q = el('input', { type: 'text', value: s.q, placeholder: `${t('common.search')}…` });
  q.addEventListener('input', () => { s.q = q.value; s.page = 1; load(); });

  const status = el('select');
  status.appendChild(el('option', { value: 'all', text: `${t('orders.filter_status')}: ${t('common.all')}` }));
  STATUSES.forEach((st) => status.appendChild(el('option', { value: st, text: statusLabel(st), selected: s.status === st })));
  selectValue(status, s.status);
  status.addEventListener('change', () => { s.status = status.value; s.page = 1; load(); });

  const wilaya = el('select');
  wilaya.appendChild(el('option', { value: '', text: `${t('orders.filter_wilaya')}: ${t('common.all')}` }));
  s.wilayas.forEach((w) => wilaya.appendChild(el('option', { value: w.wilaya_id, text: `${w.wilaya_id} — ${w.name_ar || w.name_fr}` })));
  selectValue(wilaya, s.wilaya_id);
  wilaya.addEventListener('change', () => { s.wilaya_id = wilaya.value; s.page = 1; load(); });

  const pushed = el('select');
  [['', t('common.all')], ['1', t('orders.pushed')], ['0', t('orders.not_pushed')]].forEach(([v, l]) => {
    pushed.appendChild(el('option', { value: v, text: `${t('orders.filter_pushed')}: ${l}`, selected: s.pushed === v }));
  });
  pushed.addEventListener('change', () => { s.pushed = pushed.value; s.page = 1; load(); });

  const delivery = el('select');
  [['', t('common.all')], ['home', t('orders.home')], ['stopdesk', t('orders.stopdesk')]].forEach(([v, l]) => {
    delivery.appendChild(el('option', { value: v, text: `${t('orders.delivery_type')}: ${l}`, selected: s.delivery === v }));
  });
  delivery.addEventListener('change', () => { s.delivery = delivery.value; s.page = 1; load(); });

  const start = el('input', { type: 'date', value: s.start_date });
  start.addEventListener('change', () => { s.start_date = start.value; s.page = 1; load(); });
  const end = el('input', { type: 'date', value: s.end_date });
  end.addEventListener('change', () => { s.end_date = end.value; s.page = 1; load(); });

  const filters = el('div', { class: 'filters' }, [
    field('', q),
    el('div', { class: 'field narrow' }, [status]),
    el('div', { class: 'field narrow' }, [wilaya]),
    el('div', { class: 'field narrow' }, [pushed]),
    el('div', { class: 'field narrow' }, [delivery]),
    el('div', { class: 'field narrow' }, [el('label', { text: t('reports.from') }), start]),
    el('div', { class: 'field narrow' }, [el('label', { text: t('reports.to') }), end]),
    el('div', { class: 'field narrow' }, [
      el('button', {
        class: 'btn btn-sm', text: t('common.refresh'), onclick: () => load(),
      }),
    ]),
  ]);
  content.appendChild(filters);

  // ── شريط الإجراءات الجماعية ──────────────────────────────
  const bulkBar = el('div', {
    class: 'card', style: { padding: '10px 16px', marginBottom: '14px' },
  });
  const bulkWrap = el('div');
  bulkBar.appendChild(bulkWrap);
  content.appendChild(bulkBar);

  const renderBulk = () => {
    clear(bulkWrap);
    const n = s.selected.size;
    bulkWrap.appendChild(el('div', { class: 'row-between' }, [
      el('strong', { text: t('orders.selected', { n }) }),
      el('div', { class: 'flex' }, [
        el('button', { class: 'btn btn-sm btn-primary', text: t('orders.push_selected'), disabled: n === 0, onclick: () => bulkPush(false) }),
        el('button', { class: 'btn btn-sm btn-success', text: t('orders.act.validate'), disabled: n === 0, onclick: () => bulkPush(true) }),
        el('button', { class: 'btn btn-sm', text: t('orders.sync_selected'), disabled: n === 0, onclick: () => bulkSync() }),
        el('button', { class: 'btn btn-sm', text: t('common.export'), onclick: () => exportCsv() }),
        el('button', { class: 'btn btn-sm btn-danger', text: t('orders.delete_selected'), disabled: n === 0, onclick: () => bulkDelete() }),
        el('span', { style: { flex: '1' } }),
        el('button', { class: 'btn btn-sm', text: t('orders.import_ecotrack'), onclick: () => importEcotrack() }),
        el('a', { class: 'btn btn-sm btn-primary', href: 'orders-new.html', text: t('orders.new') }),
      ]),
    ]));
  };
  s.renderBulk = renderBulk;
  renderBulk();

  // ── الجدول ──────────────────────────────────────────────
  const tableWrap = el('div', { class: 'card' }, [el('div', { class: 'card-body' }, [el('div', { class: 'table-empty', text: t('common.loading') })])]);
  content.appendChild(tableWrap);
  const pager = el('div', { class: 'pagination' });
  content.appendChild(pager);

  s.tableWrap = tableWrap;
  s.pager = pager;
  load();
}

async function load() {
  const s = window.__ordersState;
  const body = s.tableWrap.querySelector('.card-body');
  clear(body);
  body.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
  try {
    const params = {
      page: s.page, q: s.q, status: s.status, wilaya_id: s.wilaya_id,
      start_date: s.start_date, end_date: s.end_date, pushed: s.pushed, delivery: s.delivery, limit: 25,
    };
    Object.keys(params).forEach((k) => { if (params[k] === '' || params[k] === null || params[k] === undefined) delete params[k]; });
    const res = await api.orders(params);
    s.orders = res.orders;
    s.total = res.total;
    s.pages = res.pages;
    renderTable(body, {
      columns: tableColumns(),
      rows: res.orders,
      emptyText: t('common.no_data'),
    });
    paginationBar(s.pager, { page: res.page, pages: res.pages, total: res.total, onChange: (p) => { s.page = p; load(); } });
    s.renderBulk();
  } catch (err) {
    clear(body);
    body.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
  }
}

function tableColumns() {
  const s = window.__ordersState;
  return [
    {
      key: 'check',
      width: '34px',
      render: (row) => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = s.selected.has(row.id);
        cb.addEventListener('click', (e) => {
          e.stopPropagation();
          if (cb.checked) s.selected.add(row.id); else s.selected.delete(row.id);
          s.renderBulk();
        });
        return cb;
      },
    },
    {
      key: 'order_number', label: t('orders.number'),
      render: (row) => el('a', { class: 'mono', href: '#', text: row.order_number, onclick: (e) => { e.preventDefault(); openDetail(row.id); } }),
    },
    {
      key: 'customer_name', label: t('orders.customer'),
      render: (row) => el('div', {}, [
        el('div', { text: row.customer_name }),
        el('small', { class: 'mono', text: row.phone }),
      ]),
    },
    {
      key: 'wilaya_name', label: t('orders.wilaya'),
      render: (row) => el('div', {}, [
        el('div', { text: row.wilaya_name || '—' }),
        el('small', { text: row.commune || '' }),
      ]),
    },
    { key: 'total', label: t('orders.amount'), class: 'num', render: (row) => moneyWithCurrency(row.total) },
    {
      key: 'status', label: t('common.status'),
      render: (row) => el('div', {}, [
        statusBadge(row.ecotrack_status || row.status),
        row.stop_desk ? el('div', {}, [el('small', { text: t('orders.stopdesk') })]) : null,
      ]),
    },
    {
      key: 'tracking', label: t('orders.tracking'),
      render: (row) => (row.tracking
        ? el('div', {}, [el('span', { class: 'mono', text: row.tracking }), row.last_activity ? el('small', { style: { display: 'block' }, text: row.last_activity }) : null])
        : el('span', { class: 'badge gray', text: t('orders.not_pushed') })),
    },
    { key: 'created_at', label: t('orders.created'), render: (row) => fmtDay(row.created_at) },
    {
      key: 'actions', label: t('common.actions'), class: 'end',
      render: (row) => rowActions(row),
    },
  ];
}

function rowActions(row) {
  const s = window.__ordersState;
  const box = el('div', { class: 'actions' });
  const btn = (label, cls, fn) => el('button', { class: `btn btn-xs ${cls}`, text: label, onclick: (e) => { e.stopPropagation(); fn(); } });

  box.appendChild(btn(t('common.view'), '', () => openDetail(row.id)));
  if (!row.tracking) {
    box.appendChild(btn(t('orders.act.push'), 'btn-primary', () => pushOrder(row.id)));
  } else {
    box.appendChild(btn(t('orders.act.validate'), 'btn-success', () => validateOrder(row.id)));
    box.appendChild(btn(t('orders.act.label'), '', () => downloadBlob(api.labelUrl(row.id, true), `label-${row.tracking}.pdf`)));
    box.appendChild(btn(t('orders.act.sync'), '', () => syncOrder(row.id)));
    box.appendChild(btn(t('orders.act.maj'), '', () => addMaj(row.id)));
    box.appendChild(btn(t('orders.act.ask_return'), 'btn-warning', () => askReturn(row.id)));
  }
  box.appendChild(btn(t('common.delete'), 'btn-danger', () => deleteOrder(row.id)));
  return box;
}

/* ── الإجراءات ─────────────────────────────────────────── */
async function pushOrder(id, validate = false) {
  try {
    const r = await api.pushOrder(id, validate);
    toast(t('orders.pushed_ok', { t: r.tracking }), 'success');
    load();
  } catch (err) {
    toast(err.message, 'error', 6000);
    load();
  }
}

async function validateOrder(id) {
  if (!await confirmDialog(t('orders.act.validate') + ' ?', { okLabel: t('orders.act.validate'), danger: false })) return;
  try {
    await api.validateOrder(id, true);
    toast(t('orders.validated_ok'), 'success');
    load();
  } catch (err) { toast(err.message, 'error', 6000); }
}

async function syncOrder(id) {
  try {
    await api.syncOrder(id);
    toast(t('common.success'), 'success');
    load();
  } catch (err) { toast(err.message, 'error', 6000); }
}

async function addMaj(id) {
  const content2 = await promptDialog({ title: t('orders.act.maj'), label: t('orders.notes'), multiline: true });
  if (!content2) return;
  try {
    await api.addMaj(id, content2);
    toast(t('common.success'), 'success');
  } catch (err) { toast(err.message, 'error', 6000); }
}

async function askReturn(id) {
  if (!await confirmDialog(t('orders.act.ask_return') + ' ?', { okLabel: t('orders.act.ask_return') })) return;
  try {
    await api.askReturn(id);
    toast(t('common.success'), 'success');
    load();
  } catch (err) { toast(err.message, 'error', 6000); }
}

async function deleteOrder(id) {
  if (!await confirmDialog(t('common.delete') + ' ? ' + t('common.delete_confirm'))) return;
  try {
    await api.deleteOrder(id);
    toast(t('orders.deleted_ok'), 'success');
    load();
  } catch (err) { toast(err.message, 'error', 6000); }
}

async function bulkPush(validate) {
  const s = window.__ordersState;
  const ids = [...s.selected];
  try {
    const r = await api.bulkPush(ids, validate);
    toast(`${r.success} ✓ / ${r.failed} ✗`, r.failed ? 'warn' : 'success', 6000);
    s.selected.clear();
    load();
  } catch (err) { toast(err.message, 'error', 6000); }
}

async function bulkSync() {
  const s = window.__ordersState;
  try {
    const r = await api.syncOrders([...s.selected], 'status');
    toast(t('orders.synced_ok', { n: r.updated }), 'success');
    load();
  } catch (err) { toast(err.message, 'error', 6000); }
}

async function bulkDelete() {
  const s = window.__ordersState;
  if (!await confirmDialog(`${t('common.delete')} (${s.selected.size}) — ${t('common.delete_confirm')}`)) return;
  for (const id of s.selected) {
    try { await api.deleteOrder(id); } catch (err) { toast(err.message, 'error'); }
  }
  s.selected.clear();
  load();
}

function exportCsv() {
  const s = window.__ordersState;
  const columns = [
    { label: t('orders.number'), key: 'order_number' },
    { label: t('orders.customer'), key: 'customer_name' },
    { label: t('orders.phone'), key: 'phone' },
    { label: t('orders.wilaya'), key: 'wilaya_name' },
    { label: t('orders.commune'), key: 'commune' },
    { label: t('orders.amount'), key: 'total' },
    { label: t('common.status'), csv: (r) => statusLabel(r.ecotrack_status || r.status) },
    { label: t('orders.tracking'), key: 'tracking' },
    { label: t('orders.created'), key: 'created_at' },
  ];
  downloadCsv('orders.csv', columns, s.orders);
}

async function importEcotrack() {
  const pages = await promptDialog({ title: t('orders.import_ecotrack'), label: 'Pages', value: '1' });
  if (!pages) return;
  try {
    const r = await api.importEcotrackOrders(Number(pages) || 1);
    toast(`${r.imported} / ${r.updated}`, 'success');
    load();
  } catch (err) { toast(err.message, 'error', 6000); }
}

/* ── نافذة التفاصيل ────────────────────────────────────── */
export async function openDetail(id) {
  const s = window.__ordersState;
  let data;
  try {
    data = await api.order(id);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const o = data.order;
  const sh = o.shipment || {};

  const items = el('div');
  if ((o.items || []).length) {
    const table = el('table', { class: 'table' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: t('orders.product') }), el('th', { text: t('orders.qty') }),
      el('th', { text: t('orders.price') }), el('th', { text: t('common.total') }),
    ])]));
    const tbody = el('tbody');
    o.items.forEach((it) => {
      tbody.appendChild(el('tr', {}, [
        el('td', { text: it.name }),
        el('td', { text: String(it.qty) }),
        el('td', { text: money(it.unit_price) }),
        el('td', { text: money(it.line_total) }),
      ]));
    });
    table.appendChild(tbody);
    items.appendChild(table);
  } else {
    items.appendChild(el('div', { class: 'table-empty', text: t('common.no_data') }));
  }

  const body = el('div', {}, [
    el('div', { class: 'row-between mb-2' }, [
      el('h3', { class: 'mb-0', text: o.order_number }),
      el('div', { class: 'flex' }, [statusBadge(sh.ecotrack_status || o.status), sh.tracking ? el('span', { class: 'mono', text: sh.tracking }) : null]),
    ]),
    el('dl', { class: 'kv' }, [
      el('dt', { text: t('orders.customer') }), el('dd', { text: `${o.customer_name} — ${o.phone}${o.phone2 ? ' / ' + o.phone2 : ''}` }),
      el('dt', { text: t('orders.wilaya') }), el('dd', { text: `${o.wilaya_name || ''} / ${o.commune || ''}` }),
      el('dt', { text: t('orders.address') }), el('dd', { text: o.address || '—' }),
      el('dt', { text: t('orders.delivery_type') }), el('dd', { text: o.stop_desk ? `${t('orders.stopdesk')} ${o.desk_name ? '· ' + o.desk_name : ''}` : t('orders.home') }),
      el('dt', { text: t('orders.subtotal') }), el('dd', { text: moneyWithCurrency(o.subtotal) }),
      el('dt', { text: t('orders.shipping_fee') }), el('dd', { text: moneyWithCurrency(o.shipping_fee) }),
      el('dt', { text: t('orders.discount') }), el('dd', { text: moneyWithCurrency(o.discount) }),
      el('dt', { text: t('orders.grand_total') }), el('dd', {}, [el('strong', { text: moneyWithCurrency(o.total) })]),
      el('dt', { text: t('orders.reference') }), el('dd', { class: 'mono', text: sh.reference || '—' }),
      el('dt', { text: t('orders.type') }), el('dd', { text: t(`orders.type${sh.type || 1}`) }),
      el('dt', { text: t('orders.notes') }), el('dd', { text: o.notes || sh.remarque || '—' }),
      el('dt', { text: t('orders.created') }), el('dd', { text: fmtDate(o.created_at) }),
    ]),
    el('div', { class: 'sep' }),
    el('h3', { text: t('orders.items') }),
    items,
    el('div', { class: 'sep' }),
    el('h3', { text: t('orders.timeline') }),
    timeline(o.events || []),
    sh.raw ? el('div', {}, [
      el('div', { class: 'sep' }),
      el('small', { class: 'muted', text: 'RAW (Ecotrack)' }),
      el('pre', { class: 'mono', style: { maxHeight: '220px', overflow: 'auto', background: '#f8fafc', padding: '10px', borderRadius: '8px' }, text: sh.raw }),
    ]) : null,
  ]);

  const actions = [
    { label: t('common.close'), variant: 'btn-ghost' },
    { label: t('common.edit'), onClick: (close) => { close(); openEdit(o); } },
  ];
  if (!sh.tracking) {
    actions.push({ label: t('orders.act.push'), variant: 'btn-primary', onClick: (close) => { close(); pushOrder(o.id); } });
  } else {
    actions.push({ label: t('orders.act.sync'), onClick: (close) => { close(); syncOrder(o.id); } });
    actions.push({ label: t('orders.act.label'), variant: 'btn-success', onClick: () => downloadBlob(api.labelUrl(o.id, true), `label-${sh.tracking}.pdf`) });
    actions.push({ label: t('orders.act.update_eco'), onClick: (close) => { close(); updateAtEco(o.id); } });
  }

  modal({ title: t('orders.detail'), body, size: 'wide', actions });
}

async function updateAtEco(id) {
  if (!await confirmDialog(t('orders.act.update_eco') + ' ?', { okLabel: t('orders.act.update_eco'), danger: false })) return;
  try {
    await api.updateAtEcotrack(id, {}, true);
    toast(t('common.success'), 'success');
    load();
  } catch (err) { toast(err.message, 'error', 6000); }
}

async function openEdit(order) {
  const s = window.__ordersState;
  const val = (k) => (order[k] ?? '');
  const input = (key, type = 'text') => {
    const inp = el('input', { type, value: val(key) });
    inp.dataset.key = key;
    return inp;
  };
  const wilayaSel = el('select');
  s.wilayas.forEach((w) => wilayaSel.appendChild(el('option', { value: w.wilaya_id, text: `${w.wilaya_id} — ${w.name_ar || w.name_fr}`, selected: Number(order.wilaya_id) === w.wilaya_id })));
  wilayaSel.dataset.key = 'wilaya_id';

  const statusSel = el('select');
  STATUSES.forEach((st) => statusSel.appendChild(el('option', { value: st, text: statusLabel(st), selected: (order.status || '') === st })));
  statusSel.dataset.key = 'status';

  const body = el('div', {}, [
    el('div', { class: 'form-row' }, [
      field(t('orders.customer'), input('customer_name')),
      field(t('orders.phone'), input('phone')),
    ]),
    el('div', { class: 'form-row' }, [
      field(t('orders.phone2'), input('phone2')),
      field(t('orders.wilaya'), wilayaSel),
    ]),
    el('div', { class: 'form-row' }, [
      field(t('orders.commune'), input('commune')),
      field(t('orders.address'), input('address')),
    ]),
    el('div', { class: 'form-row' }, [
      field(t('orders.shipping_fee'), input('shipping_fee', 'number')),
      field(t('orders.discount'), input('discount', 'number')),
    ]),
    el('div', { class: 'form-row' }, [
      field(t('common.status'), statusSel),
      field(t('orders.notes'), input('notes')),
    ]),
    el('div', { class: 'form-row' }, [
      field(t('orders.boutique'), (() => { const i = el('input', { type: 'text', value: order.shipment?.boutique || '' }); i.dataset.ship = 'boutique'; return i; })()),
      field(t('orders.weight'), (() => { const i = el('input', { type: 'number', value: order.shipment?.weight || 0 }); i.dataset.ship = 'weight'; return i; })()),
    ]),
  ]);

  modal({
    title: `${t('common.edit')} — ${order.order_number}`,
    body,
    actions: [
      { label: t('common.cancel'), variant: 'btn-ghost' },
      {
        label: t('common.save'),
        variant: 'btn-primary',
        onClick: async (close) => {
          const payload = {};
          body.querySelectorAll('[data-key]').forEach((inp) => { payload[inp.dataset.key] = inp.value; });
          const ship = {};
          body.querySelectorAll('[data-ship]').forEach((inp) => { ship[inp.dataset.ship] = inp.value; });
          payload.shipment = ship;
          try {
            await api.updateOrder(order.id, payload);
            // تحديث حقول الشحن منفصلاً
            await api.updateOrder(order.id, { type: order.shipment?.type, ...ship });
            toast(t('common.success'), 'success');
            close();
            load();
          } catch (err) { toast(err.message, 'error', 6000); }
        },
      },
    ],
  });
}

// فتح نافذة التفاصيل تلقائياً إن وُجد ?open=
const params = new URLSearchParams(location.search);
if (params.get('open')) {
  setTimeout(() => openDetail(Number(params.get('open'))), 700);
}
