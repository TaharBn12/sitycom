// ═══════════════════════════════════════════════════════════
//  أدوات الواجهة المشتركة
// ═══════════════════════════════════════════════════════════
import { t, statusLabel, activityLabel } from './i18n.js';

/* ── بناء عناصر DOM ─────────────────────────────────────── */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.entries(v).forEach(([dk, dv]) => { node.dataset[dk] = dv; });
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

/* ── التنسيق ───────────────────────────────────────────── */
export function money(v) {
  const n = Number(v || 0);
  return new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 0 }).format(n);
}
export function moneyWithCurrency(v) {
  return `${money(v)} ${t('common.currency')}`;
}
export function fmtDate(v) {
  if (!v) return '—';
  const s = String(v).slice(0, 19).replace('T', ' ');
  return s;
}
export function fmtDay(v) {
  return v ? String(v).slice(0, 10) : '—';
}

/* ── التنبيهات ─────────────────────────────────────────── */
let toastRoot;
export function toast(message, type = 'info', ms = 4200) {
  if (!toastRoot) {
    toastRoot = document.getElementById('toasts') || el('div', { id: 'toasts' });
    if (!toastRoot.parentNode) document.body.appendChild(toastRoot);
  }
  const node = el('div', { class: `toast ${type}`, text: message });
  toastRoot.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, ms);
  return node;
}

/* ── النوافذ المنبثقة ──────────────────────────────────── */
export function modal({ title, body, actions = [], size = '', onClose } = {}) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });

  const foot = el('div', { class: 'modal-foot' });
  actions.forEach((a) => {
    foot.appendChild(el('button', {
      class: `btn ${a.variant || ''}`,
      text: a.label,
      onclick: () => { if (a.onClick) a.onClick(close); else close(); },
    }));
  });

  const modalEl = el('div', { class: `modal ${size}` }, [
    el('div', { class: 'modal-head' }, [
      el('h3', { text: title || '' }),
      el('button', { class: 'btn btn-ghost btn-sm', html: '&times;', onclick: close, title: t('common.close') }),
    ]),
    el('div', { class: 'modal-body' }, [typeof body === 'string' ? el('div', { html: body }) : body]),
    actions.length ? foot : null,
  ]);
  backdrop.appendChild(modalEl);
  document.body.appendChild(backdrop);
  return { close, root: modalEl, backdrop };
}

export function confirmDialog(message, { title, danger = true, okLabel } = {}) {
  return new Promise((resolve) => {
    modal({
      title: title || t('common.confirm'),
      size: 'narrow',
      body: el('p', { text: message, class: 'mb-0' }),
      actions: [
        { label: t('common.cancel'), variant: 'btn-ghost', onClick: (close) => { close(); resolve(false); } },
        { label: okLabel || t('common.confirm'), variant: danger ? 'btn-danger' : 'btn-primary', onClick: (close) => { close(); resolve(true); } },
      ],
      onClose: () => resolve(false),
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', multiline = false }) {
  return new Promise((resolve) => {
    const input = multiline
      ? el('textarea', { class: '', placeholder })
      : el('input', { type: 'text', placeholder, value });
    if (multiline) input.value = value;
    const result = (val) => { m.close(); resolve(val); };
    const m = modal({
      title,
      body: el('div', {}, [
        label ? el('div', { class: 'field' }, [el('label', { text: label }), input]) : input,
      ]),
      actions: [
        { label: t('common.cancel'), variant: 'btn-ghost', onClick: () => result(null) },
        { label: t('common.save'), variant: 'btn-primary', onClick: () => result(input.value.trim()) },
      ],
      onClose: () => resolve(null),
    });
    setTimeout(() => input.focus(), 50);
  });
}

/* ── الشارات ───────────────────────────────────────────── */
const STATUS_CLASS = {
  draft: 'gray',
  prete_a_expedier: 'new',
  en_ramassage: 'prep',
  en_preparation_stock: 'prep',
  vers_hub: 'transit',
  en_hub: 'transit',
  vers_wilaya: 'transit',
  en_preparation: 'prep',
  en_livraison: 'transit',
  suspendu: 'warn',
  livre_non_encaisse: 'done',
  livre: 'done',
  encaisse_non_paye: 'done',
  paiements_prets: 'done',
  paye_et_archive: 'done',
  retour_chez_livreur: 'return',
  retour_transit_entrepot: 'return',
  retour_en_traitement: 'return',
  retour_recu: 'return',
  retour_archive: 'return',
  annule: 'bad',
  cancelled: 'bad',
};

export function statusBadge(status) {
  const cls = STATUS_CLASS[status] || 'gray';
  return el('span', { class: `badge ${cls}`, text: statusLabel(status) });
}

export function activityBadge(activity) {
  const returning = String(activity || '').startsWith('return') || String(activity) === 'Return_received';
  const done = ['livred', 'encaissed', 'payed'].includes(activity);
  const cls = returning ? 'return' : done ? 'done' : 'prep';
  return el('span', { class: `badge ${cls}`, text: activityLabel(activity) });
}

export function mockBadge() {
  return el('span', { class: 'badge mock', text: t('common.mock_mode') });
}

/* ── الجداول ───────────────────────────────────────────── */
export function renderTable(container, { columns, rows, emptyText, onRowClick }) {
  clear(container);
  if (!rows.length) {
    container.appendChild(el('div', { class: 'table-empty', text: emptyText || t('common.no_data') }));
    return;
  }
  const table = el('table', { class: 'table' });
  const thead = el('thead');
  thead.appendChild(el('tr', {}, columns.map((c) => el('th', {
    text: c.label,
    style: c.width ? { width: c.width } : {},
    class: c.class || '',
  }))));
  table.appendChild(thead);
  const tbody = el('tbody');
  rows.forEach((row) => {
    const tr = el('tr', { class: row.__class || '' });
    columns.forEach((c) => {
      const value = c.render ? c.render(row) : row[c.key];
      tr.appendChild(el('td', { class: c.class || '' }, [value === null || value === undefined ? '—' : value]));
    });
    if (onRowClick) tr.addEventListener('click', (e) => onRowClick(row, e));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(el('div', { class: 'table-wrap' }, [table]));
}

export function paginationBar(container, { page, pages, total, onChange }) {
  clear(container);
  if (pages <= 1) return;
  const btn = (label, target, disabled, active) => el('button', {
    class: `btn btn-sm ${active ? 'btn-primary' : ''}`,
    text: label,
    disabled: disabled || undefined,
    onclick: () => onChange(target),
  });
  container.appendChild(el('span', { class: 'muted', text: `${t('common.page')} ${page} ${t('common.of')} ${pages} · ${total}` }));
  container.appendChild(btn(t('common.previous'), page - 1, page <= 1));
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let p = start; p < Math.min(start + 5, pages + 1); p += 1) container.appendChild(btn(String(p), p, false, p === page));
  container.appendChild(btn(t('common.next'), page + 1, page >= pages));
}

/* ── CSV ───────────────────────────────────────────────── */
export function toCsv(columns, rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => {
    const v = c.csv ? c.csv(r) : (c.key ? r[c.key] : '');
    return escape(typeof v === 'string' ? v.replace(/<[^>]*>/g, '') : v);
  }).join(','));
  return `﻿${head}\n${body.join('\n')}`;
}

export function downloadCsv(filename, columns, rows) {
  const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8;' });
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ── مساعدات متنوعة ────────────────────────────────────── */
export function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast(t('common.copied'), 'success', 1500));
  }
}

export async function withLoading(button, fn) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span>';
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

export function emptyState(text, action) {
  return el('div', { class: 'table-empty' }, [
    el('p', { text }),
    action || null,
  ]);
}

export function field(labelText, control, hint) {
  return el('div', { class: 'field' }, [
    labelText ? el('label', { text: labelText }) : null,
    control,
    hint ? el('div', { class: 'hint', text: hint }) : null,
  ]);
}

export function tabs(container, tabsList, onChange) {
  const bar = el('div', { class: 'tabs' });
  const panels = {};
  const buttons = tabsList.map((tb, i) => {
    const btn = el('button', {
      class: i === 0 ? 'active' : '',
      text: tb.label,
      onclick: () => {
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        Object.values(panels).forEach((p) => p.classList.remove('active'));
        panels[tb.id].classList.add('active');
        if (onChange) onChange(tb.id);
        if (tb.onShow) tb.onShow();
      },
    });
    bar.appendChild(btn);
    panels[tb.id] = el('div', { class: `tab-panel ${i === 0 ? 'active' : ''}` });
    if (tb.render) panels[tb.id].appendChild(tb.render());
    return btn;
  });
  container.appendChild(bar);
  tabsList.forEach((tb) => container.appendChild(panels[tb.id]));
  return { panels, activate: (id) => buttons[tabsList.findIndex((x) => x.id === id)]?.click() };
}

export function timeline(events, { empty = t('common.no_data') } = {}) {
  if (!events.length) return el('div', { class: 'table-empty', text: empty });
  return el('div', { class: 'timeline' }, events.map((ev) => {
    const returning = String(ev.activity || ev.status || '').startsWith('retour') || String(ev.activity).startsWith('return');
    const done = ['livred', 'encaissed', 'payed'].includes(ev.activity) || String(ev.status).startsWith('paye');
    return el('div', { class: `item ${returning ? 'return' : done ? 'done' : ''}` }, [
      el('div', { class: 'flex', style: { justifyContent: 'space-between' } }, [
        el('strong', { text: activityLabel(ev.activity || ev.status) }),
        el('span', { class: 'time', text: `${fmtDay(ev.event_date)} ${ev.event_time || ''}`.trim() }),
      ]),
      ev.status ? el('div', {}, [statusBadge(ev.status)]) : null,
      ev.station ? el('div', { class: 'muted', text: ev.station }) : null,
      ev.driver ? el('div', { class: 'muted', text: ev.driver }) : null,
      ev.details ? el('div', { class: 'muted', text: ev.details }) : null,
    ]);
  }));
}

export function bars(data, { valueKey = 'revenue', labelKey = 'day' } = {}) {
  if (!data.length) return el('div', { class: 'table-empty', text: t('common.no_data') });
  const max = Math.max(...data.map((d) => Number(d[valueKey] || 0)), 1);
  return el('div', { class: 'bars' }, data.slice(-30).map((d) => el('div', {
    class: 'bar',
    style: { height: `${Math.max(2, (Number(d[valueKey] || 0) / max) * 100)}%` },
    dataset: { label: `${d[labelKey]} · ${money(d[valueKey])}` },
  })));
}

export function progressBars(items, total) {
  const max = Math.max(...items.map((i) => Number(i.count || 0)), 1);
  return el('div', {}, items.map((i) => el('div', { style: { marginBottom: '10px' } }, [
    el('div', { class: 'flex', style: { justifyContent: 'space-between', marginBottom: '4px' } }, [
      el('span', {}, [statusBadge(i.status)]),
      el('strong', { text: String(i.count) }),
    ]),
    el('div', { class: 'progress' }, [el('div', { style: { width: `${(Number(i.count) / max) * 100}%` } })]),
  ])));
}

/** يضبط قيمة <select> بطريقة متوافقة مع كل البيئات */
export function selectValue(select, value) {
  try { select.value = value; } catch { /* some DOM shims */ }
  const opts = select.options || [];
  for (const o of opts) {
    if (String(o.value) === String(value)) o.setAttribute('selected', '');
    else o.removeAttribute('selected');
  }
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}
