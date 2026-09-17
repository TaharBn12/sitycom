import { initI18n, setLang, getLang, LANGS, t, activityLabel, statusLabel } from '../i18n.js';
import { api } from '../api.js';
import { el, clear, toast, timeline, fmtDay, fmtDate } from '../ui.js';

initI18n();

const box = document.getElementById('lang-box');
LANGS.forEach((l) => {
  box.appendChild(el('button', {
    class: `btn btn-sm ${getLang() === l.code ? 'btn-primary' : ''}`,
    text: l.label,
    onclick: () => { setLang(l.code); location.reload(); },
  }));
});

api.publicStatus().then((s) => {
  const name = s.store?.[`name_${getLang()}`] || s.store?.name_ar || '';
  const title = document.getElementById('store-name');
  if (name) title.textContent = name;
  document.title = `${name} — ${t('track.title')}`;
}).catch(() => {});

const input = document.getElementById('tracking-input');
const btn = document.getElementById('track-btn');
const result = document.getElementById('track-result');

const STEPS = [
  'order_information_received_by_carrier', 'picked', 'accepted_by_carrier',
  'dispatched_to_driver', 'attempt_delivery', 'livred',
];

function stepper(activity) {
  const reached = new Set(activity.map((a) => a.status));
  const lastIndex = Math.max(...activity.map((a) => STEPS.indexOf(a.status)), -1);
  const returned = activity.some((a) => String(a.status).startsWith('return') || a.status === 'Return_received');
  if (returned) {
    return el('div', { class: 'alert alert-warn', text: t('status.retour_en_traitement') });
  }
  return el('div', { class: 'stepper' }, STEPS.map((s, i) => el('div', {
    class: `step ${i < lastIndex ? 'done' : i === lastIndex ? 'current' : ''}`,
    text: activityLabel(s),
  })));
}

async function search() {
  const tracking = input.value.trim();
  if (!tracking) return toast(t('track.enter_number'), 'warn');
  btn.disabled = true;
  clear(result);
  result.appendChild(el('div', { class: 'card' }, [el('div', { class: 'card-body center', text: t('common.loading') })]));
  try {
    const r = await api.publicTrack(tracking);
    const d = r.data || {};
    const activity = Array.isArray(d.activity) ? d.activity : [];
    clear(result);
    result.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h3', { text: d.recipientName || t('tracking.recipient') }),
        el('span', { class: 'mono', text: tracking }),
        r.mock ? el('span', { class: 'badge mock', text: t('common.mock_mode') }) : null,
      ]),
      el('div', { class: 'card-body' }, [
        stepper(activity),
        el('dl', { class: 'kv mt-2' }, [
          el('dt', { text: t('orders.tracking') }), el('dd', { class: 'mono', text: tracking }),
          el('dt', { text: t('tracking.recipient') }), el('dd', { text: d.recipientName || '—' }),
          el('dt', { text: t('tracking.shipped_by') }), el('dd', { text: d.shippedBy || '—' }),
          el('dt', { text: t('tracking.current_station') }), el('dd', { text: d.currentStation || '—' }),
          d.status ? el('dt') : null,
          d.status ? el('dd', {}, [el('span', { class: 'badge done', text: statusLabel(d.status) })]) : null,
        ]),
        el('div', { class: 'sep' }),
        el('h3', { text: t('tracking.history') }),
        timeline(activity.map((a) => ({
          activity: a.status, status: '', station: a.station || a.scanLocation || '',
          event_date: a.date, event_time: a.time,
        })), { empty: t('common.no_data') }),
      ]),
    ]));
  } catch (err) {
    clear(result);
    result.appendChild(el('div', { class: 'alert alert-danger', text: err.message || t('track.not_found') }));
  } finally {
    btn.disabled = false;
  }
}

btn.addEventListener('click', search);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

// دعم ?tracking=XXX في الرابط
const params = new URLSearchParams(location.search);
if (params.get('tracking')) {
  input.value = params.get('tracking');
  search();
}
