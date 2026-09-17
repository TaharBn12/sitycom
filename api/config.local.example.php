<?php
/**
 * مثال لملف الإعدادات المحلي — انسخه باسم config.local.php وعدّله.
 * ملف config.local.php غير مرفوع إلى Git (راجع .gitignore).
 */
return [
    'db' => [
        'driver' => 'mysql',
        'host'   => 'sql110.infinityfree.com',
        'name'   => 'epiz_XXXXXXXX_sitycom',   // اسم القاعدة من لوحة تحكم InfinityFree
        'user'   => 'epiz_XXXXXXXX',           // مستخدم القاعدة
        'pass'   => 'كلمة_مرور_القاعدة',
    ],
    'admin' => [
        'username' => 'admin',
        'password' => 'admin123',
    ],
    'ecotrack' => [
        'base_url'  => '',        // مثال: https://votre-societe.ecotrack.dz
        'api_token' => '',        // التوكن من حساب Ecotrack
    ],
    'setup_key' => 'sitycom',
];
