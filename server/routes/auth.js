import express from 'express';
import { get, run, all } from '../db.js';
import { asyncRoute, HttpError, verifyPassword, hashPassword, now } from '../lib/util.js';
import { createSession, destroySession, requireAuth } from '../lib/auth.js';
import { logActivity } from '../db.js';

const router = express.Router();

router.post('/login', asyncRoute(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw new HttpError(400, 'اسم المستخدم وكلمة المرور مطلوبان');

  const user = get('SELECT * FROM users WHERE username = ? AND active = 1', [String(username).trim()]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    logActivity(null, String(username), 'login.failed', 'auth', '', 'محاولة دخول فاشلة', 0);
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }

  const session = createSession(user.id);
  run('UPDATE users SET last_login = ? WHERE id = ?', [now(), user.id]);
  logActivity(user.id, user.username, 'login', 'auth', user.id, '', 1);

  res.json({
    ok: true,
    token: session.token,
    expires_at: session.expires_at,
    user: { id: user.id, username: user.username, name: user.name, role: user.role },
  });
}));

router.post('/logout', asyncRoute(async (req, res) => {
  if (req.token) {
    const u = req.user;
    destroySession(req.token);
    if (u) logActivity(u.id, u.username, 'logout', 'auth', u.id, '', 1);
  }
  res.json({ ok: true });
}));

router.get('/me', asyncRoute(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'غير مسجّل');
  const user = get('SELECT id, username, name, role, last_login FROM users WHERE id = ?', [req.user.id]);
  res.json({ ok: true, user });
}));

router.post('/password', requireAuth, asyncRoute(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!verifyPassword(current_password || '', user.password_hash)) {
    throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
  }
  if (!new_password || String(new_password).length < 6) {
    throw new HttpError(400, 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
  }
  run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(new_password), req.user.id]);
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [req.user.id, req.token]);
  logActivity(req.user.id, req.user.username, 'password.change', 'user', req.user.id, '', 1);
  res.json({ ok: true });
}));

// ── المستخدمون (مدير فقط) ────────────────────────────────────
router.get('/users', requireAuth, asyncRoute(async (_req, res) => {
  res.json({
    ok: true,
    users: all('SELECT id, username, name, role, active, last_login, created_at FROM users ORDER BY id'),
  });
}));

router.post('/users', requireAuth, asyncRoute(async (req, res) => {
  const { username, name, password, role } = req.body || {};
  if (!username || !password) throw new HttpError(400, 'اسم المستخدم وكلمة المرور مطلوبان');
  const exists = get('SELECT id FROM users WHERE username = ?', [String(username).trim()]);
  if (exists) throw new HttpError(409, 'اسم المستخدم مستعمل بالفعل');
  const info = run(
    `INSERT INTO users (username, name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
    [String(username).trim(), name || username, hashPassword(password), role || 'staff', now()],
  );
  logActivity(req.user.id, req.user.username, 'user.create', 'user', info.lastInsertRowid, username, 1);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
}));

router.put('/users/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { name, role, active, password } = req.body || {};
  const fields = [];
  const params = [];
  if (name !== undefined) { fields.push('name = ?'); params.push(name); }
  if (role !== undefined) { fields.push('role = ?'); params.push(role); }
  if (active !== undefined) { fields.push('active = ?'); params.push(active ? 1 : 0); }
  if (password) { fields.push('password_hash = ?'); params.push(hashPassword(password)); }
  if (!fields.length) throw new HttpError(400, 'لا توجد بيانات للتعديل');
  params.push(id);
  run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
  logActivity(req.user.id, req.user.username, 'user.update', 'user', id, '', 1);
  res.json({ ok: true });
}));

router.delete('/users/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'لا يمكنك حذف حسابك الحالي');
  run('DELETE FROM sessions WHERE user_id = ?', [id]);
  run('DELETE FROM users WHERE id = ?', [id]);
  logActivity(req.user.id, req.user.username, 'user.delete', 'user', id, '', 1);
  res.json({ ok: true });
}));

export default router;
