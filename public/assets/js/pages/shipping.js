import { initShell } from '../shell.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import {
  el, clear, money, toast, modal, confirmDialog, renderTable, tabs, field, downloadCsv, selectValue,
} from '../ui.js';

const content = await initShell({ active: 'shipping', title: 'shipping.title' });
if (!content) throw new Error('unauthorized');

const ENDPOINTS = [
  ['GET', '/api/v1/validate/token', 'التحقق من صلاحية التوكن', 'Vérifier la validité du token', 'Validate token', 'connection'],
  ['GET', '/api/v1/', 'معلومات حد الطلبات (Rate limit)', 'Limite de requêtes', 'Rate limit', 'connection'],
  ['POST', '/api/v1/create/order', 'إنشاء طلبية واحدة', 'Créer une commande', 'Create one order', 'orders'],
  ['POST', '/api/v1/create/orders', 'إنشاء حتى 100 طلبية', 'Créer jusqu’à 100 commandes', 'Bulk create (≤100)', 'orders'],
  ['POST', '/api/v1/update/order', 'تعديل طلبية', 'Modifier une commande', 'Update order', 'orders'],
  ['DELETE', '/api/v1/delete/order', 'حذف طلبية', 'Supprimer une commande', 'Delete order', 'orders'],
  ['POST', '/api/v1/valid/order', 'مصادقة وشحن', 'Valider et expédier', 'Validate & ship', 'orders'],
  ['POST', '/api/v1/valid/returns', 'تأكيد استلام المرتجعات', 'Confirmer réception des retours', 'Confirm returns', 'returns'],
  ['GET', '/api/v1/get/order/label', 'ملصق الشحن PDF', 'Étiquette PDF', 'Shipping label', 'orders'],
  ['POST', '/api/v1/add/maj', 'إضافة ملاحظة/تحديث', 'Ajouter une remarque', 'Add note', 'tracking'],
  ['GET', '/api/v1/get/maj', 'قائمة التحديثات', 'Liste des remarques', 'List notes', 'tracking'],
  ['POST', '/api/v1/ask/for/order/return', 'طلب إرجاع طرد', 'Demander le retour', 'Request return', 'returns'],
  ['GET', '/api/v1/get/tracking/info', 'سجل طلبية واحدة', 'Suivi d’un colis', 'Tracking info', 'tracking'],
  ['GET', '/api/v1/get/trackings/info', 'سجل حتى 100 طرد', 'Suivi de ≤100 colis', 'Bulk tracking (≤100)', 'tracking'],
  ['GET', '/api/v1/get/orders', 'قائمة الطلبيات (40/صفحة)', 'Liste des commandes', 'Orders list', 'orders'],
  ['GET', '/api/v1/get/orders/status', 'فلترة الطلبيات حسب الحالة', 'Filtrer par statut', 'Filter by status', 'tracking'],
  ['GET', '/api/v1/get/wilayas', 'الولايات النشطة', 'Wilayas actives', 'Wilayas', 'geo'],
  ['GET', '/api/v1/get/desks', 'مكاتب Stop Desk', 'Points Stop Desk', 'Stop desks', 'geo'],
  ['GET', '/api/v1/get/communes', 'البلديات', 'Communes', 'Communes', 'geo'],
  ['GET', '/api/v1/get/fees', 'أسعار التوصيل', 'Tarifs de livraison', 'Delivery fees', 'geo'],
  ['GET', '/api/v1/get/products/list', 'منتجات الحساب', 'Produits du compte', 'Account products', 'products'],
];

clear(content);

/* ══════════════════════ الاتصال ══════════════════════ */
const connCard = el('div', { class: 'card' }, [
  el('div', { class: 'card-head' }, [
    el('h2', { text: t('shipping.connection') }),
    (() => { const b = el('span', { class: 'badge gray', text: t('common.loading') }); b.id = 'conn-badge'; return b; })(),
  ]),
]);
const connBody = el('div', { class: 'card-body' });
connCard.appendChild(connBody);
content.appendChild(connCard);

const baseUrl = el('input', { type: 'text', placeholder: t('shipping.base_url_hint') });
const token = el('input', { type: 'text', placeholder: 'OijXEU…' });
const authMode = el('select');
[['both', 'Bearer + query'], ['bearer', 'Bearer'], ['query', 'query param']].forEach(([v, l]) => authMode.appendChild(el('option', { value: v, text: l })));
const timeout = el('input', { type: 'number', value: '20000' });
const mockBox = el('input', { type: 'checkbox' });
const validationBox = el('div', { class: 'mt-2' });

connBody.appendChild(el('div', { class: 'form-row' }, [
  field(t('shipping.base_url'), baseUrl),
  field(t('shipping.token'), token, t('shipping.token_saved')),
]));
connBody.appendChild(el('div', { class: 'form-row' }, [
  field(t('shipping.auth_mode'), authMode),
  field(t('shipping.timeout'), timeout),
]));
connBody.appendChild(el('label', { class: 'checkbox mb-2' }, [mockBox, el('span', { text: t('shipping.mock_mode') })]));
connBody.appendChild(el('div', { class: 'btn-group' }, [
  el('button', { class: 'btn btn-primary btn-sm', text: t('shipping.save'), onclick: () => saveSettings() }),
  el('button', { class: 'btn btn-sm', text: t('shipping.test'), onclick: () => testConnection() }),
  el('button', { class: 'btn btn-sm', text: t('shipping.rate_limit'), onclick: () => showRateLimit() }),
  el('button', { class: 'btn btn-sm', text: t('common.refresh'), onclick: () => loadStatus() }),
]));
connBody.appendChild(validationBox);

/* ══════════════════════ المزامنة ══════════════════════ */
const syncCard = el('div', { class: 'card' }, [
  el('div', { class: 'card-head' }, [el('h2', { text: t('shipping.sync') })]),
]);
const syncBody = el('div', { class: 'card-body' });
syncCard.appendChild(syncBody);
content.appendChild(syncCard);

const wilayaForCommunes = el('select');
wilayaForCommunes.appendChild(el('option', { value: '', text: `${t('orders.wilaya')}: ${t('common.all')}` }));

const syncBtn = (label, fn, variant = '') => el('button', {
  class: `btn btn-sm ${variant}`, text: label,
  onclick: async (e) => {
    const btn = e.currentTarget;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await fn();
      toast(t('shipping.synced_ok', { n: r?.count ?? '✓' }), 'success');
      loadStatus();
      reloadTabs();
    } catch (err) {
      toast(err.message, 'error', 8000);
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  },
});

syncBody.appendChild(el('div', { class: 'btn-group' }, [
  syncBtn(`17 · ${t('shipping.sync_wilayas')}`, () => api.syncWilayas(), 'btn-primary'),
  syncBtn(`19 · ${t('shipping.sync_communes')}`, () => api.syncCommunes(wilayaForCommunes.value || null)),
  syncBtn(`18 · ${t('shipping.sync_desks')}`, () => api.syncDesks()),
  syncBtn(`20 · ${t('shipping.sync_fees')}`, () => api.syncFees(), 'btn-primary'),
  syncBtn(`21 · ${t('shipping.sync_products')}`, () => api.syncProducts(5)),
  syncBtn(t('shipping.sync_all'), () => api.syncAll({ communes: false, products: true }), 'btn-success'),
]));
syncBody.appendChild(el('div', { class: 'form-row mt-2', style: { maxWidth: '320px' } }, [
  field(t('orders.wilaya'), wilayaForCommunes),
]));
const countsBox = el('div', { class: 'flex mt-2 muted' });
syncBody.appendChild(countsBox);

/* ══════════════════════ التبويبات ══════════════════════ */
const tabsHost = el('div', { class: 'card' });
content.appendChild(tabsHost);

const feesHost = el('div');
const wilayasHost = el('div');
const communesHost = el('div');
const desksHost = el('div');
const logsHost = el('div');

tabs(tabsHost, [
  { id: 'fees', label: t('shipping.tab_fees'), render: () => feesHost },
  { id: 'wilayas', label: t('shipping.tab_wilayas'), render: () => wilayasHost },
  { id: 'communes', label: t('shipping.tab_communes'), render: () => communesHost },
  { id: 'desks', label: t('shipping.tab_desks'), render: () => desksHost },
  { id: 'logs', label: t('shipping.tab_logs'), render: () => logsHost },
  { id: 'endpoints', label: t('shipping.endpoints_list'), render: () => endpointsHost() },
]);

/* ── الأسعار ─────────────────────────────────────────── */
const feesWrap = el('div', { class: 'card-body' });
feesHost.appendChild(feesWrap);
let feesRows = [];

async function loadFees() {
  clear(feesWrap);
  feesWrap.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
  try {
    const r = await api.geoFees();
    feesRows = r.fees || [];
    renderTable(feesWrap, {
      columns: [
        { key: 'wilaya_id', label: '#' },
        { key: 'wilaya_name', label: t('orders.wilaya') },
        { key: 'delivery_home', label: `${t('shipping.delivery')} · ${t('shipping.fee_home')}`, class: 'num', render: (r2) => money(r2.delivery_home) },
        { key: 'delivery_stopdesk', label: `${t('shipping.delivery')} · ${t('shipping.fee_desk')}`, class: 'num', render: (r2) => money(r2.delivery_stopdesk) },
        { key: 'exchange_home', label: `${t('shipping.exchange')} · ${t('shipping.fee_home')}`, class: 'num', render: (r2) => money(r2.exchange_home) },
        { key: 'exchange_stopdesk', label: `${t('shipping.exchange')} · ${t('shipping.fee_desk')}`, class: 'num', render: (r2) => money(r2.exchange_stopdesk) },
        { key: 'pickup_home', label: `${t('shipping.pickup')} · ${t('shipping.fee_home')}`, class: 'num', render: (r2) => money(r2.pickup_home) },
        { key: 'pickup_stopdesk', label: `${t('shipping.pickup')} · ${t('shipping.fee_desk')}`, class: 'num', render: (r2) => money(r2.pickup_stopdesk) },
        { key: 'collection_home', label: `${t('shipping.collection')} · ${t('shipping.fee_home')}`, class: 'num', render: (r2) => money(r2.collection_home) },
        { key: 'return_home', label: `${t('shipping.return')} · ${t('shipping.fee_home')}`, class: 'num', render: (r2) => money(r2.return_home) },
        { key: 'synced_at', label: t('shipping.last_sync'), render: (r2) => String(r2.synced_at || '').slice(0, 16) },
      ],
      rows: feesRows,
      emptyText: t('common.no_data'),
    });
    feesWrap.appendChild(el('div', { class: 'mt-2' }, [
      el('button', {
        class: 'btn btn-sm',
        text: t('common.export'),
        onclick: () => downloadCsv('fees.csv', [
          { label: 'wilaya_id', key: 'wilaya_id' }, { label: 'wilaya', key: 'wilaya_name' },
          { label: 'home', key: 'delivery_home' }, { label: 'stopdesk', key: 'delivery_stopdesk' },
        ], feesRows),
      }),
    ]));
  } catch (err) {
    clear(feesWrap);
    feesWrap.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
  }
}

/* ── الولايات ────────────────────────────────────────── */
const wilayasWrap = el('div', { class: 'card-body' });
wilayasHost.appendChild(wilayasWrap);

async function loadWilayas() {
  clear(wilayasWrap);
  try {
    const r = await api.geoWilayas();
    renderTable(wilayasWrap, {
      columns: [
        { key: 'wilaya_id', label: '#' },
        { key: 'name_ar', label: 'العربية' },
        { key: 'name_fr', label: 'Français' },
        { key: 'has_stop_desk', label: t('shipping.tab_desks'), render: (r2) => (r2.has_stop_desk ? el('span', { class: 'badge done', text: t('common.yes') }) : el('span', { class: 'badge gray', text: t('common.no') })) },
        { key: 'synced_at', label: t('shipping.last_sync'), render: (r2) => String(r2.synced_at || '—').slice(0, 16) },
      ],
      rows: r.wilayas || [],
      emptyText: t('common.no_data'),
    });
  } catch (err) {
    wilayasWrap.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
  }
}

/* ── البلديات ────────────────────────────────────────── */
const communesWrap = el('div', { class: 'card-body' });
communesHost.appendChild(communesWrap);
const communeFilter = el('select');
communeFilter.appendChild(el('option', { value: '', text: t('common.all') }));
communeFilter.addEventListener('change', () => loadCommunes());
const communeSearch = el('input', { type: 'text', placeholder: `${t('common.search')}…` });
communeSearch.addEventListener('input', () => loadCommunes());

communesWrap.appendChild(el('div', { class: 'filters' }, [
  field(t('orders.wilaya'), communeFilter),
  field('', communeSearch),
]));
const communesTable = el('div');
communesWrap.appendChild(communesTable);

async function loadCommunes() {
  clear(communesTable);
  communesTable.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
  try {
    const r = await api.geoCommunes(communeFilter.value || null);
    const q = communeSearch.value.trim().toLowerCase();
    let rows = r.communes || [];
    if (q) rows = rows.filter((c) => String(c.name).toLowerCase().includes(q));
    renderTable(communesTable, {
      columns: [
        { key: 'wilaya_id', label: 'Wilaya' },
        { key: 'name', label: t('orders.commune') },
        { key: 'code_postal', label: 'Code postal', class: 'mono' },
        { key: 'has_stop_desk', label: t('shipping.tab_desks'), render: (c) => (c.has_stop_desk ? el('span', { class: 'badge done', text: t('common.yes') }) : el('span', { class: 'badge gray', text: '—' })) },
      ],
      rows: rows.slice(0, 800),
      emptyText: t('common.no_data'),
    });
    communesTable.appendChild(el('small', { class: 'muted', text: `${rows.length} ${t('shipping.communes_count')}` }));
  } catch (err) {
    clear(communesTable);
    communesTable.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
  }
}

/* ── المكاتب ─────────────────────────────────────────── */
const desksWrap = el('div', { class: 'card-body' });
desksHost.appendChild(desksWrap);

async function loadDesks() {
  clear(desksWrap);
  try {
    const r = await api.geoDesks();
    renderTable(desksWrap, {
      columns: [
        { key: 'name', label: t('shipping.tab_desks') },
        { key: 'wilaya', label: t('orders.wilaya') },
        { key: 'commune', label: t('orders.commune') },
        { key: 'address', label: t('orders.address'), class: 'truncate' },
        { key: 'phone', label: t('orders.phone'), class: 'mono' },
        {
          key: 'is_my_desk', label: '★',
          render: (d) => (d.is_my_desk ? el('span', { class: 'badge done', text: 'MY DESK' }) : null),
        },
      ],
      rows: r.desks || [],
      emptyText: t('common.no_data'),
    });
  } catch (err) {
    desksWrap.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
  }
}

/* ── السجل ───────────────────────────────────────────── */
const logsWrap = el('div', { class: 'card-body' });
logsHost.appendChild(logsWrap);

async function loadLogs() {
  clear(logsWrap);
  try {
    const r = await api.syncHistory();
    renderTable(logsWrap, {
      columns: [
        { key: 'id', label: '#' },
        { key: 'kind', label: t('shipping.endpoint') },
        { key: 'status', label: t('common.status'), render: (j) => el('span', { class: `badge ${j.status === 'success' ? 'done' : j.status === 'partial' ? 'warn' : 'bad'}`, text: j.status }) },
        { key: 'count', label: 'Count' },
        { key: 'message', label: t('orders.notes'), class: 'truncate' },
        { key: 'started_at', label: t('common.date'), render: (j) => String(j.started_at || '').slice(0, 16) },
      ],
      rows: r.jobs || [],
      emptyText: t('common.no_data'),
    });
  } catch (err) {
    logsWrap.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
  }
}

/* ── قائمة الـ Endpoints ─────────────────────────────── */
function endpointsHost() {
  const host = el('div', { class: 'card-body' });
  const langIdx = { ar: 2, fr: 3, en: 4 }[getLang()] || 2;
  renderTable(host, {
    columns: [
      { key: 'method', label: 'Method', width: '90px', render: (r) => el('span', { class: `badge ${r.method === 'GET' ? 'prep' : r.method === 'DELETE' ? 'bad' : 'new'}`, text: r.method }) },
      { key: 'path', label: t('shipping.endpoint'), class: 'mono' },
      { key: 'desc', label: t('orders.notes'), render: (r) => r.desc },
      { key: 'where', label: t('nav.dashboard'), render: (r) => el('span', { class: 'badge gray', text: r.where }) },
    ],
    rows: ENDPOINTS.map(([method, path, ar, fr, en, where]) => ({ method, path, desc: [ar, fr, en][langIdx - 2], where })),
    emptyText: t('common.no_data'),
  });
  host.appendChild(el('div', { class: 'alert alert-info mt-2' }, [
    el('span', { text: 'المصدر: documenter.getpostman.com/view/14517169/Tz5je15g — كل الـ 21 endpoint مغطّاة في هذا المشروع.' }),
  ]));
  return host;
}

/* ══════════════════════ التحميل ══════════════════════ */
async function loadStatus() {
  try {
    const st = await api.ecoStatus();
    baseUrl.value = st.config.base_url || '';
    selectValue(authMode, st.config.auth_mode || 'both');
    timeout.value = st.config.timeout || 20000;
    mockBox.checked = Boolean(st.config.mock);
    token.value = '';
    token.placeholder = st.config.api_token || 'OijXEU…';

    const badge = document.getElementById('conn-badge');
    badge.className = `badge ${st.config.mock ? 'mock' : 'done'}`;
    badge.textContent = st.config.mock ? t('common.mock_mode') : t('common.live_mode');

    clear(validationBox);
    if (st.validation) {
      validationBox.appendChild(el('div', {
        class: `alert ${st.validation.ok ? 'alert-success' : 'alert-danger'} mb-0`,
        text: `${st.validation.ok ? '✓' : '✗'} ${JSON.stringify(st.validation.data || st.validation.error)}`,
      }));
    }

    clear(countsBox);
    countsBox.appendChild(el('span', { text: `${t('shipping.wilayas_count')}: ${st.counts.wilayas}` }));
    countsBox.appendChild(el('span', { text: `${t('shipping.communes_count')}: ${st.counts.communes}` }));
    countsBox.appendChild(el('span', { text: `${t('shipping.desks_count')}: ${st.counts.desks}` }));
    countsBox.appendChild(el('span', { text: `${t('shipping.tab_fees')}: ${st.counts.fees}` }));
    countsBox.appendChild(el('span', { text: `${t('shipping.products_count')}: ${st.counts.products}` }));

    // تعبئة قوائم الولايات
    const w = await api.geoWilayas();
    [wilayaForCommunes, communeFilter].forEach((sel) => {
      const first = sel.options[0];
      clear(sel);
      sel.appendChild(first);
      (w.wilayas || []).forEach((x) => sel.appendChild(el('option', { value: x.wilaya_id, text: `${x.wilaya_id} — ${x.name_ar || x.name_fr}` })));
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function saveSettings() {
  const payload = {
    base_url: baseUrl.value.trim(),
    auth_mode: authMode.value,
    timeout: Number(timeout.value) || 20000,
    mock: mockBox.checked ? true : false,
  };
  if (token.value.trim()) payload.api_token = token.value.trim();
  try {
    await api.saveSettings('ecotrack', payload);
    toast(t('settings.saved'), 'success');
    loadStatus();
  } catch (err) { toast(err.message, 'error'); }
}

async function testConnection() {
  const payload = {};
  if (baseUrl.value.trim()) payload.base_url = baseUrl.value.trim();
  if (token.value.trim()) payload.api_token = token.value.trim();
  payload.auth_mode = authMode.value;
  try {
    const r = await api.ecoTest(payload);
    clear(validationBox);
    validationBox.appendChild(el('div', {
      class: 'alert alert-success mb-0',
      text: `✓ ${JSON.stringify(r.data)} ${r.mock ? '(mock)' : ''}`,
    }));
  } catch (err) {
    clear(validationBox);
    validationBox.appendChild(el('div', { class: 'alert alert-danger mb-0', text: `✗ ${err.message}` }));
  }
}

async function showRateLimit() {
  try {
    const r = await api.ecoRateLimit();
    modal({
      title: t('shipping.rate_limit'),
      body: el('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap' }, text: JSON.stringify(r.data ?? r, null, 2) }),
    });
  } catch (err) { toast(err.message, 'error'); }
}

function reloadTabs() {
  loadFees(); loadWilayas(); loadCommunes(); loadDesks(); loadLogs();
}

await loadStatus();
loadFees();
loadWilayas();
loadCommunes();
loadDesks();
loadLogs();
