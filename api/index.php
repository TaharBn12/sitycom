<?php
/**
 * ═══════════════════════════════════════════════════════════
 *  نقطة دخول API — Sitycom (PHP)
 *  كل المسارات: /api/…
 * ═══════════════════════════════════════════════════════════
 */
require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/ecotrack.php';
require_once __DIR__ . '/routes/helpers.php';
require_once __DIR__ . '/routes/auth.php';
require_once __DIR__ . '/routes/orders.php';
require_once __DIR__ . '/routes/catalog.php';
require_once __DIR__ . '/routes/eco.php';
require_once __DIR__ . '/routes/misc.php';

// ── CORS (مفيد إن فتحت الواجهة من نطاق آخر) ──────────────────
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
header('Access-Control-Allow-Origin: ' . $origin);
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Session-Token');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Credentials: true');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── استخراج المسار ──────────────────────────────────────────
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$script = $_SERVER['SCRIPT_NAME'] ?? '';   // /api/index.php
$path = $uri;
if ($script !== '' && strpos($path, $script) === 0) $path = substr($path, strlen($script));
$path = trim($path, '/');
if ($path === '' && !empty($_GET['p'])) $path = trim((string) $_GET['p'], '/');
if (strpos($path, 'index.php') === 0) $path = ltrim(substr($path, 9), '/');
// إزالة أي بادئة قبل مجلد api (للعمل داخل مجلد فرعي مثل /sitycom/api/...)
$apiPos = stripos($path, 'api/');
if ($apiPos !== false) $path = substr($path, $apiPos + 4);

$segments = $path === '' ? [''] : array_values(array_filter(explode('/', $path), function ($v) {
    return $v !== '';
}));
if (!$segments) $segments = [''];

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ── تجهيز القاعدة (تنشئ المخطط والبذرة عند أول استخدام) ──────
try {
    ensure_schema();
    if (mt_rand(1, 100) === 1) {
        q_exec("DELETE FROM sessions WHERE expires_at < ?", [now()]);
    }
} catch (Exception $e) {
    json_out(['ok' => false, 'error' => 'خطأ في قاعدة البيانات: ' . $e->getMessage(), 'code' => 'DB'], 500);
}

$payload = body();

// ── التوجيه ─────────────────────────────────────────────────
try {
    $group = $segments[0] ?? '';
    switch ($group) {
        case '':
        case 'health':
            json_ok([
                'time' => date('c'),
                'backend' => 'php',
                'db' => driver(),
                'mock' => eco_is_mock(),
                'endpoints' => '/api/{auth,orders,catalog,ecotrack,geo,dashboard,customers,settings,public}',
            ]);
            break;
        case 'auth':      rt_auth($method, $segments, $payload); break;
        case 'orders':    rt_orders($method, $segments, $payload); break;
        case 'catalog':   rt_catalog($method, $segments, $payload); break;
        case 'ecotrack':  rt_ecotrack($method, $segments, $payload); break;
        case 'geo':       rt_geo($method, $segments, $payload); break;
        case 'dashboard': rt_dashboard($method, $segments, $payload); break;
        case 'reports':   rt_dashboard($method, ['dashboard', 'reports'], $payload); break;
        case 'customers': rt_customers($method, $segments, $payload); break;
        case 'settings':  rt_settings($method, $segments, $payload); break;
        case 'public':    rt_public($method, $segments, $payload); break;
        default:
            throw new HttpError(404, 'المسار غير موجود: /' . implode('/', $segments), 'NOT_FOUND');
    }
} catch (HttpError $e) {
    json_out(['ok' => false, 'error' => $e->getMessage(), 'code' => $e->errCode, 'details' => $e->details], $e->status);
} catch (EcotrackError $e) {
    json_out(['ok' => false, 'error' => $e->getMessage(), 'code' => $e->ecode, 'details' => $e->errors], 422);
} catch (Throwable $e) {
    if (($cfg = cfg('debug', false)) || getenv('SITYCOM_DEBUG')) {
        json_out(['ok' => false, 'error' => $e->getMessage(), 'trace' => $e->getTraceAsString()], 500);
    }
    json_out(['ok' => false, 'error' => 'خطأ غير متوقع في الخادم: ' . $e->getMessage()], 500);
}
