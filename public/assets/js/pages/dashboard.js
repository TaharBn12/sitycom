import { initShell } from '../shell.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { el, clear, money, moneyWithCurrency, fmtDay, statusBadge, bars, progressBars, toast, timeline } from '../ui.js';

const content = await initShell({ active: 'dashboard', title: 'dash.title' });
if (content) {
  render();
}

function statCard(label, value, accent, hint) {
  return el('div', { class: `stat ${accent}` }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: value }),
    hint ? el('div', { class: 'hint', text: hint }) : null,
  ]);
}

async function render() {
  clear(content);
  let data;
  try {
    data = await api.dashboard(30);
  } catch (err) {
    content.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
    return;
  }
  const c = data.cards;

  // بطاقة الربط
  const banner = el('div', { class: 'card' }, [el('div', { class: 'card-body', text: t('common.loading') })]);
  content.appendChild(banner);
  api.ecoStatus().then((st) => {
    clear(banner);
    const body = el('div', { class: 'card-body' });
    body.appendChild(el('div', { class: 'row-between' }, [
      el('div', {}, [
        el('h3', { text: t('dash.ecotrack_banner'), class: 'mb-0' }),
        el('div', { class: 'muted', style: { fontSize: '13px' }, text: st.config.mock ? t('dash.ecotrack_mock') : t('dash.ecotrack_connected', { url: st.config.base_url }) }),
      ]),
      el('div', { class: 'flex' }, [
        st.config.mock ? el('span', { class: 'badge mock', text: t('common.mock_mode') }) : el('span', { class: 'badge done', text: t('common.live_mode') }),
        el('a', { class: 'btn btn-primary btn-sm', href: 'shipping.html', text: t('dash.go_shipping') }),
      ]),
    ]));
    body.appendChild(el('div', { class: 'flex mt-2', style: { gap: '14px', fontSize: '12.5px' } }, [
      el('span', { class: 'muted', text: `${t('shipping.wilayas_count')}: ${st.counts.wilayas}` }),
      el('span', { class: 'muted', text: `${t('shipping.communes_count')}: ${st.counts.communes}` }),
      el('span', { class: 'muted', text: `${t('shipping.desks_count')}: ${st.counts.desks}` }),
      el('span', { class: 'muted', text: `${t('shipping.tab_fees')}: ${st.counts.fees}` }),
      el('span', { class: 'muted', text: `${t('shipping.products_count')}: ${st.counts.products}` }),
    ]));
    banner.appendChild(body);
  }).catch(() => { banner.remove(); });

  // المؤشرات
  content.appendChild(el('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
    statCard(t('dash.orders'), String(c.orders), 'accent-blue', t('dash.last_days', { n: data.days })),
    statCard(t('dash.revenue'), moneyWithCurrency(c.revenue), 'accent-green', `${t('dash.avg_order')}: ${money(Math.round(c.orders ? c.revenue / c.orders : 0))}`),
    statCard(t('dash.delivered'), String(c.delivered), 'accent-cyan', `${t('dash.collected')}: ${money(c.collected)}`),
    statCard(t('dash.in_transit'), String(c.in_transit), 'accent-purple', `${t('dash.pending')}: ${c.pending}`),
  ]));
  content.appendChild(el('div', { class: 'grid grid-4', style: { marginBottom: '18px' } }, [
    statCard(t('dash.returns'), String(c.returns), 'accent-orange', `${t('status.suspendu')}: ${c.suspended}`),
    statCard(t('dash.not_pushed'), String(c.not_pushed), 'accent-red'),
    statCard(t('dash.customers'), String(c.customers), 'accent-blue', `${t('dash.new_customers')}: ${c.new_customers}`),
    statCard(t('dash.shipping_fees'), moneyWithCurrency(c.shipping), 'accent-cyan'),
  ]));

  // المبيعات اليومية + توزيع الحالات
  content.appendChild(el('div', { class: 'grid grid-2' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: t('dash.daily_sales') })]),
      el('div', { class: 'card-body' }, [bars(data.daily || [], { valueKey: 'revenue', labelKey: 'day' })]),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: t('dash.status_distribution') })]),
      el('div', { class: 'card-body' }, [progressBars(data.statusCounts || [], c.orders)]),
    ]),
  ]));

  // أحدث الطلبيات
  content.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: t('dash.recent_orders') }),
      el('a', { class: 'btn btn-sm', href: 'orders.html', text: t('nav.orders_all') }),
      el('a', { class: 'btn btn-primary btn-sm', href: 'orders-new.html', text: t('orders.new') }),
    ]),
    (() => {
      const wrap = el('div');
      renderRecent(wrap, data.recent || []);
      return wrap;
    })(),
  ]));

  // الأفضل + المخزون
  content.appendChild(el('div', { class: 'grid grid-3' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h3', { text: t('dash.top_wilayas') })]),
      el('div', { class: 'card-body' }, [
        el('ul', { class: 'list-links' }, (data.topWilayas || []).map((w) => el('li', {}, [
          el('span', { text: w.wilaya_name || `Wilaya ${w.wilaya_id}` }),
          el('span', { class: 'muted', text: `${w.orders} ${t('common.of')} ${money(w.revenue)}` }),
        ])) || []),
      ]),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h3', { text: t('dash.top_products') })]),
      el('div', { class: 'card-body' }, [
        el('ul', { class: 'list-links' }, (data.topProducts || []).map((p) => el('li', {}, [
          el('span', { class: 'truncate', text: p.name }),
          el('span', { class: 'muted', text: `${p.qty} · ${money(p.revenue)}` }),
        ])) || []),
      ]),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h3', { text: t('dash.low_stock') })]),
      el('div', { class: 'card-body' }, [
        el('ul', { class: 'list-links' }, (data.lowStock || []).map((p) => el('li', {}, [
          el('a', { href: 'products.html', text: p.name_ar }),
          el('span', { class: `badge ${p.stock <= 0 ? 'bad' : 'warn'}`, text: String(p.stock) }),
        ])) || []),
      ]),
    ]),
  ]));
}

function renderRecent(wrap, rows) {
  clear(wrap);
  if (!rows.length) {
    wrap.appendChild(el('div', { class: 'table-empty', text: t('common.no_data') }));
    return;
  }
  const table = el('table', { class: 'table' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: t('orders.number') }),
    el('th', { text: t('orders.customer') }),
    el('th', { text: t('orders.wilaya') }),
    el('th', { text: t('orders.amount') }),
    el('th', { text: t('common.status') }),
    el('th', { text: t('orders.tracking') }),
    el('th', { text: t('common.date') }),
  ])]));
  const tbody = el('tbody');
  rows.forEach((o) => {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [el('a', { href: `orders.html?open=${o.id}`, class: 'mono', text: o.order_number })]),
      el('td', { text: o.customer_name }),
      el('td', { text: o.wilaya_name || '—' }),
      el('td', { class: 'num', text: money(o.total) }),
      el('td', {}, [statusBadge(o.ecotrack_status || o.status)]),
      el('td', { class: 'mono', text: o.tracking || '—' }),
      el('td', { text: fmtDay(o.created_at) }),
    ]));
  });
  table.appendChild(tbody);
  wrap.appendChild(el('div', { class: 'table-wrap' }, [table]));
}
