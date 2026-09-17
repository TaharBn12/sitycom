// ════════════════════════════════════════════════════════════════════
//  ECOTRACK API v1 — عميل كامل
//  التوثيق: https://documenter.getpostman.com/view/14517169/Tz5je15g
//
//  1  GET    /api/v1/validate/token          التحقق من التوكن
//  2  GET    /api/v1/                        حد الطلبات (Rate limit)
//  3  POST   /api/v1/create/order            إنشاء طلبية
//  4  POST   /api/v1/create/orders           إنشاء حتى 100 طلبية
//  5  POST   /api/v1/update/order            تعديل طلبية
//  6  DELETE /api/v1/delete/order            حذف طلبية
//  7  POST   /api/v1/valid/order             مصادقة وشحن
//  8  POST   /api/v1/valid/returns           تأكيد استلام المرتجعات
//  9  GET    /api/v1/get/order/label         ملصق الشحن PDF
//  10 POST   /api/v1/add/maj                 إضافة ملاحظة/تحديث
//  11 GET    /api/v1/get/maj                 قائمة التحديثات
//  12 POST   /api/v1/ask/for/order/return    طلب إرجاع
//  13 GET    /api/v1/get/tracking/info       سجل طلبية واحدة
//  14 GET    /api/v1/get/trackings/info      سجل عدة طلبيات (≤100)
//  15 GET    /api/v1/get/orders              قائمة الطلبيات (40/صفحة)
//  16 GET    /api/v1/get/orders/status       فلترة حسب الحالة
//  17 GET    /api/v1/get/wilayas             الولايات النشطة
//  18 GET    /api/v1/get/desks               مكاتب Stop Desk
//  19 GET    /api/v1/get/communes            البلديات
//  20 GET    /api/v1/get/fees                أسعار التوصيل
//  21 GET    /api/v1/get/products/list       منتجات الحساب
// ════════════════════════════════════════════════════════════════════

import { getSetting } from '../db.js';
import { WILAYAS, COMMUNES, mockFees } from '../data/geo.js';
import { num, bool01 } from './util.js';

export class EcotrackError extends Error {
  constructor(message, { code = null, status = null, errors = null, payload = null } = {}) {
    super(message);
    this.name = 'EcotrackError';
    this.code = code;
    this.status = status;
    this.errors = errors;
    this.payload = payload;
  }
}

/** رموز الأخطاء التجارية المعروفة */
export const ERROR_CODES = {
  10001: 'الطلبية غير قابلة للتعديل (تمت مصادقتها/شحنها) — Commande non modifiable',
  10002: 'لا يوجد توصيل للولاية المختارة — Pas de livraison pour la wilaya sélectionnée',
  10003: 'لا يمكن طلب الإرجاع لهذه الطلبية — Le retour ne peut pas être demandé',
};

/** حالات Ecotrack الرسمية (get/orders/status) */
export const ECOTRACK_STATUSES = [
  'prete_a_expedier', 'en_ramassage', 'en_preparation_stock', 'vers_hub', 'en_hub',
  'vers_wilaya', 'en_preparation', 'en_livraison', 'suspendu', 'livre_non_encaisse',
  'encaisse_non_paye', 'paiements_prets', 'paye_et_archive', 'retour_chez_livreur',
  'retour_transit_entrepot', 'retour_en_traitement', 'retour_recu', 'retour_archive',
  'annule', 'all',
];

/** أحداث التتبع (activity) من get/tracking/info */
export const ACTIVITIES = [
  'order_information_received_by_carrier', 'notification_on_order', 'picked',
  'accepted_by_carrier', 'dispatched_to_driver', 'attempt_delivery', 'return_asked',
  'return_in_transit', 'Return_received', 'livred', 'encaissed', 'payed',
];

/** أنواع الطلبية */
export const ORDER_TYPES = [
  { id: 1, ar: 'توصيل', fr: 'Livraison', en: 'Delivery' },
  { id: 2, ar: 'تبديل (Échange)', fr: 'Échange', en: 'Exchange' },
  { id: 3, ar: 'استلام (Pickup)', fr: 'PICKUP', en: 'Pickup' },
  { id: 4, ar: 'تحصيل (Recouvrement)', fr: 'Recouvrement', en: 'Collection' },
];

// ── الإعدادات الحالية ─────────────────────────────────────────
export function getConfig() {
  const cfg = getSetting('ecotrack', {}) || {};
  const mockEnv = process.env.ECOTRACK_MOCK === '1';
  const baseUrl = String(cfg.base_url || process.env.ECOTRACK_BASE_URL || '').replace(/\/+$/, '');
  const token = String(cfg.api_token || process.env.ECOTRACK_API_TOKEN || '');
  const configured = Boolean(baseUrl && token);
  return {
    baseUrl,
    token,
    authMode: cfg.auth_mode || process.env.ECOTRACK_AUTH_MODE || 'both', // both | bearer | query
    timeout: num(cfg.timeout || process.env.ECOTRACK_TIMEOUT, 20000),
    // وضع تجريبي تلقائي إذا لم يُضبط الرابط أو التوكن
    mock: mockEnv || cfg.mock === true || !configured,
    configured,
  };
}

export function isMock() {
  return getConfig().mock;
}

// ── محوّلات الأخطاء ───────────────────────────────────────────
function flattenErrorBag(errors) {
  if (!errors || typeof errors !== 'object') return [];
  return Object.entries(errors).flatMap(([field, msgs]) =>
    (Array.isArray(msgs) ? msgs : [String(msgs)]).map((m) => `${field}: ${m}`));
}

function parseFailure(status, data, text) {
  if (status === 429) {
    return new EcotrackError('تم تجاوز حد الطلبات (50 طلب/دقيقة). أعد المحاولة بعد قليل.', {
      code: 'RATE_LIMIT', status, payload: data,
    });
  }
  if (status === 422 && data) {
    const msgs = flattenErrorBag(data.errors);
    return new EcotrackError(msgs.join(' | ') || data.message || 'بيانات غير صالحة (422)', {
      code: 'VALIDATION', status, errors: data.errors, payload: data,
    });
  }
  if (data && data.success === false) {
    return new EcotrackError(ERROR_CODES[data.error] || data.message || 'فشل الطلب', {
      code: data.error, status, payload: data,
    });
  }
  if (data && typeof data === 'object' && data.message) {
    return new EcotrackError(String(data.message), { code: status, status, payload: data });
  }
  return new EcotrackError(text || `خطأ غير متوقع (HTTP ${status})`, { code: status, status, payload: data });
}

// ── الطلب الأساسي ─────────────────────────────────────────────
async function request(method, path, { query = {}, body = null, raw = false, config } = {}) {
  const cfg = config || getConfig();
  if (cfg.mock) return mockRequest(method, path, { query, body });
  if (!cfg.baseUrl || !cfg.token) {
    throw new EcotrackError('إعدادات Ecotrack غير مكتملة: أدخل الرابط الأساسي والتوكن من شاشة «التوصيل ← الإعدادات».', {
      code: 'NOT_CONFIGURED',
    });
  }

  const url = new URL(cfg.baseUrl + path);
  const params = { ...query };

  // الاستثناءات الموثّقة: api_token يُرسل كـ query param
  const mustQuery = path === '/api/v1/validate/token' || path === '/api/v1/get/orders/status';
  if (cfg.authMode === 'query' || cfg.authMode === 'both' || mustQuery) {
    if (!params.api_token) params.api_token = cfg.token;
  }

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
    else url.searchParams.append(k, String(v));
  }

  const headers = { Accept: 'application/json' };
  if (cfg.authMode === 'bearer' || cfg.authMode === 'both') headers.Authorization = `Bearer ${cfg.token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (err) {
    clearTimeout(timer);
    const reason = err.name === 'AbortError' ? `انتهت مهلة الاتصال (${cfg.timeout}ms)` : err.message;
    throw new EcotrackError(`تعذّر الاتصال بـ Ecotrack: ${reason}`, { code: 'NETWORK' });
  }
  clearTimeout(timer);

  const text = await res.text();
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  let data = null;
  if (isJson && text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  if (raw) {
    if (res.status === 200 && /%PDF|PDF-/.test(text.slice(0, 8)) === false && isJson) {
      if (data && data.success === false) throw parseFailure(res.status, data, text);
    }
    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get('content-type') || 'application/pdf',
      buffer: Buffer.from(text || '', 'binary'),
      data,
      rate: rateHeaders(res),
    };
  }

  if (!res.ok) throw parseFailure(res.status, data, text);
  if (data && data.success === false) throw parseFailure(res.status, data, text);

  return { ok: true, status: res.status, data, rate: rateHeaders(res) };
}

function rateHeaders(res) {
  const pick = (...names) => {
    for (const n of names) {
      const v = res.headers.get(n);
      if (v !== null) return v;
    }
    return null;
  };
  const has = ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Limit-Day',
    'X-RateLimit-Remaining-Day', 'X-RateLimit-Limit-Hour', 'X-RateLimit-Remaining-Hour']
    .some((h) => res.headers.get(h) !== null);
  if (!has) return null;
  return {
    limit: pick('X-RateLimit-Limit'),
    remaining: pick('X-RateLimit-Remaining', 'X-RateLimit-Limit-Remaining'),
    limitDay: pick('X-RateLimit-Limit-Day'),
    remainingDay: pick('X-RateLimit-Remaining-Day'),
    limitHour: pick('X-RateLimit-Limit-Hour'),
    remainingHour: pick('X-RateLimit-Remaining-Hour'),
    resetDay: pick('X-RateLimit-Reset-Day'),
    resetHour: pick('X-RateLimit-Reset-Hour'),
    retryAfter: pick('Retry-After'),
  };
}

// ════════════════════════════════════════════════════════════════
//  الواجهات العامة (21 endpoint)
// ════════════════════════════════════════════════════════════════

/** 1. GET /api/v1/validate/token */
export function validateToken(config) {
  return request('GET', '/api/v1/validate/token', { config });
}

/** 2. GET /api/v1/ */
export function getRateLimit(config) {
  return request('GET', '/api/v1/', { config });
}

/** 3. POST /api/v1/create/order — كل المعاملات في الـ query string */
export function createOrder(params, config) {
  return request('POST', '/api/v1/create/order', { query: params, config });
}

/** 4. POST /api/v1/create/orders — JSON body بمفتاح orders (≤100) */
export function createOrdersBulk(orders, config) {
  const payload = { orders: {} };
  orders.forEach((o, i) => { payload.orders[String(i)] = o; });
  return request('POST', '/api/v1/create/orders', { body: payload, config });
}

/** 5. POST /api/v1/update/order */
export function updateOrder(params, config) {
  return request('POST', '/api/v1/update/order', { query: params, config });
}

/** 6. DELETE /api/v1/delete/order */
export function deleteOrder(tracking, config) {
  return request('DELETE', '/api/v1/delete/order', { query: { tracking }, config });
}

/** 7. POST /api/v1/valid/order */
export function validOrder({ tracking, ask_collection }, config) {
  return request('POST', '/api/v1/valid/order', { query: { tracking, ask_collection }, config });
}

/** 8. POST /api/v1/valid/returns — JSON body {trackings:[...]} */
export function validReturns(trackings, config) {
  return request('POST', '/api/v1/valid/returns', { body: { trackings }, config });
}

/** 9. GET /api/v1/get/order/label — يعيد PDF خام */
export function getOrderLabel(tracking, config) {
  return request('GET', '/api/v1/get/order/label', { query: { tracking }, raw: true, config });
}

/** 10. POST /api/v1/add/maj */
export function addMaj({ tracking, content }, config) {
  return request('POST', '/api/v1/add/maj', { query: { tracking, content }, config });
}

/** 11. GET /api/v1/get/maj */
export function getMaj(tracking, config) {
  return request('GET', '/api/v1/get/maj', { query: { tracking }, config });
}

/** 12. POST /api/v1/ask/for/order/return */
export function askForOrderReturn(tracking, config) {
  return request('POST', '/api/v1/ask/for/order/return', { query: { tracking }, config });
}

/** 13. GET /api/v1/get/tracking/info */
export function getTrackingInfo(tracking, config) {
  return request('GET', '/api/v1/get/tracking/info', { query: { tracking }, config });
}

/** 14. GET /api/v1/get/trackings/info (≤100) */
export function getTrackingsInfo(trackings, config) {
  return request('GET', '/api/v1/get/trackings/info', { query: { 'trackings[]': trackings }, config });
}

/** 15. GET /api/v1/get/orders */
export function getOrders({ page, start_date, end_date, tracking } = {}, config) {
  return request('GET', '/api/v1/get/orders', { query: { page, start_date, end_date, tracking }, config });
}

/** 16. GET /api/v1/get/orders/status — api_token كـ query param */
export function getOrdersStatus({ trackings, status }, config) {
  return request('GET', '/api/v1/get/orders/status', {
    query: { trackings: Array.isArray(trackings) ? trackings.join(',') : trackings, status },
    config,
  });
}

/** 17. GET /api/v1/get/wilayas */
export function getWilayas(config) {
  return request('GET', '/api/v1/get/wilayas', { config });
}

/** 18. GET /api/v1/get/desks */
export function getDesks(config) {
  return request('GET', '/api/v1/get/desks', { config });
}

/** 19. GET /api/v1/get/communes */
export function getCommunes(wilaya_id, config) {
  return request('GET', '/api/v1/get/communes', { query: { wilaya_id }, config });
}

/** 20. GET /api/v1/get/fees */
export function getFees(config) {
  return request('GET', '/api/v1/get/fees', { config });
}

/** 21. GET /api/v1/get/products/list */
export function getProducts(page = 1, config) {
  return request('GET', '/api/v1/get/products/list', { query: { page }, config });
}

// ════════════════════════════════════════════════════════════════
//  وضع البيانات التجريبية (Mock) — يعمل بدون ربط فعلي
// ════════════════════════════════════════════════════════════════
function mockTracking(seedStr = '') {
  let h = 0;
  for (const ch of String(seedStr)) h = (h * 31 + ch.charCodeAt(0)) % 1000000000000;
  return 'EC' + String(100000000000 + h).slice(0, 12);
}

function mockActivity(tracking, steps = 3) {
  const seq = ['order_information_received_by_carrier', 'picked', 'accepted_by_carrier',
    'vers_hub', 'dispatched_to_driver', 'attempt_delivery', 'livred'];
  const out = [];
  const base = Date.now() - steps * 86400000;
  for (let i = 0; i < Math.min(steps, seq.length); i += 1) {
    const d = new Date(base + i * 86400000);
    out.push({
      date: d.toISOString().slice(0, 10),
      time: d.toISOString().slice(11, 19),
      status: seq[i],
      station: i > 1 ? 'HUB Alger' : '',
      scanLocation: i > 1 ? 'HUB' : '',
    });
  }
  return { tracking, activity: out };
}

function mockRequest(method, path, { query = {}, body = null } = {}) {
  const q = query || {};
  const ok = (data) => ({ ok: true, status: 200, data, rate: mockRate(), mock: true });

  switch (path) {
    case '/api/v1/validate/token':
      return ok({ success: true, message: 'VALID_TOKEN' });

    case '/api/v1/':
      return ok({ message: 'Rate limit: 50 requests/minute, 1500/hour, 15000/day (mode démo)' });

    case '/api/v1/create/order': {
      const tracking = mockTracking(q.reference || q.nom_client || Date.now());
      return ok({ success: true, tracking });
    }

    case '/api/v1/create/orders': {
      const results = {};
      const orders = body?.orders || {};
      for (const [idx, o] of Object.entries(orders)) {
        const key = o.reference || idx;
        if (!o.telephone || String(o.telephone).length < 9) {
          results[key] = { telephone: ['Le champ téléphone est obligatoire. (démo)'] };
        } else if (Number(o.code_wilaya) === 12) {
          results[key] = { success: false, error: 10002, message: 'Pas de livraison pour la wilaya sélectionnée' };
        } else {
          results[key] = { success: true, tracking: mockTracking(o.reference || idx) };
        }
      }
      return ok({ success: true, results });
    }

    case '/api/v1/update/order':
      return ok({ success: true, message: 'Commande modifiée avec succès' });

    case '/api/v1/delete/order':
      return ok({ success: true, message: 'Commande supprimée' });

    case '/api/v1/valid/order':
      return ok({ success: true, message: 'Commande expedier avec succès' });

    case '/api/v1/valid/returns': {
      const arr = body?.trackings || [];
      return ok({ returned: arr.length ? 'success' : 'fail' });
    }

    case '/api/v1/get/order/label':
      return {
        ok: true,
        status: 200,
        contentType: 'application/pdf',
        buffer: mockPdf(q.tracking),
        data: null,
        rate: mockRate(),
        mock: true,
      };

    case '/api/v1/add/maj':
      return ok({ success: true, message: 'Mise a jour avec success' });

    case '/api/v1/get/maj':
      return ok([{
        remarque: `Sitycom (démo) : ${q.content || ''}`,
        station: '',
        livreur: '',
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        tracking: q.tracking,
      }, {
        remarque: 'تمت محاولة التوصيل — الزبون غير متواجد',
        station: 'HUB Alger',
        livreur: 'Livreur Démo',
        created_at: new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' '),
        tracking: q.tracking,
      }]);

    case '/api/v1/ask/for/order/return':
      return ok({ success: true, message: 'Retour demandé avec succès' });

    case '/api/v1/get/tracking/info': {
      const t = q.tracking || 'EC000000000000';
      const activity = mockActivity(t, 5).activity;
      return ok({
        recipientName: 'زبون تجريبي',
        shippedBy: 'Sitycom (démo)',
        originCity: 16,
        destLocationCity: 16,
        currentStation: 'Alger',
        activity,
        reasons: [],
        status: 'En livraison',
      });
    }

    case '/api/v1/get/trackings/info': {
      const list = Array.isArray(q['trackings[]']) ? q['trackings[]'] : [q['trackings[]']].filter(Boolean);
      return ok(list.map((t, i) => ({
        tracking: t,
        status: ['En livraison', 'En hub', 'Prêt à expédier', 'Livre non encaissé'][i % 4],
        activity: mockActivity(t, 3).activity,
      })));
    }

    case '/api/v1/get/orders': {
      const statuses = ['prete_a_expedier', 'en_livraison', 'en_hub', 'livre_non_encaisse', 'retour_en_traitement'];
      const rows = Array.from({ length: 12 }).map((_, i) => {
        const w = WILAYAS[(i * 7) % WILAYAS.length];
        return {
          tracking: mockTracking('demo' + i),
          reference: `CMD-2026-${1000 + i}`,
          client: ['أحمد بن علي', 'سارة مزياني', 'يوسف قاسمي', 'نورة بوعزيز'][i % 4],
          phone: '05501234' + (10 + i),
          phone_2: null,
          adresse: '17 Rue de la Liberté',
          commune: (COMMUNES[w[0]] || ['Centre'])[0],
          wilaya_id: w[0],
          montant: String(3000 + i * 750),
          tarif_prestation: String(600 + (i % 5) * 100),
          tarif_retour: String(300),
          type_id: 1,
          created_at: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
          payment_id: 300 + i,
          return_id: null,
          status: statuses[i % statuses.length],
          products: 'منتج تجريبي x1',
        };
      });
      return ok({
        current_page: Number(q.page || 1),
        data: rows,
        per_page: 40,
        total: 120,
        last_page: 10,
      });
    }

    case '/api/v1/get/orders/status': {
      const list = String(q.trackings || '').split(',').filter(Boolean);
      const data = {};
      for (const t of list) {
        data[t] = {
          tracking: t,
          status: ['en_livraison', 'en_hub', 'prete_a_expedier'][list.indexOf(t) % 3],
          activity: mockActivity(t, 2).activity,
        };
      }
      return ok({ success: true, data });
    }

    case '/api/v1/get/wilayas':
      return ok(WILAYAS.map(([wilaya_id, wilaya_name]) => ({ wilaya_id, wilaya_name })));

    case '/api/v1/get/desks':
      return ok({
        my_desk: {
          hub_id: 16,
          hub_name: 'Station Alger Centre',
          location: {
            wilaya: 'Alger', commune: 'Alger Centre', adresse: '05 Rue Didouche Mourad',
            phone: '0550 00 00 00', phone2: null, email: 'alger@exemple.dz',
            map: 'https://maps.google.com/?q=Alger+Centre',
          },
          working_hours: [{ days: 'Dimanche - Jeudi', hours: '09:00 - 17:00' }],
        },
        other_desks: WILAYAS.slice(0, 20).map(([id, fr]) => ({
          name: `Station ${fr}`,
          phone: '0550 11 22 33',
          phone2: null,
          code_wilaya: String(id),
          wilaya: fr,
          commune: (COMMUNES[id] || [fr])[0],
          adresse: `Centre ville, ${fr}`,
          map: null,
        })),
      });

    case '/api/v1/get/communes': {
      const wid = Number(q.wilaya_id || 0);
      if (wid && COMMUNES[wid]) {
        const obj = {};
        COMMUNES[wid].forEach((nom, i) => {
          obj[String(i)] = { nom, wilaya_id: wid, code_postal: String(1000 + wid * 10 + i), has_stop_desk: i % 6 === 0 ? 1 : 0 };
        });
        return ok(obj);
      }
      const obj = {};
      let i = 0;
      for (const [wid2, names] of Object.entries(COMMUNES)) {
        for (const nom of names) {
          obj[String(i)] = { nom, wilaya_id: Number(wid2), code_postal: String(1000 + Number(wid2) * 10 + i), has_stop_desk: i % 7 === 0 ? 1 : 0 };
          i += 1;
        }
      }
      return ok(obj);
    }

    case '/api/v1/get/fees':
      return ok(mockFees().map((f) => ({
        wilaya_id: f.wilaya_id,
        wilaya_name: f.wilaya_name,
        livraison: { tarif: f.livraison.tarif, tarif_stopdesk: f.livraison.tarif_stopdesk },
        pickup: { tarif: f.pickup.tarif, tarif_stopdesk: f.pickup.tarif_stopdesk },
        echange: { tarif: f.echange.tarif, tarif_stopdesk: f.echange.tarif_stopdesk },
        recouvrement: { tarif: f.recouvrement.tarif, tarif_stopdesk: f.recouvrement.tarif_stopdesk },
        retour: { tarif: f.retour.tarif, tarif_stopdesk: f.retour.tarif_stopdesk },
      })));

    case '/api/v1/get/products/list':
      return ok({
        products: Array.from({ length: 8 }).map((_, i) => ({
          reference: `SKU-00${i + 1}`,
          barcode: `61300000000${i}`,
          title: `منتج تجريبي ${i + 1}`,
          is_active: 1,
          image: '',
          stock_disponible: 20 - i,
          stock_reserve: i,
          stock_phisique: 20,
        })),
        pagination: { current_page: Number(q.page || 1), per_page: 15, total: 8, last_page: 1 },
      });

    default:
      return ok({ success: true, message: `وضع تجريبي: ${method} ${path}` });
  }
}

function mockRate() {
  return { limit: '50', remaining: String(49 - (Date.now() % 20)), limitDay: '15000', remainingDay: '14870', limitHour: '1500', remainingHour: '1470' };
}

/** ملف PDF بسيط صالح (يُستخدم كملصق تجريبي) */
function mockPdf(tracking) {
  const label = `SITYCOM - ETIQUETTE DEMO\nTracking: ${tracking}\nDestinataire: Client demo\nWilaya: Alger\nMontant: 0 DA\n`;
  const esc = label.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = `BT /F1 14 Tf 60 760 Td (${esc.split('\n').join(') Tj T* (')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// ── أدوات مساعدة مستخدمة في المسارات ──────────────────────────
/** يحوّل رد get/fees إلى صفوف مسطّحة */
export function normalizeFees(feesResponse) {
  const list = Array.isArray(feesResponse) ? feesResponse : feesResponse?.data || [];
  return list.map((f) => {
    const n = (x) => Number(String(x ?? '0').replace(/[^\d.-]/g, '')) || 0;
    return {
      wilaya_id: num(f.wilaya_id, 0),
      wilaya_name: f.wilaya_name || f.name || '',
      delivery_home: n(f.livraison?.tarif ?? f.tarif),
      delivery_stopdesk: n(f.livraison?.tarif_stopdesk ?? f.tarif_stopdesk),
      pickup_home: n(f.pickup?.tarif),
      pickup_stopdesk: n(f.pickup?.tarif_stopdesk),
      exchange_home: n(f.echange?.tarif),
      exchange_stopdesk: n(f.echange?.tarif_stopdesk),
      collection_home: n(f.recouvrement?.tarif),
      collection_stopdesk: n(f.recouvrement?.tarif_stopdesk),
      return_home: n(f.retour?.tarif),
      return_stopdesk: n(f.retour?.tarif_stopdesk),
      raw: f,
    };
  });
}

/** يحوّل رد get/communes (كائن مرقّم) إلى مصفوفة */
export function normalizeCommunes(response) {
  if (Array.isArray(response)) {
    return response.map((c) => ({
      wilaya_id: num(c.wilaya_id, 0),
      name: c.nom || c.name || '',
      code_postal: String(c.code_postal ?? ''),
      has_stop_desk: bool01(c.has_stop_desk),
    }));
  }
  const obj = response?.data && !Array.isArray(response.data) ? response.data : response;
  return Object.values(obj || {}).map((c) => ({
    wilaya_id: num(c.wilaya_id, 0),
    name: c.nom || c.name || '',
    code_postal: String(c.code_postal ?? ''),
    has_stop_desk: bool01(c.has_stop_desk),
  })).filter((c) => c.name);
}

/** يحوّل رد get/wilayas */
export function normalizeWilayas(response) {
  const list = Array.isArray(response) ? response : response?.data || [];
  return list.map((w) => ({
    wilaya_id: num(w.wilaya_id ?? w.id, 0),
    name: w.wilaya_name || w.name || '',
  })).filter((w) => w.wilaya_id);
}

export { mockTracking };
