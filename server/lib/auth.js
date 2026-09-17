import { supabase, must } from '../db.js';
import { uid, now, HttpError } from './util.js';

const SESSION_DAYS = 7;

export async function createSession(userId) {
  const token = uid('sess_');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  must(
    await supabase.from('sessions').insert({ token, user_id: userId, expires_at: expires, created_at: now() }),
    'session.create',
  );
  return { token, expires_at: expires };
}

export async function destroySession(token) {
  must(await supabase.from('sessions').delete().eq('token', token), 'session.delete');
}

export async function userFromToken(token) {
  if (!token) return null;
  const row = must(
    await supabase
      .from('sessions')
      .select('expires_at, users:user_id(id, username, name, role, active)')
      .eq('token', token)
      .maybeSingle(),
    'session.lookup',
  );
  if (!row || !row.users || Number(row.users.active) !== 1) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  return { id: row.users.id, username: row.users.username, name: row.users.name, role: row.users.role };
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return req.headers['x-session-token'] || req.query?.token || null;
}

export function attachUser(req, _res, next) {
  const token = readToken(req);
  req.token = token;
  userFromToken(token)
    .then((user) => { req.user = user; next(); })
    .catch((err) => { console.error('[auth]', err.message); req.user = null; next(); });
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'انتهت الجلسة — سجّل الدخول من جديد'));
  next();
}

/** تنظيف الجلسات المنتهية */
export async function purgeSessions() {
  must(
    await supabase.from('sessions').delete().lt('expires_at', new Date().toISOString()),
    'sessions.purge',
  );
}

export async function listSessions() {
  return must(await supabase.from('sessions').select('token, user_id, expires_at'), 'sessions.list');
}
