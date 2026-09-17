import express from 'express';
import { supabase, must, logActivity } from '../db.js';
import { asyncRoute, HttpError, verifyPassword, hashPassword, now } from '../lib/util.js';
import { createSession, destroySession, requireAuth } from '../lib/auth.js';

const router = express.Router();

router.post('/login', asyncRoute(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw new HttpError(400, 'اسم المستخدم وكلمة المرور مطلوبان');

  const user = must(
    await supabase.from('users').select('*')
      .eq('username', String(username).trim()).eq('active', 1).maybeSingle(),
    'login.lookup',
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    await logActivity(null, String(username), 'login.failed', 'auth', '', 'محاولة دخول فاشلة', 0);
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }

  const session = await createSession(user.id);
  must(await supabase.from('users').update({ last_login: now() }).eq('id', user.id), 'login.touch');
  await logActivity(user.id, user.username, 'login', 'auth', user.id, '', 1);

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
    await destroySession(req.token);
    if (u) await logActivity(u.id, u.username, 'logout', 'auth', u.id, '', 1);
  }
  res.json({ ok: true });
}));

router.get('/me', asyncRoute(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'غير مسجّل');
  const user = must(
    await supabase.from('users').select('id, username, name, role, last_login').eq('id', req.user.id).maybeSingle(),
    'me.lookup',
  );
  res.json({ ok: true, user });
}));

router.post('/password', requireAuth, asyncRoute(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const user = must(
    await supabase.from('users').select('*').eq('id', req.user.id).maybeSingle(),
    'password.lookup',
  );
  if (!user || !verifyPassword(current_password || '', user.password_hash)) {
    throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
  }
  if (!new_password || String(new_password).length < 6) {
    throw new HttpError(400, 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
  }
  must(
    await supabase.from('users').update({ password_hash: hashPassword(new_password) }).eq('id', req.user.id),
    'password.update',
  );
  must(
    await supabase.from('sessions').delete().eq('user_id', req.user.id).neq('token', req.token),
    'password.sessions',
  );
  await logActivity(req.user.id, req.user.username, 'password.change', 'user', req.user.id, '', 1);
  res.json({ ok: true });
}));

// ── المستخدمون (مدير فقط) ────────────────────────────────────
router.get('/users', requireAuth, asyncRoute(async (_req, res) => {
  const users = must(
    await supabase.from('users')
      .select('id, username, name, role, active, last_login, created_at')
      .order('id', { ascending: true }),
    'users.list',
  );
  res.json({ ok: true, users });
}));

router.post('/users', requireAuth, asyncRoute(async (req, res) => {
  const { username, name, password, role } = req.body || {};
  if (!username || !password) throw new HttpError(400, 'اسم المستخدم وكلمة المرور مطلوبان');
  const exists = must(
    await supabase.from('users').select('id').eq('username', String(username).trim()).maybeSingle(),
    'users.exists',
  );
  if (exists) throw new HttpError(409, 'اسم المستخدم مستعمل بالفعل');
  const row = must(
    await supabase.from('users').insert({
      username: String(username).trim(),
      name: name || username,
      password_hash: hashPassword(password),
      role: role || 'staff',
      active: 1,
      created_at: now(),
    }).select('id').single(),
    'users.create',
  );
  await logActivity(req.user.id, req.user.username, 'user.create', 'user', row.id, username, 1);
  res.json({ ok: true, id: Number(row.id) });
}));

router.put('/users/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { name, role, active, password } = req.body || {};
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (role !== undefined) patch.role = role;
  if (active !== undefined) patch.active = active ? 1 : 0;
  if (password) patch.password_hash = hashPassword(password);
  if (!Object.keys(patch).length) throw new HttpError(400, 'لا توجد بيانات للتعديل');
  must(await supabase.from('users').update(patch).eq('id', id), 'users.update');
  await logActivity(req.user.id, req.user.username, 'user.update', 'user', id, '', 1);
  res.json({ ok: true });
}));

router.delete('/users/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'لا يمكنك حذف حسابك الحالي');
  must(await supabase.from('sessions').delete().eq('user_id', id), 'users.sessions');
  must(await supabase.from('users').delete().eq('id', id), 'users.delete');
  await logActivity(req.user.id, req.user.username, 'user.delete', 'user', id, '', 1);
  res.json({ ok: true });
}));

export default router;
