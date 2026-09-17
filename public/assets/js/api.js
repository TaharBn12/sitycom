// ═══════════════════════════════════════════════════════════
//  طبقة الاتصال بالخادم
// ═══════════════════════════════════════════════════════════
// أساس الخادم: يقرأ من config.js (window.API_BASE) — يُستخدم عند
// استضافة الواجهة على نطاق مختلف عن الخادم (مثل GitHub Pages)
const API_BASE = (typeof window !== 'undefined' && window.API_BASE)
  ? String(window.API_BASE).replace(/\/+$/, '')
  : '';
const url = (p) => (API_BASE ? API_BASE + (p.startsWith('/') ? '' : '/') + p : p);

const TOKEN_KEY = 'sitycom.token';
const USER_KEY = 'sitycom.user';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
};
export const getUser = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
};
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

// يضيف التوكن إلى مسار الاستعلام (قناة احتياطية)
function withToken(path) {
  const token = getToken();
  return token ? path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token) : path;
}

async function request(method, path, body, options = {}) {
  const headers = { Accept: 'application/json' };
  const token = getToken();
  // تُرسل الجلسة عبر عدة قنوات معًا — بعض الوكلاء (مثل بروكسي المعاينة)
  // يستبعدون ترويسة Authorization، فيعتمد الخادم على X-Session-Token أو رابط الاستعلام
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['X-Session-Token'] = token;
  }
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(url(withToken(path)), {
    method,
    headers,
    body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body)),
    ...options,
  });

  if (res.status === 401) {
    if (!path.includes('api/auth/login')) {
      clearSession();
      if (!location.pathname.endsWith('login.html')) location.href = 'login.html';
    }
  }

  const type = res.headers.get('content-type') || '';
  if (type.includes('application/pdf') || type.includes('application/octet-stream')) {
    return { ok: res.ok, blob: await res.blob() };
  }

  // قراءة الجسم مرة واحدة فقط — تجنّب "body stream already read"
  // عند استجابة غير JSON (صفحة خطأ HTML مثلًا من GitHub Pages)
  const raw = await res.text();
  let data = null;
  try {
    data = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') {
    const isJson = type.includes('application/json');
    data = { ok: false, error: isJson ? (raw.trim() || `HTTP ${res.status}`) : `تعذر الاتصال بالخادم (HTTP ${res.status})` };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.payload = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body ?? {}, options),
  put: (path, body, options) => request('PUT', path, body ?? {}, options),
  del: (path, body, options) => request('DELETE', path, body, options),

  // المصادقة
  login: (username, password) => request('POST', 'api/auth/login', { username, password }),
  logout: () => request('POST', 'api/auth/logout', {}).catch(() => null),
  me: () => request('GET', 'api/auth/me'),

  // لوحة المعلومات والتقارير
  dashboard: (days) => api.get(`api/dashboard?days=${days || 30}`),
  reports: (from, to) => api.get(`api/dashboard/reports?from=${from}&to=${to}`),

  // الطلبيات
  orders: (params = {}) => api.get('api/orders?' + new URLSearchParams(params)),
  order: (id) => api.get(`api/orders/${id}`),
  createOrder: (payload) => api.post('api/orders', payload),
  updateOrder: (id, payload) => api.put(`api/orders/${id}`, payload),
  deleteOrder: (id) => api.del(`api/orders/${id}`),
  pushOrder: (id, validate) => api.post(`api/orders/${id}/push`, { validate: validate ? 1 : 0 }),
  bulkPush: (ids, validate) => api.post('api/orders/bulk-push', { ids, validate: validate ? 1 : 0 }),
  validateOrder: (id, ask) => api.post(`api/orders/${id}/validate`, { ask_collection: ask ? 1 : 0 }),
  updateAtEcotrack: (id, fields, fromLocal) => api.post(`api/orders/${id}/update-ecotrack`, { fields, sync_from_local: fromLocal ? 1 : 0 }),
  deleteAtEcotrack: (id) => api.del(`api/orders/${id}/ecotrack`),
  syncOrder: (id) => api.post(`api/orders/${id}/sync`, {}),
  syncOrders: (ids, mode) => api.post('api/orders/sync-status', { ids, mode }),
  addMaj: (id, content) => api.post(`api/orders/${id}/maj`, { content }),
  getMaj: (id) => api.get(`api/orders/${id}/maj`),
  askReturn: (id) => api.post(`api/orders/${id}/ask-return`, {}),
  quote: (wilayaId, stopDesk, type) => api.post('api/orders/quote', { wilaya_id: wilayaId, stop_desk: stopDesk ? 1 : 0, type }),
  labelUrl: (id, download) => url(withToken(`api/orders/${id}/label${download ? '?download=1' : ''}`)),
  importEcotrackOrders: (pages) => api.post('api/orders/import-ecotrack', { pages }),

  // الكتالوج
  products: (params = {}) => api.get('api/catalog/products?' + new URLSearchParams(params)),
  product: (id) => api.get(`api/catalog/products/${id}`),
  saveProduct: (payload, id) => (id ? api.put(`api/catalog/products/${id}`, payload) : api.post('api/catalog/products', payload)),
  deleteProduct: (id) => api.del(`api/catalog/products/${id}`),
  setStock: (id, stock) => api.patch(`api/catalog/products/${id}/stock`, { stock }),
  categories: () => api.get('api/catalog/categories'),
  saveCategory: (payload, id) => (id ? api.put(`api/catalog/categories/${id}`, payload) : api.post('api/catalog/categories', payload)),
  deleteCategory: (id) => api.del(`api/catalog/categories/${id}`),
  importEcotrackProducts: (items) => api.post('api/catalog/products/import-ecotrack', { items }),

  // العملاء
  customers: (params = {}) => api.get('api/customers?' + new URLSearchParams(params)),
  searchCustomers: (q) => api.get(`api/customers/search?q=${encodeURIComponent(q)}`),
  saveCustomer: (payload, id) => (id ? api.put(`api/customers/${id}`, payload) : api.post('api/customers', payload)),
  deleteCustomer: (id) => api.del(`api/customers/${id}`),

  // Ecotrack
  ecoStatus: () => api.get('api/ecotrack/status'),
  ecoTest: (payload) => api.post('api/ecotrack/test', payload || {}),
  ecoRateLimit: () => api.get('api/ecotrack/rate-limit'),
  ecoWilayas: () => api.get('api/ecotrack/wilayas'),
  ecoCommunes: (wilayaId) => api.get(`api/ecotrack/communes?wilaya_id=${wilayaId || ''}`),
  ecoDesks: () => api.get('api/ecotrack/desks'),
  ecoFees: () => api.get('api/ecotrack/fees'),
  ecoProducts: (page) => api.get(`api/ecotrack/products?page=${page || 1}`),
  ecoOrders: (params = {}) => api.get('api/ecotrack/orders?' + new URLSearchParams(params)),
  ecoOrdersStatus: (trackings, status) => api.get(`api/ecotrack/orders-status?trackings=${encodeURIComponent(trackings)}&status=${status || 'all'}`),
  ecoTracking: (tracking) => api.get(`api/ecotrack/tracking/${encodeURIComponent(tracking)}`),
  ecoTrackings: (trackings) => api.post('api/ecotrack/trackings', { trackings }),
  ecoLabel: (tracking, download) => `api/ecotrack/label/${encodeURIComponent(tracking)}${download ? '?download=1' : ''}`,
  ecoCreateOrder: (params) => api.post('api/ecotrack/create-order', params),
  ecoCreateOrders: (orders) => api.post('api/ecotrack/create-orders', { orders }),
  ecoUpdateOrder: (params) => api.post('api/ecotrack/update-order', params),
  ecoDeleteOrder: (tracking) => api.del(`api/ecotrack/order?tracking=${encodeURIComponent(tracking)}`),
  ecoValidOrder: (tracking, ask) => api.post('api/ecotrack/valid-order', { tracking, ask_collection: ask ? 1 : 0 }),
  ecoValidReturns: (trackings) => api.post('api/ecotrack/valid-returns', { trackings }),
  ecoAddMaj: (tracking, content) => api.post('api/ecotrack/maj', { tracking, content }),
  ecoGetMaj: (tracking) => api.get(`api/ecotrack/maj/${encodeURIComponent(tracking)}`),
  ecoAskReturn: (tracking) => api.post('api/ecotrack/ask-return', { tracking }),
  syncWilayas: () => api.post('api/ecotrack/sync/wilayas', {}),
  syncCommunes: (wilayaId) => api.post('api/ecotrack/sync/communes', wilayaId ? { wilaya_id: wilayaId } : {}),
  syncDesks: () => api.post('api/ecotrack/sync/desks', {}),
  syncFees: () => api.post('api/ecotrack/sync/fees', {}),
  syncProducts: (pages) => api.post('api/ecotrack/sync/products', { pages: pages || 3 }),
  syncAll: (opts) => api.post('api/ecotrack/sync/all', opts || {}),
  syncHistory: () => api.get('api/ecotrack/sync-history'),

  // الجغرافيا المحلية
  geoBootstrap: () => api.get('api/geo/bootstrap'),
  geoWilayas: () => api.get('api/geo/wilayas'),
  geoCommunes: (wilayaId) => api.get(`api/geo/communes${wilayaId ? `?wilaya_id=${wilayaId}` : ''}`),
  geoDesks: (wilayaId) => api.get(`api/geo/desks${wilayaId ? `?wilaya_id=${wilayaId}` : ''}`),
  geoFees: (wilayaId) => api.get(`api/geo/fees${wilayaId ? `?wilaya_id=${wilayaId}` : ''}`),
  geoEcotrackProducts: () => api.get('api/geo/products'),

  // الإعدادات
  settings: () => api.get('api/settings'),
  saveSettings: (group, payload) => api.put(`api/settings/${group}`, payload),
  logs: (params = {}) => api.get('api/settings/logs?' + new URLSearchParams(params)),
  dbStats: () => api.get('api/settings/stats/db'),
  users: () => api.get('api/auth/users'),
  saveUser: (payload, id) => (id ? api.put(`api/auth/users/${id}`, payload) : api.post('api/auth/users', payload)),
  deleteUser: (id) => api.del(`api/auth/users/${id}`),
  changePassword: (current, next) => api.post('api/auth/password', { current_password: current, new_password: next }),

  // عمومي
  publicStatus: () => api.get('api/public/status'),
  publicTrack: (tracking) => api.get(`api/public/track?tracking=${encodeURIComponent(tracking)}`),
  publicTrackMany: (trackings) => api.post('api/public/track', { trackings }),
};

export function downloadBlob(url, filename) {
  const t = getToken();
  const headers = {};
  if (t) { headers.Authorization = `Bearer ${t}`; headers['X-Session-Token'] = t; }
  return fetch(url, { headers })
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
}
