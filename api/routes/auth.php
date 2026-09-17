<?php
/**
 * المصادقة والمستخدمون
 * POST /auth/login · /auth/logout · /auth/password · GET /auth/me · /auth/users
 */

function rt_auth($method, $seg, $body) {
    $action = $seg[1] ?? '';

    if ($action === 'login' && $method === 'POST') {
        $username = trim((string) bparam('username', ''));
        $password = (string) bparam('password', '');
        if ($username === '' || $password === '') throw new HttpError(400, 'اسم المستخدم وكلمة المرور مطلوبان');
        $user = q_one("SELECT * FROM users WHERE username = ? AND active = 1", [$username]);
        if (!$user || !password_verify($password, $user['password_hash'])) {
            log_activity(null, $username, 'login.failed', 'auth', '', 'محاولة دخول فاشلة', 0);
            throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
        }
        $token = uid('sess_');
        $expires = date('Y-m-d H:i:s', time() + (7 * 86400));
        q_exec("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            [$token, $user['id'], $expires, now()]);
        q_exec("UPDATE users SET last_login = ? WHERE id = ?", [now(), $user['id']]);
        log_activity($user['id'], $user['username'], 'login', 'auth', $user['id'], '', 1);
        json_ok([
            'token' => $token,
            'expires_at' => $expires,
            'user' => ['id' => (int) $user['id'], 'username' => $user['username'], 'name' => $user['name'], 'role' => $user['role']],
        ]);
    }

    if ($action === 'logout' && $method === 'POST') {
        $u = current_user();
        $t = bearer_token();
        if ($t) q_exec("DELETE FROM sessions WHERE token = ?", [$t]);
        log_activity($u['id'] ?? null, $u['username'] ?? '', 'logout', 'auth', $u['id'] ?? '', '', 1);
        json_ok();
    }

    if ($action === 'me' && $method === 'GET') {
        $u = require_auth();
        $row = q_one("SELECT id, username, name, role, last_login FROM users WHERE id = ?", [$u['id']]);
        json_ok(['user' => $row]);
    }

    if ($action === 'password' && $method === 'POST') {
        $u = require_auth();
        $user = q_one("SELECT * FROM users WHERE id = ?", [$u['id']]);
        $current = (string) bparam('current_password', '');
        $new = (string) bparam('new_password', '');
        if (!password_verify($current, $user['password_hash'])) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
        if (strlen($new) < 6) throw new HttpError(400, 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
        q_exec("UPDATE users SET password_hash = ? WHERE id = ?", [password_hash($new, PASSWORD_BCRYPT), $u['id']]);
        log_activity($u['id'], $u['username'], 'password.change', 'user', $u['id'], '', 1);
        json_ok();
    }

    if ($action === 'users') {
        $u = require_auth();
        if ($method === 'GET') {
            json_ok(['users' => q_all("SELECT id, username, name, role, active, last_login, created_at FROM users ORDER BY id")]);
        }
        if ($method === 'POST') {
            $username = trim((string) bparam('username', ''));
            $password = (string) bparam('password', '');
            if ($username === '' || $password === '') throw new HttpError(400, 'اسم المستخدم وكلمة المرور مطلوبان');
            if (q_one("SELECT id FROM users WHERE username = ?", [$username])) throw new HttpError(409, 'اسم المستخدم مستعمل بالفعل');
            $r = q_exec("INSERT INTO users (username, name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
                [$username, bparam('name', $username) ?: $username, password_hash($password, PASSWORD_BCRYPT), bparam('role', 'staff') ?: 'staff', now()]);
            log_activity($u['id'], $u['username'], 'user.create', 'user', $r['id'], $username, 1);
            json_ok(['id' => $r['id']]);
        }
        $id = (int) ($seg[2] ?? 0);
        if ($id > 0 && $method === 'PUT') {
            $sets = [];
            $vals = [];
            if (has($body, 'name'))     { $sets[] = 'name = ?';     $vals[] = $body['name']; }
            if (has($body, 'role'))     { $sets[] = 'role = ?';     $vals[] = $body['role']; }
            if (has($body, 'active'))   { $sets[] = 'active = ?';   $vals[] = bool01($body['active']); }
            if (!empty($body['password'])) { $sets[] = 'password_hash = ?'; $vals[] = password_hash($body['password'], PASSWORD_BCRYPT); }
            if (!$sets) throw new HttpError(400, 'لا توجد بيانات للتعديل');
            $vals[] = $id;
            q_exec("UPDATE users SET " . implode(', ', $sets) . " WHERE id = ?", $vals);
            log_activity($u['id'], $u['username'], 'user.update', 'user', $id, '', 1);
            json_ok();
        }
        if ($id > 0 && $method === 'DELETE') {
            if ($id === (int) $u['id']) throw new HttpError(400, 'لا يمكنك حذف حسابك الحالي');
            q_exec("DELETE FROM sessions WHERE user_id = ?", [$id]);
            q_exec("DELETE FROM users WHERE id = ?", [$id]);
            log_activity($u['id'], $u['username'], 'user.delete', 'user', $id, '', 1);
            json_ok();
        }
    }

    throw new HttpError(404, 'المسار غير موجود', 'NOT_FOUND');
}
