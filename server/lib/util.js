import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** node:sqlite يقبل فقط null | number | bigint | string | Uint8Array */
export function sqlValues(params) {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'number' || typeof p === 'string' || typeof p === 'bigint') return p;
    if (p instanceof Uint8Array) return p;
    if (typeof p === 'object') return JSON.stringify(p);
    return String(p);
  });
}

export function uid(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

export function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const int = (v, d = 0) => Math.trunc(num(v, d));

export const bool01 = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

export function safeJson(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

export function pagination(query, defaultLimit = 50, maxLimit = 500) {
  const page = Math.max(1, int(query.page, 1));
  const limit = Math.min(maxLimit, Math.max(1, int(query.limit, defaultLimit)));
  return { page, limit, offset: (page - 1) * limit };
}

export function orderNumber() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `CMD-${ymd}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

/** يطبيع نص البحث: إزالة التشكيل والمسافات الزائدة */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0621-\u064a]+/g, ' ')
    .trim();
}

export function money(v) {
  const n = num(v, 0);
  return new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 0 }).format(n);
}
