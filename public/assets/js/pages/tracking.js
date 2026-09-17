import { initShell } from '../shell.js';
import { t, activityLabel, statusLabel } from '../i18n.js';
import { api, downloadBlob } from '../api.js';
import {
  el, clear, money, moneyWithCurrency, toast, renderTable, paginationBar, timeline, statusBadge, activityBadge,
  promptDialog, confirmDialog, modal,
} from '../ui.js';

const content = await initShell({ active: 'tracking', title: 'tracking.title' });
if (!content) throw new Error('unauthorized');

clear(content);

/* ── تتبع طرد واحد ─────────────────────────────────────── */
const singleInput = el('input', { type: 'text', placeholder: t('tracking.placeholder') });
const resultHost = el('div');

content.appendChild(el('div', { class: 'card' }, [
  el('div', { class: 'card-head' }, [el('h2', { text: t('tracking.single') })]),
  el('div', { class: 'card-body' }, [
    el('div', { class: 'flex' }, [
      el('div', { style: { flex: '1' } }, [singleInput]),
      el('button', {
        class: 'btn btn-primary', text: t('tracking.find'),
        onclick: async () => {
          const tracking = singleInput.value.trim();
          if (!tracking) return toast(t('track.enter_number'), 'warn');
          clear(resultHost);
          resultHost.appendChild(el('div', { class: 'card' }, [el('div', { class: 'card-body center', text: t('common.loading') })]));
          try {
            const r = await api.ecoTracking(tracking);
            renderSingle(r.data || {}, tracking, r.mock);
          } catch (err) {
            clear(resultHost);
            resultHost.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
          }
        },
      }),
    ]),
  ]),
]));

content.appendChild(resultHost);

function renderSingle(d, tracking, mock) {
  const activity = Array.isArray(d.activity) ? d.activity : [];
  const last = activity[activity.length - 1];
  clear(resultHost);
  resultHost.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h3', { text: d.recipientName || t('tracking.recipient') }),
      el('span', { class: 'mono', text: tracking }),
      mock ? el('span', { class: 'badge mock', text: t('common.mock_mode') }) : null,
      el('div', { style: { flex: '1' } }),
      el('button', {
        class: 'btn btn-sm', text: t('orders.act.maj'),
        onclick: async () => {
          const c = await promptDialog({ title: t('orders.act.maj'), label: t('orders.notes'), multiline: true });
          if (!c) return;
          try { await api.ecoAddMaj(tracking, c); toast(t('common.success'), 'success'); }
          catch (err) { toast(err.message, 'error'); }
        },
      }),
      el('button', {
        class: 'btn btn-sm btn-warning', text: t('orders.act.ask_return'),
        onclick: async () => {
          if (!await confirmDialog(t('orders.act.ask_return') + ' ?', { okLabel: t('orders.act.ask_return') })) return;
          try { await api.ecoAskReturn(tracking); toast(t('common.success'), 'success'); }
          catch (err) { toast(err.message, 'error'); }
        },
      }),
      el('button', {
        class: 'btn btn-sm', text: t('orders.act.label'),
        onclick: () => downloadBlob(api.ecoLabel(tracking, true), `label-${tracking}.pdf`),
      }),
    ]),
    el('div', { class: 'card-body' }, [
      el('div', { class: 'grid grid-2' }, [
        el('dl', { class: 'kv' }, [
          el('dt', { text: t('tracking.recipient') }), el('dd', { text: d.recipientName || '—' }),
          el('dt', { text: t('tracking.shipped_by') }), el('dd', { text: d.shippedBy || '—' }),
          el('dt', { text: t('tracking.current_station') }), el('dd', { text: d.currentStation || '—' }),
          el('dt', { text: t('orders.wilaya') }), el('dd', { text: d.destLocationCity || '—' }),
        ]),
        el('div', {}, [
          el('div', { class: 'mb-2' }, [
            el('strong', { text: t('common.status') }),
            el('div', { class: 'mt-2' }, [
              d.status ? el('span', { class: 'badge done', text: statusLabel(d.status) }) : null,
              last ? activityBadge(last.status) : null,
            ]),
          ]),
          el('div', { class: 'muted', text: last ? `${last.date || ''} ${last.time || ''}` : '' }),
        ]),
      ]),
      el('div', { class: 'sep' }),
      el('h3', { text: t('tracking.history') }),
      timeline(activity.map((a) => ({
        activity: a.status, station: a.station || a.scanLocation || '', event_date: a.date, event_time: a.time,
      }))),
      Array.isArray(d.reasons) && d.reasons.length ? el('div', {}, [
        el('div', { class: 'sep' }),
        el('h3', { text: t('tracking.reasons') }),
        el('div', { class: 'flex' }, d.reasons.map((r2) => el('span', { class: 'chip', text: typeof r2 === 'string' ? r2 : JSON.stringify(r2) }))),
      ]) : null,
    ]),
  ]));
}

/* ── تتبع عدة طرود ─────────────────────────────────────── */
const bulkArea = el('textarea', { placeholder: t('tracking.bulk_placeholder') });
const bulkResult = el('div');

content.appendChild(el('div', { class: 'card' }, [
  el('div', { class: 'card-head' }, [el('h2', { text: t('tracking.bulk') })]),
  el('div', { class: 'card-body' }, [
    bulkArea,
    el('div', { class: 'btn-group mt-2' }, [
      el('button', {
        class: 'btn btn-primary btn-sm', text: t('tracking.find'),
        onclick: async () => {
          const list = bulkArea.value.split(/[\n,\s]+/).map((x) => x.trim()).filter(Boolean);
          if (!list.length) return toast(t('tracking.placeholder'), 'warn');
          if (list.length > 100) return toast('Max 100', 'error');
          clear(bulkResult);
          bulkResult.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
          try {
            const r = await api.ecoTrackings(list);
            const payload = r.data || {};
            const entries = Array.isArray(payload) ? payload : (Array.isArray(payload.data) ? payload.data : Object.values(payload.data || {}));
            renderBulk(entries);
          } catch (err) {
            clear(bulkResult);
            bulkResult.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
          }
        },
      }),
      el('button', {
        class: 'btn btn-sm', text: t('common.refresh'),
        onclick: () => loadLocal(),
      }),
    ]),
    bulkResult,
  ]),
]));

function renderBulk(entries) {
  clear(bulkResult);
  renderTable(bulkResult, {
    columns: [
      { key: 'tracking', label: t('orders.tracking'), class: 'mono' },
      { key: 'status', label: t('common.status'), render: (r) => el('span', { class: 'badge prep', text: statusLabel(r.status) }) },
      {
        key: 'last', label: t('tracking.history'),
        render: (r) => {
          const a = Array.isArray(r.activity) ? r.activity : [];
          const last = a[a.length - 1];
          return last ? el('div', {}, [activityBadge(last.status), el('small', { class: 'muted', text: `${last.date || ''} ${last.time || ''}` })]) : '—';
        },
      },
      { key: 'count', label: 'Events', render: (r) => String((r.activity || []).length) },
    ],
    rows: entries,
    emptyText: t('common.no_data'),
  });
}

/* ── الطلبيات المُرسلة محلياً ───────────────────────────── */
const localCard = el('div', { class: 'card' }, [
  el('div', { class: 'card-head' }, [
    el('h2', { text: t('tracking.local_list') }),
    el('button', { class: 'btn btn-sm btn-primary', text: t('orders.sync_selected'), onclick: () => syncAll() }),
  ]),
]);
const localBody = el('div', { class: 'card-body' });
const localPager = el('div', { class: 'pagination' });
localCard.appendChild(localBody);
localCard.appendChild(localPager);
content.appendChild(localCard);

let localPage = 1;

async function loadLocal() {
  clear(localBody);
  localBody.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
  try {
    const res = await api.orders({ pushed: 1, page: localPage, limit: 25 });
    renderTable(localBody, {
      columns: [
        { key: 'order_number', label: t('orders.number'), class: 'mono' },
        { key: 'customer_name', label: t('orders.customer') },
        { key: 'wilaya_name', label: t('orders.wilaya') },
        { key: 'total', label: t('orders.amount'), class: 'num', render: (r) => moneyWithCurrency(r.total) },
        { key: 'ecotrack_status', label: t('common.status'), render: (r) => statusBadge(r.ecotrack_status || r.status) },
        { key: 'tracking', label: t('orders.tracking'), class: 'mono' },
        { key: 'last_activity', label: t('tracking.history'), render: (r) => (r.last_activity ? activityBadge(r.last_activity) : '—') },
        { key: 'last_activity_at', label: t('common.date'), render: (r) => r.last_activity_at || '—' },
        {
          key: 'actions', label: t('common.actions'), class: 'end',
          render: (r) => el('div', { class: 'actions' }, [
            el('button', { class: 'btn btn-xs', text: t('orders.act.sync'), onclick: () => syncOne(r.id) }),
            el('button', { class: 'btn btn-xs', text: t('orders.act.label'), onclick: () => downloadBlob(api.labelUrl(r.id, true), `label-${r.tracking}.pdf`) }),
            el('a', { class: 'btn btn-xs', href: `orders.html?open=${r.id}`, text: t('common.view') }),
          ]),
        },
      ],
      rows: res.orders,
      emptyText: t('common.no_data'),
    });
    paginationBar(localPager, { page: res.page, pages: res.pages, total: res.total, onChange: (p) => { localPage = p; loadLocal(); } });
  } catch (err) {
    clear(localBody);
    localBody.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
  }
}

async function syncOne(id) {
  try {
    await api.syncOrder(id);
    toast(t('common.success'), 'success');
    loadLocal();
  } catch (err) { toast(err.message, 'error', 6000); }
}

async function syncAll() {
  try {
    const r = await api.syncOrders(null, 'status');
    toast(t('orders.synced_ok', { n: r.updated }), 'success');
    loadLocal();
  } catch (err) { toast(err.message, 'error', 6000); }
}

loadLocal();
