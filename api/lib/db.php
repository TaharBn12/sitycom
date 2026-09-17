<?php
/**
 * طبقة قاعدة البيانات: PDO (MySQL للاستضافة · SQLite للتجربة المحلية)
 * + إنشاء المخطط تلقائياً + البذرة الأولى
 */
require_once __DIR__ . '/util.php';
require_once __DIR__ . '/geo.php';

$GLOBALS['__pdo'] = null;
$GLOBALS['__cfg'] = null;

function cfg($key = null, $default = null) {
    if ($GLOBALS['__cfg'] === null) {
        $GLOBALS['__cfg'] = require __DIR__ . '/../config.php';
    }
    if ($key === null) return $GLOBALS['__cfg'];
    $parts = explode('.', $key);
    $v = $GLOBALS['__cfg'];
    foreach ($parts as $p) {
        if (!is_array($v) || !array_key_exists($p, $v)) return $default;
        $v = $v[$p];
    }
    return $v;
}

function driver() {
    return cfg('db.driver', 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
}

function db() {
    if ($GLOBALS['__pdo'] !== null) return $GLOBALS['__pdo'];
    $c = cfg('db');
    try {
        if (driver() === 'sqlite') {
            $file = $c['file'] ?: (__DIR__ . '/../data/sitycom.db');
            $dir = dirname($file);
            if (!is_dir($dir)) @mkdir($dir, 0777, true);
            $pdo = new PDO('sqlite:' . $file);
            $pdo->exec('PRAGMA foreign_keys = ON;');
        } else {
            $dsn = "mysql:host={$c['host']};port=" . (int) ($c['port'] ?: 3306) . ";dbname={$c['name']};charset={$c['charset']}";
            $pdo = new PDO($dsn, $c['user'], $c['pass'], [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        }
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        json_out([
            'ok'    => false,
            'error' => 'تعذّر الاتصال بقاعدة البيانات: ' . $e->getMessage()
                . ' — راجع إعدادات api/config.local.php (المضيف: ' . ($c['host'] ?: 'غير محدّد') . ')',
            'code'  => 'DB_CONNECTION',
        ], 500);
    }
    $GLOBALS['__pdo'] = $pdo;
    return $pdo;
}

/** تحضير المعاملات بأنواعها الصحيحة */
function q_prepare($sql, $params = []) {
    $st = db()->prepare($sql);
    $i = 1;
    foreach ($params as $v) {
        if (is_bool($v)) $v = $v ? 1 : 0;
        if (is_array($v) || is_object($v)) $v = json_encode($v, JSON_UNESCAPED_UNICODE);
        if ($v === null) $type = PDO::PARAM_NULL;
        elseif (is_int($v)) $type = PDO::PARAM_INT;
        else $type = PDO::PARAM_STR;
        $st->bindValue($i++, $v, $type);
    }
    $st->execute();
    return $st;
}

function q_all($sql, $params = []) {
    return q_prepare($sql, $params)->fetchAll();
}
function q_one($sql, $params = []) {
    $r = q_prepare($sql, $params)->fetch();
    return $r === false ? null : $r;
}
function q_exec($sql, $params = []) {
    $st = q_prepare($sql, $params);
    return ['changes' => $st->rowCount(), 'id' => (int) db()->lastInsertId()];
}
function q_val($sql, $params = [], $default = null) {
    $r = q_one($sql, $params);
    if (!$r) return $default;
    $v = array_values($r)[0];
    return $v === null ? $default : $v;
}

function insert_ignore($table, $data) {
    $cols = array_keys($data);
    $ph   = implode(', ', array_fill(0, count($cols), '?'));
    $word = driver() === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
    $sql  = "$word INTO `$table` (`" . implode('`, `', $cols) . "`) VALUES ($ph)";
    return q_exec($sql, array_values($data));
}

function upsert($table, $data, $updateCols = null) {
    $cols = array_keys($data);
    $ph   = implode(', ', array_fill(0, count($cols), '?'));
    $updateCols = $updateCols ?: array_values(array_diff($cols, ['id']));
    $sets = [];
    $vals = array_values($data);
    if (driver() === 'mysql') {
        foreach ($updateCols as $c) $sets[] = "`$c` = VALUES(`$c`)";
        $sql = "INSERT INTO `$table` (`" . implode('`, `', $cols) . "`) VALUES ($ph)
                ON DUPLICATE KEY UPDATE " . implode(', ', $sets);
        return q_exec($sql, $vals);
    }
    foreach ($updateCols as $c) $sets[] = "`$c` = excluded.`$c`";
    $sql = "INSERT INTO `$table` (`" . implode('`, `', $cols) . "`) VALUES ($ph)
            ON CONFLICT DO UPDATE SET " . implode(', ', $sets);
    return q_exec($sql, $vals);
}

/* ══════════════════════ المخطط ══════════════════════ */
function col_sql($name, $d) {
    $driver = driver();
    $t = $d['type'];
    $sql = "`$name` ";
    switch ($t) {
        case 'pk':      $sql .= $driver === 'mysql' ? 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'; break;
        case 'int':     $sql .= 'INT'; break;
        case 'money':   $sql .= $driver === 'mysql' ? 'DOUBLE' : 'REAL'; break;
        case 'bool':    $sql .= $driver === 'mysql' ? 'TINYINT(1)' : 'INTEGER'; break;
        case 'string':  $sql .= $driver === 'mysql' ? 'VARCHAR(' . (int) ($d['len'] ?? 255) . ')' : 'TEXT'; break;
        case 'text':    $sql .= 'TEXT'; break;
        case 'datetime':$sql .= $driver === 'mysql' ? 'DATETIME' : 'TEXT'; break;
        default:        $sql .= 'TEXT';
    }
    if ($t !== 'pk') {
        $sql .= !empty($d['null']) ? ' NULL' : ' NOT NULL';
        if (array_key_exists('default', $d) && $d['default'] !== null) {
            $def = $d['default'];
            $sql .= ' DEFAULT ' . (is_string($def) ? "'" . str_replace("'", "''", $def) . "'" : $def);
        }
        if (!empty($d['unique'])) $sql .= ' UNIQUE';
    }
    return $sql;
}

function schema_tables() {
    return [
        'users' => [
            'id' => ['type' => 'pk'],
            'username' => ['type' => 'string', 'len' => 190, 'unique' => true, 'null' => false],
            'name' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'password_hash' => ['type' => 'string', 'len' => 255, 'null' => false],
            'role' => ['type' => 'string', 'len' => 20, 'default' => 'admin'],
            'active' => ['type' => 'bool', 'default' => 1],
            'last_login' => ['type' => 'datetime', 'null' => true],
            'created_at' => ['type' => 'datetime', 'null' => true],
        ],
        'sessions' => [
            'token' => ['type' => 'string', 'len' => 190, 'null' => false],
            'user_id' => ['type' => 'int', 'null' => false],
            'expires_at' => ['type' => 'datetime', 'null' => false],
            'created_at' => ['type' => 'datetime', 'null' => true],
            '__index' => [
                'mysql'  => ['ALTER TABLE `sessions` ADD PRIMARY KEY (`token`)', 'ALTER TABLE `sessions` ADD KEY `idx_sessions_user` (`user_id`)'],
                'sqlite' => ['CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)', 'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)'],
            ],
        ],
        'settings' => [
            'k' => ['type' => 'string', 'len' => 190, 'null' => false],
            'v' => ['type' => 'text', 'null' => true],
            'updated_at' => ['type' => 'datetime', 'null' => true],
            '__index' => [
                'mysql'  => ['ALTER TABLE `settings` ADD PRIMARY KEY (`k`)'],
                'sqlite' => ['CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(k)'],
            ],
        ],
        'categories' => [
            'id' => ['type' => 'pk'],
            'name_ar' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'name_fr' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'name_en' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'slug' => ['type' => 'string', 'len' => 190, 'null' => true],
            'active' => ['type' => 'bool', 'default' => 1],
            'created_at' => ['type' => 'datetime', 'null' => true],
        ],
        'products' => [
            'id' => ['type' => 'pk'],
            'sku' => ['type' => 'string', 'len' => 190, 'null' => true],
            'name_ar' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'name_fr' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'name_en' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'description' => ['type' => 'text', 'null' => true],
            'price' => ['type' => 'money', 'default' => 0],
            'cost' => ['type' => 'money', 'default' => 0],
            'stock' => ['type' => 'int', 'default' => 0],
            'category_id' => ['type' => 'int', 'null' => true],
            'image_url' => ['type' => 'string', 'len' => 500, 'default' => ''],
            'weight' => ['type' => 'money', 'default' => 0],
            'fragile' => ['type' => 'bool', 'default' => 0],
            'ecotrack_reference' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'active' => ['type' => 'bool', 'default' => 1],
            'created_at' => ['type' => 'datetime', 'null' => true],
            'updated_at' => ['type' => 'datetime', 'null' => true],
            '__index' => [
                'mysql'  => ['ALTER TABLE `products` ADD KEY `idx_products_sku` (`sku`)'],
                'sqlite' => ['CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)'],
            ],
        ],
        'customers' => [
            'id' => ['type' => 'pk'],
            'name' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'phone' => ['type' => 'string', 'len' => 40, 'default' => ''],
            'phone2' => ['type' => 'string', 'len' => 40, 'default' => ''],
            'email' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'wilaya_id' => ['type' => 'int', 'null' => true],
            'commune' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'address' => ['type' => 'text', 'null' => true],
            'notes' => ['type' => 'text', 'null' => true],
            'created_at' => ['type' => 'datetime', 'null' => true],
            '__index' => [
                'mysql'  => ['ALTER TABLE `customers` ADD UNIQUE KEY `uq_customers_phone` (`phone`)'],
                'sqlite' => ['CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_phone ON customers(phone)'],
            ],
        ],
        'orders' => [
            'id' => ['type' => 'pk'],
            'order_number' => ['type' => 'string', 'len' => 190, 'null' => false],
            'customer_id' => ['type' => 'int', 'null' => true],
            'customer_name' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'phone' => ['type' => 'string', 'len' => 40, 'default' => ''],
            'phone2' => ['type' => 'string', 'len' => 40, 'default' => ''],
            'wilaya_id' => ['type' => 'int', 'null' => true],
            'wilaya_name' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'commune' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'address' => ['type' => 'text', 'null' => true],
            'stop_desk' => ['type' => 'bool', 'default' => 0],
            'desk_code' => ['type' => 'string', 'len' => 40, 'default' => ''],
            'desk_name' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'subtotal' => ['type' => 'money', 'default' => 0],
            'shipping_fee' => ['type' => 'money', 'default' => 0],
            'discount' => ['type' => 'money', 'default' => 0],
            'total' => ['type' => 'money', 'default' => 0],
            'status' => ['type' => 'string', 'len' => 40, 'default' => 'draft'],
            'payment_status' => ['type' => 'string', 'len' => 40, 'default' => 'unpaid'],
            'source' => ['type' => 'string', 'len' => 40, 'default' => 'admin'],
            'notes' => ['type' => 'text', 'null' => true],
            'created_at' => ['type' => 'datetime', 'null' => true],
            'updated_at' => ['type' => 'datetime', 'null' => true],
            '__index' => [
                'mysql'  => ['ALTER TABLE `orders` ADD UNIQUE KEY `uq_orders_number` (`order_number`)'],
                'sqlite' => ['CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_number ON orders(order_number)'],
            ],
        ],
        'order_items' => [
            'id' => ['type' => 'pk'],
            'order_id' => ['type' => 'int', 'null' => false],
            'product_id' => ['type' => 'int', 'null' => true],
            'name' => ['type' => 'string', 'len' => 255, 'default' => ''],
            'sku' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'qty' => ['type' => 'int', 'default' => 1],
            'unit_price' => ['type' => 'money', 'default' => 0],
            'line_total' => ['type' => 'money', 'default' => 0],
            '__index' => [
                'mysql'  => ['ALTER TABLE `order_items` ADD KEY `idx_items_order` (`order_id`)'],
                'sqlite' => ['CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id)'],
            ],
        ],
        'shipments' => [
            'id' => ['type' => 'pk'],
            'order_id' => ['type' => 'int', 'null' => false],
            'tracking' => ['type' => 'string', 'len' => 190, 'null' => true],
            'reference' => ['type' => 'string', 'len' => 190, 'null' => true],
            'type' => ['type' => 'int', 'default' => 1],
            'stop_desk' => ['type' => 'bool', 'default' => 0],
            'produit' => ['type' => 'text', 'null' => true],
            'quantite' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'stock' => ['type' => 'bool', 'default' => 0],
            'produit_a_recuperer' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'boutique' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'remarque' => ['type' => 'text', 'null' => true],
            'weight' => ['type' => 'money', 'default' => 0],
            'fragile' => ['type' => 'bool', 'default' => 0],
            'gps_link' => ['type' => 'string', 'len' => 500, 'default' => ''],
            'ask_collection' => ['type' => 'bool', 'default' => 0],
            'ecotrack_status' => ['type' => 'string', 'len' => 40, 'default' => ''],
            'delivery_fee' => ['type' => 'money', 'default' => 0],
            'return_fee' => ['type' => 'money', 'default' => 0],
            'last_activity' => ['type' => 'string', 'len' => 60, 'default' => ''],
            'last_activity_at' => ['type' => 'string', 'len' => 40, 'default' => ''],
            'pushed_at' => ['type' => 'datetime', 'null' => true],
            'validated_at' => ['type' => 'datetime', 'null' => true],
            'return_asked_at' => ['type' => 'datetime', 'null' => true],
            'synced_at' => ['type' => 'datetime', 'null' => true],
            'raw' => ['type' => 'text', 'null' => true],
            '__index' => [
                'mysql'  => ['ALTER TABLE `shipments` ADD UNIQUE KEY `uq_shipments_order` (`order_id`)', 'ALTER TABLE `shipments` ADD KEY `idx_shipments_tracking` (`tracking`)'],
                'sqlite' => ['CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_order ON shipments(order_id)', 'CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking)'],
            ],
        ],
        'order_events' => [
            'id' => ['type' => 'pk'],
            'order_id' => ['type' => 'int', 'null' => true],
            'tracking' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'status' => ['type' => 'string', 'len' => 60, 'default' => ''],
            'activity' => ['type' => 'string', 'len' => 60, 'default' => ''],
            'station' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'driver' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'details' => ['type' => 'text', 'null' => true],
            'event_date' => ['type' => 'string', 'len' => 20, 'default' => ''],
            'event_time' => ['type' => 'string', 'len' => 20, 'default' => ''],
            'created_at' => ['type' => 'datetime', 'null' => true],
            '__index' => [
                'mysql'  => ['ALTER TABLE `order_events` ADD KEY `idx_events_order` (`order_id`)', 'ALTER TABLE `order_events` ADD KEY `idx_events_tracking` (`tracking`)'],
                'sqlite' => ['CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id)', 'CREATE INDEX IF NOT EXISTS idx_events_tracking ON order_events(tracking)'],
            ],
        ],
        'wilayas' => [
            'wilaya_id' => ['type' => 'int', 'null' => false],
            'name_fr' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'name_ar' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'active' => ['type' => 'bool', 'default' => 1],
            'has_stop_desk' => ['type' => 'bool', 'default' => 0],
            'synced_at' => ['type' => 'datetime', 'null' => true],
            '__index' => [
                'mysql'  => ['ALTER TABLE `wilayas` ADD PRIMARY KEY (`wilaya_id`)'],
                'sqlite' => ['CREATE UNIQUE INDEX IF NOT EXISTS idx_wilayas_id ON wilayas(wilaya_id)'],
            ],
        ],
        'communes' => [
            'id' => ['type' => 'pk'],
            'wilaya_id' => ['type' => 'int', 'null' => false],
            'name' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'code_postal' => ['type' => 'string', 'len' => 20, 'default' => ''],
            'has_stop_desk' => ['type' => 'bool', 'default' => 0],
            '__index' => [
                'mysql'  => ['ALTER TABLE `communes` ADD KEY `idx_communes_wilaya` (`wilaya_id`)', 'ALTER TABLE `communes` ADD UNIQUE KEY `uq_communes` (`wilaya_id`, `name`)'],
                'sqlite' => ['CREATE INDEX IF NOT EXISTS idx_communes_wilaya ON communes(wilaya_id)', 'CREATE UNIQUE INDEX IF NOT EXISTS uq_communes ON communes(wilaya_id, name)'],
            ],
        ],
        'desks' => [
            'id' => ['type' => 'pk'],
            'hub_id' => ['type' => 'string', 'len' => 40, 'default' => ''],
            'name' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'wilaya' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'commune' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'address' => ['type' => 'text', 'null' => true],
            'phone' => ['type' => 'string', 'len' => 60, 'default' => ''],
            'phone2' => ['type' => 'string', 'len' => 60, 'default' => ''],
            'email' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'map' => ['type' => 'string', 'len' => 500, 'default' => ''],
            'hours' => ['type' => 'text', 'null' => true],
            'is_my_desk' => ['type' => 'bool', 'default' => 0],
        ],
        'shipping_fees' => [
            'wilaya_id' => ['type' => 'int', 'null' => false],
            'wilaya_name' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'delivery_home' => ['type' => 'money', 'default' => 0],
            'delivery_stopdesk' => ['type' => 'money', 'default' => 0],
            'pickup_home' => ['type' => 'money', 'default' => 0],
            'pickup_stopdesk' => ['type' => 'money', 'default' => 0],
            'exchange_home' => ['type' => 'money', 'default' => 0],
            'exchange_stopdesk' => ['type' => 'money', 'default' => 0],
            'collection_home' => ['type' => 'money', 'default' => 0],
            'collection_stopdesk' => ['type' => 'money', 'default' => 0],
            'return_home' => ['type' => 'money', 'default' => 0],
            'return_stopdesk' => ['type' => 'money', 'default' => 0],
            'raw' => ['type' => 'text', 'null' => true],
            'synced_at' => ['type' => 'datetime', 'null' => true],
            '__index' => [
                'mysql'  => ['ALTER TABLE `shipping_fees` ADD PRIMARY KEY (`wilaya_id`)'],
                'sqlite' => ['CREATE UNIQUE INDEX IF NOT EXISTS idx_fees_wilaya ON shipping_fees(wilaya_id)'],
            ],
        ],
        'ecotrack_products' => [
            'reference' => ['type' => 'string', 'len' => 190, 'null' => false],
            'barcode' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'title' => ['type' => 'string', 'len' => 255, 'default' => ''],
            'is_active' => ['type' => 'bool', 'default' => 1],
            'image' => ['type' => 'string', 'len' => 500, 'default' => ''],
            'stock_disponible' => ['type' => 'int', 'default' => 0],
            'stock_reserve' => ['type' => 'int', 'default' => 0],
            'stock_phisique' => ['type' => 'int', 'default' => 0],
            'synced_at' => ['type' => 'datetime', 'null' => true],
            '__index' => [
                'mysql'  => ['ALTER TABLE `ecotrack_products` ADD PRIMARY KEY (`reference`)'],
                'sqlite' => ['CREATE UNIQUE INDEX IF NOT EXISTS idx_eco_products_ref ON ecotrack_products(reference)'],
            ],
        ],
        'activity_log' => [
            'id' => ['type' => 'pk'],
            'user_id' => ['type' => 'int', 'null' => true],
            'username' => ['type' => 'string', 'len' => 190, 'default' => ''],
            'action' => ['type' => 'string', 'len' => 100, 'default' => ''],
            'entity' => ['type' => 'string', 'len' => 60, 'default' => ''],
            'entity_id' => ['type' => 'string', 'len' => 60, 'default' => ''],
            'details' => ['type' => 'text', 'null' => true],
            'ok' => ['type' => 'bool', 'default' => 1],
            'created_at' => ['type' => 'datetime', 'null' => true],
            '__index' => [
                'mysql'  => ['ALTER TABLE `activity_log` ADD KEY `idx_log_created` (`created_at`)'],
                'sqlite' => ['CREATE INDEX IF NOT EXISTS idx_log_created ON activity_log(created_at)'],
            ],
        ],
        'sync_jobs' => [
            'id' => ['type' => 'pk'],
            'kind' => ['type' => 'string', 'len' => 60, 'default' => ''],
            'status' => ['type' => 'string', 'len' => 30, 'default' => ''],
            'message' => ['type' => 'text', 'null' => true],
            'count' => ['type' => 'int', 'default' => 0],
            'started_at' => ['type' => 'datetime', 'null' => true],
            'finished_at' => ['type' => 'datetime', 'null' => true],
        ],
    ];
}

/** تعريف SQL لجدول واحد */
function create_table_sql($table, $defs = null) {
    $drv = driver();
    $defs = $defs ?: schema_tables()[$table];
    $cols = [];
    $indexes = null;
    foreach ($defs as $name => $d) {
        if ($name === '__index') { $indexes = $d; continue; }
        $cols[] = col_sql($name, $d);
    }
    $sql = "CREATE TABLE IF NOT EXISTS `$table` (\n  " . implode(",\n  ", $cols) . "\n)";
    if ($drv === 'mysql') $sql .= ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    return [$sql, $indexes];
}

/** كل عبارات SQL المطلوبة (تُستخدم لتوليد database/mysql.sql) */
function schema_sql() {
    $drv = driver();
    $out = ["-- Sitycom — مخطط قاعدة البيانات (" . strtoupper($drv) . ")",
            "-- يُنشئه التطبيق تلقائياً أيضاً عند أول طلب", ''];
    foreach (schema_tables() as $table => $defs) {
        list($sql, $indexes) = create_table_sql($table, $defs);
        $out[] = $sql . ';';
        if ($indexes && !empty($indexes[$drv])) {
            foreach ($indexes[$drv] as $idx) $out[] = $idx . ';';
        }
        $out[] = '';
    }
    return implode("\n", $out);
}

function install_schema($force = false) {
    $drv = driver();
    $installed = [];
    foreach (schema_tables() as $table => $defs) {
        list($sql, $indexes) = create_table_sql($table, $defs);
        db()->exec($sql);
        $installed[] = $table;
        if ($indexes && !empty($indexes[$drv])) {
            foreach ($indexes[$drv] as $idxSql) {
                try { db()->exec($idxSql); } catch (Exception $e) { /* موجود مسبقاً */ }
            }
        }
    }
    return $installed;
}

function table_exists($table) {
    try {
        if (driver() === 'mysql') {
            $r = q_one("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1", [$table]);
        } else {
            $r = q_one("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1", [$table]);
        }
        return (bool) $r;
    } catch (Exception $e) {
        return false;
    }
}

/** يُنشئ المخطط عند أول استخدام */
function ensure_schema() {
    if (!table_exists('settings')) {
        install_schema();
        seed_if_empty();
    }
}

/* ══════════════════════ الإعدادات والسجل ══════════════════════ */
function setting($key, $default = null) {
    $row = q_one("SELECT `v` FROM settings WHERE `k` = ?", [$key]);
    if (!$row) return null === $default ? null : $default;
    $v = json_decode($row['v'], true);
    return $v === null ? $row['v'] : $v;
}

function set_setting($key, $value) {
    $payload = is_string($value) ? $value : json_encode($value, JSON_UNESCAPED_UNICODE);
    upsert('settings', ['k' => $key, 'v' => $payload, 'updated_at' => now()], ['v', 'updated_at']);
}

function all_settings() {
    $out = [];
    foreach (q_all("SELECT `k`, `v` FROM settings") as $row) {
        $v = json_decode($row['v'], true);
        $out[$row['k']] = $v === null ? $row['v'] : $v;
    }
    return $out;
}

function log_activity($userId, $username, $action, $entity = '', $entityId = '', $details = '', $ok = 1) {
    try {
        q_exec(
            "INSERT INTO activity_log (user_id, username, action, entity, entity_id, details, ok, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [$userId, (string) $username, $action, $entity, (string) $entityId,
             is_string($details) ? $details : json_encode($details, JSON_UNESCAPED_UNICODE), $ok ? 1 : 0, now()]
        );
    } catch (Exception $e) { /* لا نُفشل الطلب بسبب السجل */ }
}

/* ══════════════════════ البذرة الأولى ══════════════════════ */
function seed_if_empty() {
    $count = (int) q_val("SELECT COUNT(*) AS c FROM users", [], 0);
    if ($count > 0) return false;
    $stamp = now();

    // المستخدم الإداري
    q_exec(
        "INSERT INTO users (username, name, password_hash, role, active, created_at) VALUES (?, ?, ?, 'admin', 1, ?)",
        [cfg('admin.username'), cfg('admin.name'), password_hash(cfg('admin.password'), PASSWORD_BCRYPT), $stamp]
    );

    // الإعدادات
    $defaults = [
        'store' => [
            'name_ar' => 'سيتي كوم', 'name_fr' => 'Sitycom', 'name_en' => 'Sitycom',
            'phone' => '0550 00 00 00', 'email' => 'contact@sitycom.dz',
            'address' => 'الجزائر', 'currency' => 'DZD',
        ],
        'ecotrack' => [
            'base_url' => cfg('ecotrack.base_url') ?: '',
            'api_token' => cfg('ecotrack.api_token') ?: '',
            'auth_mode' => cfg('ecotrack.auth_mode') ?: 'both',
            'mock' => cfg('ecotrack.mock'),
            'timeout' => (int) (cfg('ecotrack.timeout') ?: 20000),
            'default_type' => 1, 'default_origin_wilaya' => 16,
            'auto_validate' => 0, 'ask_collection' => 1,
            'default_boutique' => '', 'auto_sync_status' => 0,
        ],
        'orders' => ['prefix' => 'CMD', 'default_shipping_fee' => 0, 'low_stock_alert' => 5],
    ];
    foreach ($defaults as $k => $v) set_setting($k, $v);

    // الولايات والبلديات
    foreach (geo_wilayas() as $w) {
        insert_ignore('wilayas', [
            'wilaya_id' => (int) $w['wilaya_id'], 'name_fr' => $w['name_fr'],
            'name_ar' => $w['name_ar'], 'active' => 1, 'has_stop_desk' => 0, 'synced_at' => null,
        ]);
    }
    foreach (geo_communes() as $wid => $names) {
        foreach ($names as $name) {
            insert_ignore('communes', ['wilaya_id' => (int) $wid, 'name' => $name, 'code_postal' => '', 'has_stop_desk' => 0]);
        }
    }

    // أسعار تجريبية
    foreach (geo_mock_fees() as $f) {
        insert_ignore('shipping_fees', [
            'wilaya_id' => (int) $f['wilaya_id'], 'wilaya_name' => $f['wilaya_name'],
            'delivery_home' => (float) $f['livraison']['tarif'], 'delivery_stopdesk' => (float) $f['livraison']['tarif_stopdesk'],
            'pickup_home' => (float) $f['pickup']['tarif'], 'pickup_stopdesk' => (float) $f['pickup']['tarif_stopdesk'],
            'exchange_home' => (float) $f['echange']['tarif'], 'exchange_stopdesk' => (float) $f['echange']['tarif_stopdesk'],
            'collection_home' => (float) $f['recouvrement']['tarif'], 'collection_stopdesk' => (float) $f['recouvrement']['tarif_stopdesk'],
            'return_home' => (float) $f['retour']['tarif'], 'return_stopdesk' => (float) $f['retour']['tarif_stopdesk'],
            'raw' => json_encode($f, JSON_UNESCAPED_UNICODE), 'synced_at' => $stamp,
        ]);
    }

    // التصنيفات
    $cats = [
        ['إلكترونيات', 'Électronique', 'Electronics'],
        ['أزياء', 'Mode', 'Fashion'],
        ['منزل ومطبخ', 'Maison & Cuisine', 'Home & Kitchen'],
        ['تجميل وعناية', 'Beauté & Soin', 'Beauty & Care'],
        ['رياضة', 'Sport', 'Sports'],
    ];
    foreach ($cats as $c) {
        q_exec("INSERT INTO categories (name_ar, name_fr, name_en, slug, active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
            [$c[0], $c[1], $c[2], slugify($c[1]), $stamp]);
    }

    // المنتجات
    $products = [
        ['SKU-001', 'سماعات بلوتوث لاسلكية', 'Écouteurs Bluetooth', 'Wireless Earbuds', 1, 4500, 2800, 40, 0.3, 0],
        ['SKU-002', 'ساعة ذكية رياضية', 'Montre connectée sport', 'Smart Sport Watch', 1, 8900, 5600, 25, 0.2, 0],
        ['SKU-003', 'شاحن سريع 65W', 'Chargeur rapide 65W', '65W Fast Charger', 1, 3200, 1900, 60, 0.25, 0],
        ['SKU-004', 'حقيبة ظهر مقاومة للماء', 'Sac à dos étanche', 'Waterproof Backpack', 2, 5400, 3100, 18, 0.7, 0],
        ['SKU-005', 'قميص قطني رجالي', 'T-shirt coton homme', "Men's Cotton T-Shirt", 2, 2200, 1100, 80, 0.25, 0],
        ['SKU-006', 'حذاء رياضي خفيف', 'Chaussures de sport', 'Running Shoes', 2, 11500, 7200, 12, 0.9, 0],
        ['SKU-007', 'طقم أواني طبخ 12 قطعة', 'Set de cuisine 12 pièces', '12-Pc Cookware Set', 3, 14500, 9800, 9, 4.5, 1],
        ['SKU-008', 'مقلاة غير لاصقة 28سم', 'Poêle antiadhésive 28cm', 'Non-stick Pan 28cm', 3, 3900, 2200, 22, 1.2, 1],
        ['SKU-009', 'كريم مرطب بالأرغان', 'Crème hydratante Argan', 'Argan Moisturizer', 4, 2600, 1400, 50, 0.2, 0],
        ['SKU-010', 'شامبو بالزيوت الطبيعية', 'Shampoing aux huiles', 'Natural Oil Shampoo', 4, 1900, 950, 3, 0.35, 0],
        ['SKU-011', 'سجادة رياضية', 'Tapis de sport', 'Yoga Mat', 5, 4100, 2400, 15, 1.5, 0],
        ['SKU-012', 'دمبلز حديد 10كغ', 'Haltères 10 kg', '10kg Dumbbell Set', 5, 9800, 6300, 2, 10, 1],
    ];
    foreach ($products as $p) {
        q_exec(
            "INSERT INTO products (sku, name_ar, name_fr, name_en, description, price, cost, stock, category_id,
                image_url, weight, fragile, ecotrack_reference, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, '', ?, ?, ?, 1, ?, ?)",
            [$p[0], $p[1], $p[2], $p[3], $p[5], $p[6], $p[7], $p[4], $p[8], $p[9], $p[0], $stamp, $stamp]
        );
    }

    // العملاء والطلبيات التجريبية
    $demoCustomers = [
        ['أحمد بن علي', '0550123456', '0661234567', 16, 'Bab Ezzouar', '17 Rue des Frères Bouadou'],
        ['سارة مزياني', '0661987654', '', 31, 'Es Senia', 'Cité 200 logements Bt 12'],
        ['يوسف قاسمي', '0770334455', '', 25, 'El Khroub', 'Rue 1er Novembre'],
        ['نورة بوعزيز', '0551789654', '0661002233', 6, 'Akbou', 'Cité Sidi Ali'],
        ['محمد طويل', '0699887766', '', 30, 'Rouissat', 'Hay Nasr Bt 04'],
        ['ليلى حداد', '0554231567', '', 35, 'Thenia', 'Rue de la Gare'],
    ];
    foreach ($demoCustomers as $c) {
        insert_ignore('customers', [
            'name' => $c[0], 'phone' => $c[1], 'phone2' => $c[2], 'email' => '',
            'wilaya_id' => (int) $c[3], 'commune' => $c[4], 'address' => $c[5], 'notes' => '', 'created_at' => $stamp,
        ]);
    }

    $pool = [
        ['سماعات بلوتوث لاسلكية', 4500], ['ساعة ذكية رياضية', 8900], ['حقيبة ظهر مقاومة للماء', 5400],
        ['قميص قطني رجالي', 2200], ['مقلاة غير لاصقة 28سم', 3900], ['سجادة رياضية', 4100],
    ];
    $statuses = ['draft', 'prete_a_expedier', 'en_livraison', 'livre_non_encaisse', 'en_hub', 'retour_en_traitement', 'suspendu', 'en_preparation'];

    foreach ($statuses as $n => $status) {
        $n = $n + 1;
        $c = $demoCustomers[$n % count($demoCustomers)];
        $wilayaId = (int) $c[3];
        $wilaya = q_one("SELECT name_fr FROM wilayas WHERE wilaya_id = ?", [$wilayaId]);
        $a = $pool[$n % count($pool)];
        $b = $pool[($n * 3) % count($pool)];
        $items = $a[0] === $b[0] ? [['name' => $b[0], 'price' => $b[1], 'qty' => 2]] : [['name' => $a[0], 'price' => $a[1], 'qty' => 1], ['name' => $b[0], 'price' => $b[1], 'qty' => 2]];
        $subtotal = 0;
        foreach ($items as $it) $subtotal += $it['price'] * $it['qty'];
        $shipping = 600 + (($n * 137) % 500);
        $total = $subtotal + $shipping;
        $orderNumber = 'CMD-20260' . (($n % 9) + 1) . '1' . str_pad((string) $n, 2, '0', STR_PAD_LEFT);
        $created = date('Y-m-d H:i:s', time() - ($n * 86400));

        $res = q_exec(
            "INSERT INTO orders (order_number, customer_id, customer_name, phone, phone2, wilaya_id, wilaya_name,
                commune, address, stop_desk, subtotal, shipping_fee, discount, total, status, payment_status,
                source, notes, created_at, updated_at)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, 'admin', '', ?, ?)",
            [$orderNumber, $c[0], $c[1], $c[2], $wilayaId, $wilaya ? $wilaya['name_fr'] : '', $c[4], $c[5],
             $subtotal, $shipping, $total, $status, $status === 'livre_non_encaisse' ? 'collected' : 'unpaid', $created, $created]
        );
        $orderId = $res['id'];
        foreach ($items as $it) {
            q_exec("INSERT INTO order_items (order_id, product_id, name, sku, qty, unit_price, line_total) VALUES (?, NULL, ?, 'SKU-DEMO', ?, ?, ?)",
                [$orderId, $it['name'], $it['qty'], $it['price'], $it['price'] * $it['qty']]);
        }
        if ($status !== 'draft') {
            $tracking = 'EC' . str_pad((string) (100000000000 + ($n * 7919)), 12, '0', STR_PAD_LEFT);
            $produit = implode(' / ', array_map(function ($it) { return $it['name'] . ' x' . $it['qty']; }, $items));
            q_exec(
                "INSERT INTO shipments (order_id, tracking, reference, type, stop_desk, produit, quantite, stock,
                    produit_a_recuperer, boutique, remarque, weight, fragile, gps_link, ask_collection,
                    ecotrack_status, delivery_fee, pushed_at)
                 VALUES (?, ?, ?, 1, 0, ?, '', 0, '', '', '', 1, 0, '', 0, ?, ?, ?)",
                [$orderId, $tracking, $orderNumber, $produit, $status, $shipping, $created]
            );
            q_exec(
                "INSERT INTO order_events (order_id, tracking, status, activity, station, driver, details, event_date, event_time, created_at)
                 VALUES (?, ?, ?, 'order_information_received_by_carrier', '', '', '', ?, '', ?)",
                [$orderId, $tracking, $status, substr($created, 0, 10), $created]
            );
        }
    }

    log_activity(null, 'system', 'seed', 'database', '', 'تهيئة قاعدة البيانات والبيانات التجريبية', 1);
    return true;
}
