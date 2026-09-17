<?php
/**
 * ═══════════════════════════════════════════════════════════
 *  صفحة التثبيت/الفحص — api/setup.php?key=sitycom
 *  تختبر اتصال قاعدة البيانات، تنشئ الجداول، وتضع البيانات الأولى
 * ═══════════════════════════════════════════════════════════
 */
require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/ecotrack.php';

header('Content-Type: text/html; charset=utf-8');

$key = $_GET['key'] ?? '';
if ($key !== cfg('setup_key', 'sitycom')) {
    http_response_code(403);
    echo '<meta charset="utf-8"><div style="font-family:sans-serif;text-align:center;margin-top:60px">';
    echo '<h2>403 — غير مصرّح</h2><p>استخدم الرابط: <code>api/setup.php?key=' . htmlspecialchars((string) cfg('setup_key', 'sitycom')) . '</code></p></div>';
    exit;
}

$steps = [];
$error = null;

try {
    $steps[] = ['الاتصال بقاعدة البيانات (' . driver() . ')', true, htmlspecialchars((string) cfg('db.host'))];
    install_schema();
    $steps[] = ['إنشاء/تحديث الجداول (' . count(schema_tables()) . ' جدول)', true, ''];
    $seeded = seed_if_empty();
    $steps[] = ['البيانات التجريبية', true, $seeded ? 'تم إدراج البيانات الأولى' : 'موجودة مسبقاً — لم يُعد الإدراج'];

    if (!empty($_GET['reset']) && $_GET['reset'] === '1') {
        foreach (['order_events', 'shipments', 'order_items', 'orders', 'activity_log', 'sync_jobs',
                  'customers', 'products', 'categories', 'communes', 'desks', 'shipping_fees',
                  'ecotrack_products', 'sessions', 'users', 'settings'] as $t) {
            try { q_exec("DELETE FROM `$t`", []); } catch (Exception $e) { /* */ }
        }
        seed_if_empty();
        $steps[] = ['إعادة التهيئة (reset=1)', true, 'تم حذف البيانات وإعادة إدراجها'];
    }
} catch (Throwable $e) {
    $error = $e->getMessage();
}

$counts = [];
if (!$error) {
    foreach (['users', 'products', 'categories', 'orders', 'customers', 'wilayas', 'communes', 'shipping_fees'] as $t) {
        try { $counts[$t] = (int) q_val("SELECT COUNT(*) AS c FROM `$t`", [], 0); } catch (Exception $e) { $counts[$t] = '—'; }
    }
}

$eco = eco_config();
$adminUser = cfg('admin.username');
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sitycom — التثبيت</title>
  <style>
    body { font-family: "Segoe UI", Tahoma, sans-serif; background: #f4f6fb; margin: 0; color: #0f172a; }
    .wrap { max-width: 760px; margin: 40px auto; background: #fff; border-radius: 14px; padding: 28px; box-shadow: 0 4px 20px rgba(15,23,42,.08); }
    h1 { margin: 0 0 6px; font-size: 22px; }
    .muted { color: #64748b; font-size: 13px; }
    ul { list-style: none; padding: 0; }
    li { padding: 10px 0; border-bottom: 1px solid #eef2f7; display: flex; gap: 10px; align-items: center; }
    .ok { color: #16a34a; font-weight: 700; }
    .bad { color: #dc2626; font-weight: 700; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 5px; font-size: 12.5px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 16px; }
    .stat { background: #f8fafc; border: 1px solid #e4e8f0; border-radius: 10px; padding: 10px; text-align: center; }
    .stat b { display: block; font-size: 20px; }
    .btn { display: inline-block; background: #2563eb; color: #fff; padding: 10px 16px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px; }
    .alert { background: #fdeaea; border: 1px solid #fecaca; color: #991b1b; padding: 12px 16px; border-radius: 8px; margin: 12px 0; }
  </style>
</head>
<body>
<div class="wrap">
  <h1>تهيئة Sitycom</h1>
  <p class="muted">هذه الصفحة تُنشئ جداول قاعدة البيانات وتتحقق من الإعدادات.</p>

  <?php if ($error): ?>
    <div class="alert"><b>خطأ:</b> <?= htmlspecialchars($error) ?><br />
      راجع بيانات القاعدة في <code>api/config.local.php</code></div>
  <?php endif; ?>

  <ul>
    <?php foreach ($steps as $s): ?>
      <li><span class="ok">✔</span> <b><?= htmlspecialchars($s[0]) ?></b> <span class="muted"><?= htmlspecialchars($s[2]) ?></span></li>
    <?php endforeach; ?>
  </ul>

  <?php if (!$error): ?>
    <div class="grid">
      <?php foreach ($counts as $k => $v): ?>
        <div class="stat"><b><?= htmlspecialchars((string) $v) ?></b><span class="muted"><?= htmlspecialchars($k) ?></span></div>
      <?php endforeach; ?>
    </div>

    <h3 style="margin-top:22px">بيانات الاتصال (كما يقرأها التطبيق)</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13.5px">
      <tr><th style="text-align:right;padding:6px;border-bottom:1px solid #eef2f7">العنصر</th><th style="text-align:right;padding:6px;border-bottom:1px solid #eef2f7">القيمة</th></tr>
      <tr><td style="padding:6px;border-bottom:1px solid #f5f7fa">نوع القاعدة</td><td style="padding:6px;border-bottom:1px solid #f5f7fa"><code><?= htmlspecialchars(driver()) ?></code></td></tr>
      <tr><td style="padding:6px;border-bottom:1px solid #f5f7fa">المضيف (Host)</td><td style="padding:6px;border-bottom:1px solid #f5f7fa"><code><?= htmlspecialchars((string) cfg('db.host')) ?></code></td></tr>
      <tr><td style="padding:6px;border-bottom:1px solid #f5f7fa">اسم القاعدة</td><td style="padding:6px;border-bottom:1px solid #f5f7fa"><code><?= htmlspecialchars((string) cfg('db.name') ?: '⚠️ فارغ') ?></code></td></tr>
      <tr><td style="padding:6px;border-bottom:1px solid #f5f7fa">المستخدم</td><td style="padding:6px;border-bottom:1px solid #f5f7fa"><code><?= htmlspecialchars((string) cfg('db.user') ?: '⚠️ فارغ') ?></code></td></tr>
      <tr><td style="padding:6px;border-bottom:1px solid #f5f7fa">كلمة المرور</td><td style="padding:6px;border-bottom:1px solid #f5f7fa"><code><?= cfg('db.pass') === '' ? '⚠️ فارغة' : '••••••••' ?></code></td></tr>
      <tr><td style="padding:6px;border-bottom:1px solid #f5f7fa">إصدار PHP</td><td style="padding:6px;border-bottom:1px solid #f5f7fa"><code><?= htmlspecialchars(PHP_VERSION) ?></code></td></tr>
      <tr><td style="padding:6px;border-bottom:1px solid #f5f7fa">الامتدادات</td><td style="padding:6px">pdo_mysql: <?= extension_loaded('pdo_mysql') ? '<span class="ok">مفعّل</span>' : '<span class="bad">غير مفعّل</span>' ?>
        · cURL: <?= extension_loaded('curl') ? '<span class="ok">مفعّل</span>' : '<span class="bad">غير مفعّل</span>' ?>
        · json: <?= extension_loaded('json') ? '<span class="ok">مفعّل</span>' : '<span class="bad">غير مفعّل</span>' ?></td></tr>
    </table>
    <p class="muted">عدّل هذه القيم في <code>api/config.local.php</code></p>

    <h3 style="margin-top:22px">حالة Ecotrack</h3>
    <ul>
      <li>الرابط الأساسي: <code><?= htmlspecialchars($eco['base_url'] ?: 'غير مضبوط') ?></code></li>
      <li>التوكن: <code><?= htmlspecialchars(mask_token($eco['token'])) ?></code></li>
      <li>الوضع: <?= !empty($eco['mock']) ? '<span class="bad">تجريبي (Mock)</span>' : '<span class="ok">متصل</span>' ?></li>
    </ul>

    <p class="muted">بيانات الدخول: <code><?= htmlspecialchars((string) $adminUser) ?></code> / <code><?= htmlspecialchars((string) cfg('admin.password')) ?></code></p>
    <a class="btn" href="../index.html">فتح لوحة التحكم</a>
    <p class="muted" style="margin-top:12px">لإعادة التهيئة من الصفر: <code>api/setup.php?key=<?= htmlspecialchars((string) cfg('setup_key', 'sitycom')) ?>&amp;reset=1</code></p>
  <?php endif; ?>
</div>
</body>
</html>
