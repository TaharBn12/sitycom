import { initShell } from '../shell.js';
import { t, statusLabel } from '../i18n.js';
import { api } from '../api.js';
import {
  el, clear, money, moneyWithCurrency, toast, renderTable, bars, field, downloadCsv, statusBadge,
} from '../ui.js';

const content = await initShell({ active: 'reports', title: 'reports.title' });
if (!content) throw new Error('unauthorized');

const today = new Date();
const fromDefault = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
const toDefault = today.toISOString().slice(0, 10);

clear(content);

const from = el('input', { type: 'date', value: fromDefault });
const to = el('input', { type: 'date', value: toDefault });

content.appendChild(el('div', { class: 'filters' }, [
  el('div', { class: 'field narrow' }, [el('label', { text: t('reports.from') }), from]),
  el('div', { class: 'field narrow' }, [el('label', { text: t('reports.to') }), to]),
  el('div', { class: 'field narrow' }, [
    el('button', { class: 'btn btn-primary btn-sm', text: t('common.search'), onclick: () => load() }),
  ]),
]));

const host = el('div');
content.appendChild(host);

async function load() {
  clear(host);
  host.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
  let d;
  try {
    d = await api.reports(from.value, to.value);
  } catch (err) {
    clear(host);
    host.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
    return;
  }
  clear(host);
  const s = d.summary;

  // الخلاصة
  host.appendChild(el('div', { class: 'grid grid-4' }, [
    stat(t('reports.orders'), String(s.orders), 'accent-blue'),
    stat(t('reports.revenue'), moneyWithCurrency(s.revenue), 'accent-green'),
    stat(t('reports.shipping'), moneyWithCurrency(s.shipping), 'accent-cyan'),
    stat(t('dash.avg_order'), moneyWithCurrency(Math.round(s.avg_order)), 'accent-purple'),
  ]));

  // يومياً
  host.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('reports.by_day') }),
      el('button', { class: 'btn btn-sm', text: t('common.export'), onclick: () => downloadCsv('by-day.csv', [
        { label: t('common.date'), key: 'day' }, { label: t('reports.orders'), key: 'orders' },
        { label: t('reports.revenue'), key: 'revenue' }, { label: t('reports.shipping'), key: 'shipping' },
      ], d.byDay) }),
    ]),
    el('div', { class: 'card-body' }, [
      bars(d.byDay || [], { valueKey: 'revenue', labelKey: 'day' }),
      (() => { const w = el('div'); renderTable(w, {
        columns: [
          { key: 'day', label: t('common.date') },
          { key: 'orders', label: t('reports.orders'), class: 'num' },
          { key: 'revenue', label: t('reports.revenue'), class: 'num', render: (r) => money(r.revenue) },
          { key: 'shipping', label: t('reports.shipping'), class: 'num', render: (r) => money(r.shipping) },
        ],
        rows: (d.byDay || []).slice().reverse(),
        emptyText: t('common.no_data'),
      }); return w; })(),
    ]),
  ]));

  // حسب الولاية
  host.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('reports.by_wilaya') }),
      el('button', { class: 'btn btn-sm', text: t('common.export'), onclick: () => downloadCsv('by-wilaya.csv', [
        { label: t('orders.wilaya'), key: 'wilaya_name' }, { label: t('reports.orders'), key: 'orders' },
        { label: t('reports.revenue'), key: 'revenue' }, { label: t('reports.shipping'), key: 'shipping' },
        { label: t('reports.delivered'), key: 'delivered' }, { label: t('reports.returns'), key: 'returns' },
      ], d.byWilaya) }),
    ]),
    el('div', { class: 'card-body' }, [(() => { const w = el('div'); renderTable(w, {
      columns: [
        { key: 'wilaya_name', label: t('orders.wilaya') },
        { key: 'orders', label: t('reports.orders'), class: 'num' },
        { key: 'revenue', label: t('reports.revenue'), class: 'num', render: (r) => money(r.revenue) },
        { key: 'shipping', label: t('reports.shipping'), class: 'num', render: (r) => money(r.shipping) },
        { key: 'delivered', label: t('reports.delivered'), class: 'num' },
        { key: 'returns', label: t('reports.returns'), class: 'num' },
        {
          key: 'rate', label: '%',
          render: (r) => `${Math.round((Number(r.delivered) / Math.max(1, Number(r.orders))) * 100)}%`,
        },
      ],
      rows: d.byWilaya || [],
      emptyText: t('common.no_data'),
    }); return w; })()]),
  ]));

  // حسب المنتج و الحالة
  host.appendChild(el('div', { class: 'grid grid-2' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: t('reports.by_product') }),
        el('button', { class: 'btn btn-sm', text: t('common.export'), onclick: () => downloadCsv('by-product.csv', [
          { label: t('orders.product'), key: 'name' }, { label: t('orders.qty'), key: 'qty' },
          { label: t('reports.revenue'), key: 'revenue' },
        ], d.byProduct) }),
      ]),
      el('div', { class: 'card-body' }, [(() => { const w = el('div'); renderTable(w, {
        columns: [
          { key: 'name', label: t('orders.product') },
          { key: 'qty', label: t('orders.qty'), class: 'num' },
          { key: 'revenue', label: t('reports.revenue'), class: 'num', render: (r) => money(r.revenue) },
        ],
        rows: (d.byProduct || []).slice(0, 20),
        emptyText: t('common.no_data'),
      }); return w; })()]),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: t('reports.by_status') })]),
      el('div', { class: 'card-body' }, [(() => { const w = el('div'); renderTable(w, {
        columns: [
          { key: 'status', label: t('common.status'), render: (r) => statusBadge(r.status) },
          { key: 'count', label: t('reports.orders'), class: 'num' },
          { key: 'revenue', label: t('reports.revenue'), class: 'num', render: (r) => money(r.revenue) },
        ],
        rows: d.byStatus || [],
        emptyText: t('common.no_data'),
      }); return w; })()]),
    ]),
  ]));

  // أداء التوصيل
  host.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', { text: t('reports.performance') })]),
    el('div', { class: 'card-body' }, [(() => { const w = el('div'); renderTable(w, {
      columns: [
        { key: 'status', label: t('common.status'), render: (r) => statusBadge(r.status) },
        { key: 'count', label: t('reports.orders'), class: 'num' },
        { key: 'delivery_fees', label: t('reports.shipping'), class: 'num', render: (r) => money(r.delivery_fees) },
      ],
      rows: d.deliveryPerformance || [],
      emptyText: t('common.no_data'),
    }); return w; })()]),
  ]));
}

function stat(label, value, accent) {
  return el('div', { class: `stat ${accent}` }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: value }),
  ]);
}

load();
