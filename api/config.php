<?php
/**
 * ═══════════════════════════════════════════════════════════
 *  إعدادات Sitycom — نسخة PHP (للاستضافة المشتركة مثل InfinityFree)
 *
 *  الطريقة الموصى بها: أنشئ ملف api/config.local.php (غير مرفوع إلى Git)
 *  يحتوي على بيانات قاعدة البيانات والتوكن. مثال في config.local.example.php
 * ═══════════════════════════════════════════════════════════
 */

$config = [

    // ── قاعدة البيانات ─────────────────────────────────────
    'db' => [
        // mysql للاستضافة (InfinityFree) · sqlite للتجربة المحلية بدون MySQL
        'driver' => 'mysql',
        'host'   => 'sql110.infinityfree.com',
        'port'   => 3306,
        'name'   => 'if0_40731199_sitycom',            // مثال: epiz_12345678_sitycom
        'user'   => 'if0_40731199',            // مثال: epiz_12345678
        'pass'   => 'fSxlNjgoak',
        'charset' => 'utf8mb4',
        'file'   => __DIR__ . '/../data/sitycom.db', // عند driver = sqlite
    ],

    // ── الحساب الإداري الأول ───────────────────────────────
    'admin' => [
        'username' => 'admin',
        'password' => 'admin123',
        'name'     => 'المدير',
    ],

    // ── Ecotrack ───────────────────────────────────────────
    'ecotrack' => [
        'base_url'  => ''https://platform.dhd-dz.com/,         // مثال: https://votre-societe.ecotrack.dz
        'api_token' => 'OijXEUsjLZOUwXVbgXpbAC5Jz5R8enxAg47r478vfGU78hEbZUV1ock8gv2u',         // التوكن من حساب Ecotrack
        'auth_mode' => 'both',     // both | bearer | query
        'timeout'   => 20000,      // ملي ثانية
        'mock'      => null,       // null = تلقائي (mock إذا لم يُضبط الرابط أو التوكن)
    ],

    // مفتاح حماية صفحة التثبيت api/setup.php
    'setup_key' => 'sitycom',

    // اسم العملة
    'currency' => 'DZD',
];

// ── تجاوز عبر ملف محلي (غير مرفوع إلى Git) ─────────────────
$localFile = __DIR__ . '/config.local.php';
if (file_exists($localFile)) {
    $local = require $localFile;
    if (is_array($local)) {
        $config = array_replace_recursive($config, $local);
    }
}

// ── تجاوز عبر متغيرات البيئة (إن توفّرت) ────────────────────
if (getenv('DB_HOST'))    $config['db']['host'] = getenv('DB_HOST');
if (getenv('DB_NAME'))    $config['db']['name'] = getenv('DB_NAME');
if (getenv('DB_USER'))    $config['db']['user'] = getenv('DB_USER');
if (getenv('DB_PASS'))    $config['db']['pass'] = getenv('DB_PASS');
if (getenv('DB_DRIVER'))  $config['db']['driver'] = getenv('DB_DRIVER');
if (getenv('ECOTRACK_BASE_URL'))  $config['ecotrack']['base_url']  = getenv('ECOTRACK_BASE_URL');
if (getenv('ECOTRACK_API_TOKEN')) $config['ecotrack']['api_token'] = getenv('ECOTRACK_API_TOKEN');

return $config;
