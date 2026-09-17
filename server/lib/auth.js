import { get, run, all } from '../db.js';
import { uid, now, HttpError } from './util.js';

const SESSION_DAYS = 7;

export function createSession(userId) {
  const token = uid('sess_');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  run('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [token, userId, expires, now()]);
  return { token, expires_at: expires };
}

export function destroySession(token) {
  run('DELETE FROM sessions WHERE token = ?', [token]);
}

export function userFromToken(token) {
  if (!token) return null;
  const row = get(
    `SELECT u.id, u.username, u.name, u.role, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND u.active = 1`,
    [token],
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run('DELETE FROM sessions WHERE token = ?', [token]);
    return null;
  }
  return { id: row.id, username: row.username, name: row.name, role: row.role };
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return req.headers['x-session-token'] || req.query?.token || null;
}

export function attachUser(req, _res, next) {
  const token = readToken(req);
  req.token = token;
  req.user = userFromToken(token);
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'انتهت الجلسة — سجّل الدخول من جديد'));
  next();
}

/** تنظيف الجلسات المنتهية */
export function purgeSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
}

export function listSessions() {
  return all('SELECT token, user_id, expires_at FROM sessions');
}
