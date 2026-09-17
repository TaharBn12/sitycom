// ═══════════════════════════════════════════════════════════
//  الهيكل العام: الشريط الجانبي + الشريط العلوي + حماية الصفحات
// ═══════════════════════════════════════════════════════════
import { t, initI18n, setLang, getLang, onLangChange, LANGS } from './i18n.js';
import { api, getToken, getUser, clearSession } from './api.js';
import { el, clear, toast } from './ui.js';

const NAV = [
  {
    title: 'nav.dashboard',
    items: [
      { id: 'dashboard', href: 'index.html', icon: '🏠', label: 'nav.dashboard', badgeKey: 'not_pushed' },
    ],
  },
  {
    title: 'nav.orders',
    items: [
      { id: 'orders', href: 'orders.html', icon: '📦', label: 'nav.orders_all' },
      { id: 'orders-new', href: 'orders-new.html', icon: '➕', label: 'nav.orders_new' },
    ],
  },
  {
    title: 'nav.shipping',
    items: [
      { id: 'shipping', href: 'shipping.html', icon: '🚚', label: 'nav.shipping_hub' },
      { id: 'tracking', href: 'tracking.html', icon: '🔍', label: 'nav.tracking' },
      { id: 'returns', href: 'returns.html', icon: '↩️', label: 'nav.returns' },
    ],
  },
  {
    title: 'nav.catalog',
    items: [
      { id: 'products', href: 'products.html', icon: '🏷️', label: 'nav.products' },
      { id: 'customers', href: 'customers.html', icon: '👥', label: 'nav.customers' },
    ],
  },
  {
    title: '',
    items: [
      { id: 'reports', href: 'reports.html', icon: '📊', label: 'nav.reports' },
      { id: 'settings', href: 'settings.html', icon: '⚙️', label: 'nav.settings' },
      { id: 'public', href: 'track.html', icon: '🧭', label: 'nav.public_track', external: true },
    ],
  },
];

let storeName = '';

function langSwitcher() {
  const box = el('div', { class: 'lang-switch' });
  LANGS.forEach((l) => {
    const btn = el('button', {
      text: l.code.toUpperCase(),
      class: getLang() === l.code ? 'active' : '',
      title: l.label,
      onclick: () => {
        setLang(l.code);
        document.documentElement.dispatchEvent(new CustomEvent('langchange'));
        location.reload();
      },
    });
    box.appendChild(btn);
  });
  return box;
}

function renderSidebar(active, badges = {}) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  clear(sidebar);
  sidebar.appendChild(el('a', { class: 'brand', href: 'index.html', style: { textDecoration: 'none' } }, [
    el('div', { class: 'logo', text: 'س' }),
    el('div', {}, [
      el('b', { text: storeName || t('app.name') }),
      el('span', { text: t('app.tagline') }),
    ]),
  ]));

  NAV.forEach((group) => {
    const g = el('div', { class: 'nav-group' });
    if (group.title) g.appendChild(el('div', { class: 'nav-group-title', text: t(group.title) }));
    const nav = el('nav', { class: 'nav' });
    group.items.forEach((item) => {
      const count = badges[item.badgeKey];
      nav.appendChild(el('a', {
        href: item.href,
        class: active === item.id ? 'active' : '',
        ...(item.external ? { target: '_blank', rel: 'noopener' } : {}),
      }, [
        el('span', { class: 'ico', text: item.icon }),
        el('span', { text: t(item.label) }),
        count ? el('span', { class: 'count', text: String(count) }) : null,
      ]));
    });
    g.appendChild(nav);
    sidebar.appendChild(g);
  });
}

function renderTopbar(titleKey) {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;
  clear(topbar);
  const user = getUser() || { name: '—', username: '' };

  topbar.appendChild(el('button', {
    class: 'btn btn-ghost btn-sm',
    html: '&#9776;',
    id: 'menu-toggle',
    onclick: () => document.getElementById('sidebar').classList.toggle('open'),
  }));
  topbar.appendChild(el('div', { class: 'page-title', text: t(titleKey) }));
  topbar.appendChild(el('div', { class: 'spacer' }));

  const modeChip = el('span', { class: 'badge gray', text: t('common.loading') });
  api.ecoStatus().then((r) => {
    modeChip.className = `badge ${r.config.mock ? 'mock' : 'done'}`;
    modeChip.textContent = r.config.mock ? t('common.mock_mode') : t('common.live_mode');
    modeChip.title = r.config.base_url || '';
  }).catch(() => { modeChip.textContent = ''; });
  topbar.appendChild(modeChip);

  topbar.appendChild(langSwitcher());

  topbar.appendChild(el('div', { class: 'user-menu' }, [
    el('div', { class: 'avatar', text: (user.name || user.username || 'A').slice(0, 1) }),
    el('span', { text: user.name || user.username || '' }),
    el('button', {
      class: 'btn btn-sm btn-ghost',
      text: t('settings.logout'),
      onclick: async () => {
        await api.logout();
        clearSession();
        location.href = 'login.html';
      },
    }),
  ]));
}

export async function initShell({ active, title }) {
  initI18n();
  if (!getToken()) {
    location.href = 'login.html';
    return null;
  }
  try {
    const st = await api.publicStatus();
    storeName = st.store?.[`name_${getLang()}`] || st.store?.name_ar || '';
  } catch { /* ignore */ }

  let badges = {};
  try {
    const d = await api.dashboard(30);
    badges = { not_pushed: d.cards.not_pushed };
  } catch { /* ignore */ }

  renderSidebar(active, badges);
  renderTopbar(title);
  document.title = `${t(title)} · ${storeName || t('app.name')}`;

  const content = document.getElementById('page-content');
  onLangChange(() => {
    renderSidebar(active, badges);
    renderTopbar(title);
  });
  return content;
}

/** يهيئ صفحة عامة (بدون دخول) مثل login/track */
export function initPublicShell() {
  initI18n();
}

export function guardReady() {
  return Boolean(getToken());
}
