import { initShell } from '../shell.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import {
  el, clear, money, moneyWithCurrency, toast, modal, confirmDialog, renderTable, paginationBar, field, downloadCsv,
} from '../ui.js';

const content = await initShell({ active: 'customers', title: 'customers.title' });
if (!content) throw new Error('unauthorized');

const state = { page: 1, q: '', wilaya_id: '' };
let rows = [];

clear(content);

const q = el('input', { type: 'text', placeholder: `${t('common.search')} (${t('customers.name')} / ${t('orders.phone')})` });
q.addEventListener('input', () => { state.q = q.value; state.page = 1; load(); });

const card = el('div', { class: 'card' }, [
  el('div', { class: 'card-body' }, [
    el('div', { class: 'filters' }, [
      field('', q),
      el('div', { class: 'field narrow' }, [
        el('button', { class: 'btn btn-primary btn-sm', text: t('customers.new'), onclick: () => openForm(null, load) }),
      ]),
      el('div', { class: 'field narrow' }, [
        el('button', { class: 'btn btn-sm', text: t('common.export'), onclick: () => exportCsv() }),
      ]),
    ]),
    (() => { const d = el('div'); d.id = 'cust-table'; return d; })(),
    (() => { const d = el('div', { class: 'pagination' }); d.id = 'cust-pager'; return d; })(),
  ]),
]);
content.appendChild(card);

const tableHost = card.querySelector('#cust-table');
const pager = card.querySelector('#cust-pager');

async function load() {
  clear(tableHost);
  tableHost.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
  try {
    const params = { page: state.page, q: state.q, wilaya_id: state.wilaya_id, limit: 50 };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    const res = await api.customers(params);
    rows = res.customers;
    renderTable(tableHost, { columns: columns(), rows: res.customers, emptyText: t('common.no_data') });
    paginationBar(pager, { page: res.page, pages: res.pages, total: res.total, onChange: (p) => { state.page = p; load(); } });
  } catch (err) {
    clear(tableHost);
    tableHost.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
  }
}

function columns() {
  return [
    { key: 'name', label: t('customers.name') },
    { key: 'phone', label: t('orders.phone'), class: 'mono' },
    { key: 'phone2', label: t('orders.phone2'), class: 'mono' },
    { key: 'commune', label: t('orders.commune') },
    { key: 'address', label: t('orders.address'), class: 'truncate' },
    { key: 'orders_count', label: t('customers.orders_count'), class: 'num' },
    { key: 'total_spent', label: t('customers.total_spent'), class: 'num', render: (r) => moneyWithCurrency(r.total_spent) },
    { key: 'created_at', label: t('common.date'), render: (r) => String(r.created_at || '').slice(0, 10) },
    {
      key: 'actions', label: t('common.actions'), class: 'end',
      render: (r) => el('div', { class: 'actions' }, [
        el('a', { class: 'btn btn-xs', href: `orders.html?q=${encodeURIComponent(r.phone)}`, text: t('nav.orders_all') }),
        el('button', { class: 'btn btn-xs', text: t('common.edit'), onclick: () => openForm(r, load) }),
        el('button', {
          class: 'btn btn-xs btn-danger', text: t('common.delete'),
          onclick: async () => {
            if (!await confirmDialog(t('common.delete_confirm'))) return;
            try { await api.deleteCustomer(r.id); toast(t('common.success'), 'success'); load(); } catch (err) { toast(err.message, 'error'); }
          },
        }),
      ]),
    },
  ];
}

function exportCsv() {
  downloadCsv('customers.csv', [
    { label: t('customers.name'), key: 'name' },
    { label: t('orders.phone'), key: 'phone' },
    { label: t('orders.phone2'), key: 'phone2' },
    { label: t('orders.commune'), key: 'commune' },
    { label: t('orders.address'), key: 'address' },
    { label: t('customers.orders_count'), key: 'orders_count' },
    { label: t('customers.total_spent'), key: 'total_spent' },
  ], rows);
}

export function openForm(customer, onDone) {
  const c = customer || {};
  const mk = (k, v, type = 'text') => { const i = el('input', { type, value: v ?? '' }); i.dataset.k = k; return i; };
  const body = el('div', {}, [
    el('div', { class: 'form-row' }, [
      field(t('customers.name'), mk('name', c.name)),
      field(t('orders.phone'), mk('phone', c.phone)),
    ]),
    el('div', { class: 'form-row' }, [
      field(t('orders.phone2'), mk('phone2', c.phone2)),
      field(t('customers.email'), mk('email', c.email, 'email')),
    ]),
    el('div', { class: 'form-row' }, [
      field(t('orders.wilaya') + ' (ID)', mk('wilaya_id', c.wilaya_id, 'number')),
      field(t('orders.commune'), mk('commune', c.commune)),
    ]),
    field(t('orders.address'), mk('address', c.address)),
    field(t('orders.notes'), (() => { const ta = el('textarea', { value: c.notes ?? '' }); ta.dataset.k = 'notes'; return ta; })()),
  ]);
  modal({
    title: customer ? `${t('common.edit')}: ${c.name}` : t('customers.new'),
    body,
    actions: [
      { label: t('common.cancel'), variant: 'btn-ghost' },
      {
        label: t('common.save'), variant: 'btn-primary',
        onClick: async (close) => {
          const payload = {};
          body.querySelectorAll('[data-k]').forEach((i) => { payload[i.dataset.k] = i.value; });
          try {
            await api.saveCustomer(payload, customer?.id);
            toast(t('common.success'), 'success');
            close();
            if (onDone) onDone();
          } catch (err) { toast(err.message, 'error', 6000); }
        },
      },
    ],
  });
}

load();
