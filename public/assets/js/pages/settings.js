import { initShell } from '../shell.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import {
  el, clear, toast, modal, confirmDialog, renderTable, tabs, field, promptDialog, paginationBar,
} from '../ui.js';

const content = await initShell({ active: 'settings', title: 'settings.title' });
if (!content) throw new Error('unauthorized');

clear(content);

const tabsHost = el('div', { class: 'card' });
content.appendChild(tabsHost);

let settings = {};
try {
  const r = await api.settings();
  settings = r.settings || {};
} catch (err) {
  toast(err.message, 'error');
}

tabs(tabsHost, [
  { id: 'store', label: t('settings.store'), render: () => storeTab() },
  { id: 'users', label: t('settings.users'), render: () => usersTab() },
  { id: 'logs', label: t('settings.logs'), render: () => logsTab() },
  { id: 'system', label: t('settings.db_stats'), render: () => systemTab() },
]);

/* ── المتجر + الطلبيات ─────────────────────────────────── */
function storeTab() {
  const host = el('div', { class: 'card-body' });
  const st = settings.store || {};
  const ec = settings.ecotrack || {};
  const ord = settings.orders || {};

  const mk = (group, key, value, type = 'text') => {
    const i = el('input', { type, value: value ?? '' });
    i.dataset.group = group;
    i.dataset.key = key;
    return i;
  };

  const typeSel = el('select');
  [1, 2, 3, 4].forEach((n2) => typeSel.appendChild(el('option', { value: n2, text: t(`orders.type${n2}`), selected: Number(ec.default_type) === n2 })));
  typeSel.dataset.group = 'ecotrack';
  typeSel.dataset.key = 'default_type';

  const originSel = el('select');
  originSel.dataset.group = 'ecotrack';
  originSel.dataset.key = 'default_origin_wilaya';
  const wilayas = window.__wilayas || [];

  const autoValidate = el('input', { type: 'checkbox' });
  autoValidate.dataset.group = 'ecotrack';
  autoValidate.dataset.key = 'auto_validate';
  autoValidate.checked = Boolean(ec.auto_validate);

  const askCollection = el('input', { type: 'checkbox' });
  askCollection.dataset.group = 'ecotrack';
  askCollection.dataset.key = 'ask_collection';
  askCollection.checked = Boolean(ec.ask_collection);

  const boutique = mk('ecotrack', 'default_boutique', ec.default_boutique);

  host.appendChild(el('h3', { text: t('settings.store') }));
  host.appendChild(el('div', { class: 'form-row' }, [
    field(t('settings.store_name_ar'), mk('store', 'name_ar', st.name_ar)),
    field(t('settings.store_name_fr'), mk('store', 'name_fr', st.name_fr)),
  ]));
  host.appendChild(el('div', { class: 'form-row' }, [
    field(t('settings.store_name_en'), mk('store', 'name_en', st.name_en)),
    field(t('settings.store_phone'), mk('store', 'phone', st.phone)),
  ]));
  host.appendChild(el('div', { class: 'form-row' }, [
    field(t('settings.store_email'), mk('store', 'email', st.email, 'email')),
    field(t('settings.store_address'), mk('store', 'address', st.address)),
  ]));

  host.appendChild(el('div', { class: 'sep' }));
  host.appendChild(el('h3', { text: t('settings.order_defaults') }));
  host.appendChild(el('div', { class: 'form-row' }, [
    field(t('settings.default_type'), typeSel),
    field(t('settings.origin_wilaya'), originSel),
  ]));
  host.appendChild(el('div', { class: 'form-row' }, [
    field(t('orders.boutique'), boutique),
    field(t('orders.shipping_fee'), mk('orders', 'default_shipping_fee', ord.default_shipping_fee, 'number')),
  ]));
  host.appendChild(el('label', { class: 'checkbox mb-2' }, [autoValidate, el('span', { text: t('settings.auto_validate') })]));
  host.appendChild(el('label', { class: 'checkbox mb-2' }, [askCollection, el('span', { text: t('orders.ask_collection') })]));

  host.appendChild(el('div', { class: 'btn-group mt-2' }, [
    el('button', {
      class: 'btn btn-primary btn-sm', text: t('common.save'),
      onclick: async () => {
        const groups = {};
        host.querySelectorAll('[data-group]').forEach((i) => {
          groups[i.dataset.group] = groups[i.dataset.group] || {};
          groups[i.dataset.group][i.dataset.key] = i.type === 'checkbox' ? (i.checked ? 1 : 0) : (i.type === 'number' ? Number(i.value) || 0 : i.value);
        });
        try {
          for (const [g, payload] of Object.entries(groups)) await api.saveSettings(g, payload);
          toast(t('settings.saved'), 'success');
        } catch (err) { toast(err.message, 'error'); }
      },
    }),
    el('button', {
      class: 'btn btn-sm', text: t('settings.change_password'),
      onclick: async () => {
        const current = await promptDialog({ title: t('settings.current_password'), label: t('settings.current_password') });
        if (current === null) return;
        const next = await promptDialog({ title: t('settings.new_password'), label: t('settings.new_password') });
        if (next === null) return;
        try { await api.changePassword(current, next); toast(t('common.success'), 'success'); }
        catch (err) { toast(err.message, 'error'); }
      },
    }),
  ]));

  // تعبئة الولايات بعد التحميل
  api.geoWilayas().then((r) => {
    window.__wilayas = r.wilayas || [];
    clear(originSel);
    originSel.appendChild(el('option', { value: '', text: '—' }));
    window.__wilayas.forEach((w) => originSel.appendChild(el('option', {
      value: w.wilaya_id, text: `${w.wilaya_id} — ${w.name_ar || w.name_fr}`, selected: Number(ec.default_origin_wilaya) === w.wilaya_id,
    })));
  }).catch(() => {});

  return host;
}

/* ── المستخدمون ────────────────────────────────────────── */
function usersTab() {
  const host = el('div', { class: 'card-body' });
  const tableHost = el('div');
  host.appendChild(el('div', { class: 'row-between mb-2' }, [
    el('h3', { class: 'mb-0', text: t('settings.users') }),
    el('button', { class: 'btn btn-primary btn-sm', text: t('settings.user_new'), onclick: () => openUserForm(null, load) }),
  ]));
  host.appendChild(tableHost);

  async function load() {
    clear(tableHost);
    tableHost.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
    try {
      const r = await api.users();
      renderTable(tableHost, {
        columns: [
          { key: 'username', label: t('login.username'), class: 'mono' },
          { key: 'name', label: t('customers.name') },
          { key: 'role', label: t('settings.role') },
          { key: 'last_login', label: t('common.date'), render: (u) => (u.last_login ? String(u.last_login).slice(0, 16) : '—') },
          {
            key: 'actions', label: t('common.actions'), class: 'end',
            render: (u) => el('div', { class: 'actions' }, [
              el('button', { class: 'btn btn-xs', text: t('common.edit'), onclick: () => openUserForm(u, load) }),
              el('button', {
                class: 'btn btn-xs btn-danger', text: t('common.delete'),
                onclick: async () => {
                  if (!await confirmDialog(t('common.delete_confirm'))) return;
                  try { await api.deleteUser(u.id); load(); } catch (err) { toast(err.message, 'error'); }
                },
              }),
            ]),
          },
        ],
        rows: r.users || [],
        emptyText: t('common.no_data'),
      });
    } catch (err) {
      clear(tableHost);
      tableHost.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
    }
  }

  load();
  return host;
}

function openUserForm(user, onDone) {
  const u = user || {};
  const mk = (k, v, type = 'text') => { const i = el('input', { type, value: v ?? '' }); i.dataset.k = k; return i; };
  const role = el('select');
  [['admin', 'admin'], ['staff', 'staff']].forEach(([v, l]) => role.appendChild(el('option', { value: v, text: l, selected: u.role === v })));
  role.dataset.k = 'role';
  const active = el('input', { type: 'checkbox' });
  active.checked = u.active === undefined ? true : Boolean(u.active);
  const body = el('div', {}, [
    field(t('login.username'), mk('username', u.username)),
    field(t('customers.name'), mk('name', u.name)),
    field(t('settings.role'), role),
    field(t('settings.password'), mk('password', '', 'password')),
    el('label', { class: 'checkbox' }, [active, el('span', { text: t('products.active') })]),
  ]);
  modal({
    title: user ? `${t('common.edit')}: ${u.username}` : t('settings.user_new'),
    body,
    actions: [
      { label: t('common.cancel'), variant: 'btn-ghost' },
      {
        label: t('common.save'), variant: 'btn-primary',
        onClick: async (close) => {
          const payload = {};
          body.querySelectorAll('[data-k]').forEach((i) => { payload[i.dataset.k] = i.value; });
          payload.active = active.checked ? 1 : 0;
          if (!payload.password) delete payload.password;
          try { await api.saveUser(payload, user?.id); toast(t('common.success'), 'success'); close(); if (onDone) onDone(); }
          catch (err) { toast(err.message, 'error'); }
        },
      },
    ],
  });
}

/* ── السجل ─────────────────────────────────────────────── */
function logsTab() {
  const host = el('div', { class: 'card-body' });
  const tableHost = el('div');
  const pager = el('div', { class: 'pagination' });
  const q = el('input', { type: 'text', placeholder: `${t('common.search')}…` });
  const onlyErrors = el('input', { type: 'checkbox' });
  let page = 1;

  host.appendChild(el('div', { class: 'filters' }, [
    field('', q),
    el('label', { class: 'checkbox' }, [onlyErrors, el('span', { text: t('common.error') })]),
    el('button', { class: 'btn btn-sm', text: t('common.search'), onclick: () => { page = 1; load(); } }),
  ]));
  host.appendChild(tableHost);
  host.appendChild(pager);

  async function load() {
    clear(tableHost);
    tableHost.appendChild(el('div', { class: 'table-empty', text: t('common.loading') }));
    try {
      const params = { page, q: q.value, limit: 50 };
      if (onlyErrors.checked) params.ok = 0;
      const r = await api.logs(params);
      renderTable(tableHost, {
        columns: [
          { key: 'created_at', label: t('common.date'), render: (l) => String(l.created_at || '').slice(0, 19) },
          { key: 'username', label: t('login.username') },
          { key: 'action', label: t('common.actions'), class: 'mono' },
          { key: 'entity', label: t('shipping.endpoint') },
          { key: 'details', label: t('orders.notes'), class: 'truncate' },
          { key: 'ok', label: t('common.status'), render: (l) => el('span', { class: `badge ${l.ok ? 'done' : 'bad'}`, text: l.ok ? 'OK' : 'FAIL' }) },
        ],
        rows: r.logs || [],
        emptyText: t('common.no_data'),
      });
      paginationBar(pager, { page: r.page, pages: r.pages, total: r.total, onChange: (p) => { page = p; load(); } });
    } catch (err) {
      clear(tableHost);
      tableHost.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
    }
  }

  load();
  return host;
}

/* ── النظام ────────────────────────────────────────────── */
function systemTab() {
  const host = el('div', { class: 'card-body' });
  const box = el('div', { class: 'grid grid-4' });
  host.appendChild(box);
  api.dbStats().then((r) => {
    clear(box);
    Object.entries(r.counts || {}).forEach(([k, v]) => {
      box.appendChild(el('div', { class: 'stat' }, [
        el('div', { class: 'label', text: k }),
        el('div', { class: 'value', text: String(v) }),
      ]));
    });
  }).catch((err) => {
    box.appendChild(el('div', { class: 'alert alert-danger', text: err.message }));
  });

  host.appendChild(el('div', { class: 'sep' }));
  host.appendChild(el('div', { class: 'alert alert-info' }, [
    el('div', { text: 'Sitycom — منصة تجارة إلكترونية مع ربط كامل بـ Ecotrack API v1 (21 endpoint)' }),
    el('small', { class: 'mono', text: 'Node.js + Express + SQLite (node:sqlite) · واجهة HTML/CSS/JS' }),
  ]));
  return host;
}
