import { initShell } from '../shell.js';
import { t, STATUSES, statusLabel } from '../i18n.js';
import { api } from '../api.js';
import {
  el, clear, money, moneyWithCurrency, toast, renderTable, paginationBar, statusBadge, confirmDialog,
  promptDialog, downloadCsv,
} from '../ui.js';

const content = await initShell({ active: 'returns', title: 'returns.title' });
if (!content) throw new Error('unauthorized');

const RETURN_STATUSES = [
  'retour_chez_livreur', 'retour_transit_entrepot', 'retour_en_traitement',
  'retour_recu', 'retour_archive',
].join(',');

const state = { page: 1, selected: new Set(), rows: [] };

clear(content);

content.appendChild(el('div', { class: 'card' }, [
  el('div', { class: 'card-body' }, [
    el('div', { class: 'alert alert-info' }, [
      el('div', { text: t('returns.confirm_hint') }),
      el('small', { class: 'mono', text: 'POST /api/v1/valid/returns  ·  POST /api/v1/ask/for/order/return' }),
    ]),
    el('div', { class: 'row-between' }, [
      el('strong', { id: 'ret-count', text: '' }),
      el('div', { class: 'flex' }, [
        el('button', { class: 'btn btn-sm', text: t('returns.select_all'), onclick: () => toggleAll() }),
        el('button', {
          class: 'btn btn-sm btn-success', text: t('returns.confirm_received'),
          onclick: async () => {
            const trackings = [...state.selected];
            if (!trackings.length) return toast(t('common.no_data'), 'warn');
            if (!await confirmDialog(`${t('returns.confirm_received')} (${trackings.length}) ?`, { okLabel: t('returns.confirm_received'), danger: false })) return;
            try {
              const r = await api.ecoValidReturns(trackings);
              toast(JSON.stringify(r.data), 'success', 6000);
              state.selected.clear();
              load();
            } catch (err) { toast(err.message, 'error', 7000); }
          },
        }),
        el('button', { class: 'btn btn-sm', text: t('common.export'), onclick: () => exportCsv() }),
        el('button', { class: 'btn btn-sm', text: t('common.refresh'), onclick: () => load() }),
      ]),
    ]),
    (() => { const d = el('div', { class: 'mt-2' }); d.id = 'ret-table'; return d; })(),
    (() => { const d = el('div', { class: 'pagination' }); d.id = 'ret-pager'; return d; })(),
  ]),
]));

const tableHost = content.querySelector('#ret-table');
const pager = content.querySelector('#ret-pager');
const countEl = content.querySelector('#ret-count');

async function load() {
  clear(tableHost);
  tableHost.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
  try {
    const res = await api.orders({ status: RETURN_STATUSES, page: state.page, limit: 50 });
    state.rows = res.orders;
    countEl.textContent = `${res.total} ${t('returns.list')}`;
    renderTable(tableHost, { columns: columns(), rows: res.orders, emptyText: t('returns.none') });
    paginationBar(pager, { page: res.page, pages: res.pages, total: res.total, onChange: (p) => { state.page = p; load(); } });
  } catch (err) {
    clear(tableHost);
    tableHost.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
  }
}

function toggleAll() {
  const trackings = state.rows.map((r) => r.tracking).filter(Boolean);
  const allSelected = trackings.length && trackings.every((x) => state.selected.has(x));
  state.selected.clear();
  if (!allSelected) trackings.forEach((x) => state.selected.add(x));
  load();
}

function columns() {
  return [
    {
      key: 'sel', width: '34px',
      render: (row) => {
        if (!row.tracking) return '—';
        const cb = el('input', { type: 'checkbox' });
        cb.checked = state.selected.has(row.tracking);
        cb.addEventListener('change', () => {
          if (cb.checked) state.selected.add(row.tracking);
          else state.selected.delete(row.tracking);
        });
        return cb;
      },
    },
    { key: 'order_number', label: t('orders.number'), class: 'mono' },
    { key: 'customer_name', label: t('orders.customer') },
    { key: 'wilaya_name', label: t('orders.wilaya') },
    { key: 'total', label: t('orders.amount'), class: 'num', render: (r) => moneyWithCurrency(r.total) },
    { key: 'ecotrack_status', label: t('common.status'), render: (r) => statusBadge(r.ecotrack_status || r.status) },
    { key: 'tracking', label: t('orders.tracking'), class: 'mono' },
    { key: 'return_asked_at', label: t('returns.asked_at'), render: (r) => (r.return_asked_at ? String(r.return_asked_at).slice(0, 16) : '—') },
    {
      key: 'actions', label: t('common.actions'), class: 'end',
      render: (r) => el('div', { class: 'actions' }, [
        el('button', {
          class: 'btn btn-xs btn-warning', text: t('returns.ask'),
          onclick: async () => {
            if (!await confirmDialog(`${t('returns.ask')} ?`, { okLabel: t('returns.ask') })) return;
            try { await api.askReturn(r.id); toast(t('common.success'), 'success'); load(); }
            catch (err) { toast(err.message, 'error', 6000); }
          },
        }),
        el('button', { class: 'btn btn-xs', text: t('orders.act.sync'), onclick: async () => { try { await api.syncOrder(r.id); load(); } catch (err) { toast(err.message, 'error'); } } }),
        el('a', { class: 'btn btn-xs', href: `orders.html?open=${r.id}`, text: t('common.view') }),
      ]),
    },
  ];
}

function exportCsv() {
  downloadCsv('returns.csv', [
    { label: t('orders.number'), key: 'order_number' },
    { label: t('orders.customer'), key: 'customer_name' },
    { label: t('orders.phone'), key: 'phone' },
    { label: t('orders.wilaya'), key: 'wilaya_name' },
    { label: t('orders.amount'), key: 'total' },
    { label: t('common.status'), csv: (r) => statusLabel(r.ecotrack_status || r.status) },
    { label: t('orders.tracking'), key: 'tracking' },
  ], state.rows);
}

load();
