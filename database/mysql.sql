-- ═══════════════════════════════════════════════════════════
--  Sitycom — مخطط قاعدة البيانات (MYSQL)
--  يُستورد عبر phpMyAdmin:  اختر القاعدة ← استيراد ← اختر هذا الملف ← تنفيذ
--  (اختياري: التطبيق ينشئ الجداول تلقائياً عند فتح api/setup.php)
-- ═══════════════════════════════════════════════════════════
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(190) NOT NULL UNIQUE,
  `name` VARCHAR(190) NOT NULL DEFAULT '',
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(20) NOT NULL DEFAULT 'admin',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_login` DATETIME NULL,
  `created_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
  `token` VARCHAR(190) NOT NULL,
  `user_id` INT NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `sessions` ADD PRIMARY KEY (`token`);
ALTER TABLE `sessions` ADD KEY `idx_sessions_user` (`user_id`);

CREATE TABLE IF NOT EXISTS `settings` (
  `k` VARCHAR(190) NOT NULL,
  `v` TEXT NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `settings` ADD PRIMARY KEY (`k`);

CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name_ar` VARCHAR(190) NOT NULL DEFAULT '',
  `name_fr` VARCHAR(190) NOT NULL DEFAULT '',
  `name_en` VARCHAR(190) NOT NULL DEFAULT '',
  `slug` VARCHAR(190) NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `products` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `sku` VARCHAR(190) NULL,
  `name_ar` VARCHAR(190) NOT NULL DEFAULT '',
  `name_fr` VARCHAR(190) NOT NULL DEFAULT '',
  `name_en` VARCHAR(190) NOT NULL DEFAULT '',
  `description` TEXT NULL,
  `price` DOUBLE NOT NULL DEFAULT 0,
  `cost` DOUBLE NOT NULL DEFAULT 0,
  `stock` INT NOT NULL DEFAULT 0,
  `category_id` INT NULL,
  `image_url` VARCHAR(500) NOT NULL DEFAULT '',
  `weight` DOUBLE NOT NULL DEFAULT 0,
  `fragile` TINYINT(1) NOT NULL DEFAULT 0,
  `ecotrack_reference` VARCHAR(190) NOT NULL DEFAULT '',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `products` ADD KEY `idx_products_sku` (`sku`);

CREATE TABLE IF NOT EXISTS `customers` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(190) NOT NULL DEFAULT '',
  `phone` VARCHAR(40) NOT NULL DEFAULT '',
  `phone2` VARCHAR(40) NOT NULL DEFAULT '',
  `email` VARCHAR(190) NOT NULL DEFAULT '',
  `wilaya_id` INT NULL,
  `commune` VARCHAR(190) NOT NULL DEFAULT '',
  `address` TEXT NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `customers` ADD UNIQUE KEY `uq_customers_phone` (`phone`);

CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `order_number` VARCHAR(190) NOT NULL,
  `customer_id` INT NULL,
  `customer_name` VARCHAR(190) NOT NULL DEFAULT '',
  `phone` VARCHAR(40) NOT NULL DEFAULT '',
  `phone2` VARCHAR(40) NOT NULL DEFAULT '',
  `wilaya_id` INT NULL,
  `wilaya_name` VARCHAR(190) NOT NULL DEFAULT '',
  `commune` VARCHAR(190) NOT NULL DEFAULT '',
  `address` TEXT NULL,
  `stop_desk` TINYINT(1) NOT NULL DEFAULT 0,
  `desk_code` VARCHAR(40) NOT NULL DEFAULT '',
  `desk_name` VARCHAR(190) NOT NULL DEFAULT '',
  `subtotal` DOUBLE NOT NULL DEFAULT 0,
  `shipping_fee` DOUBLE NOT NULL DEFAULT 0,
  `discount` DOUBLE NOT NULL DEFAULT 0,
  `total` DOUBLE NOT NULL DEFAULT 0,
  `status` VARCHAR(40) NOT NULL DEFAULT 'draft',
  `payment_status` VARCHAR(40) NOT NULL DEFAULT 'unpaid',
  `source` VARCHAR(40) NOT NULL DEFAULT 'admin',
  `notes` TEXT NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `orders` ADD UNIQUE KEY `uq_orders_number` (`order_number`);

CREATE TABLE IF NOT EXISTS `order_items` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `product_id` INT NULL,
  `name` VARCHAR(255) NOT NULL DEFAULT '',
  `sku` VARCHAR(190) NOT NULL DEFAULT '',
  `qty` INT NOT NULL DEFAULT 1,
  `unit_price` DOUBLE NOT NULL DEFAULT 0,
  `line_total` DOUBLE NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `order_items` ADD KEY `idx_items_order` (`order_id`);

CREATE TABLE IF NOT EXISTS `shipments` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `tracking` VARCHAR(190) NULL,
  `reference` VARCHAR(190) NULL,
  `type` INT NOT NULL DEFAULT 1,
  `stop_desk` TINYINT(1) NOT NULL DEFAULT 0,
  `produit` TEXT NULL,
  `quantite` VARCHAR(190) NOT NULL DEFAULT '',
  `stock` TINYINT(1) NOT NULL DEFAULT 0,
  `produit_a_recuperer` VARCHAR(190) NOT NULL DEFAULT '',
  `boutique` VARCHAR(190) NOT NULL DEFAULT '',
  `remarque` TEXT NULL,
  `weight` DOUBLE NOT NULL DEFAULT 0,
  `fragile` TINYINT(1) NOT NULL DEFAULT 0,
  `gps_link` VARCHAR(500) NOT NULL DEFAULT '',
  `ask_collection` TINYINT(1) NOT NULL DEFAULT 0,
  `ecotrack_status` VARCHAR(40) NOT NULL DEFAULT '',
  `delivery_fee` DOUBLE NOT NULL DEFAULT 0,
  `return_fee` DOUBLE NOT NULL DEFAULT 0,
  `last_activity` VARCHAR(60) NOT NULL DEFAULT '',
  `last_activity_at` VARCHAR(40) NOT NULL DEFAULT '',
  `pushed_at` DATETIME NULL,
  `validated_at` DATETIME NULL,
  `return_asked_at` DATETIME NULL,
  `synced_at` DATETIME NULL,
  `raw` TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `shipments` ADD UNIQUE KEY `uq_shipments_order` (`order_id`);
ALTER TABLE `shipments` ADD KEY `idx_shipments_tracking` (`tracking`);

CREATE TABLE IF NOT EXISTS `order_events` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NULL,
  `tracking` VARCHAR(190) NOT NULL DEFAULT '',
  `status` VARCHAR(60) NOT NULL DEFAULT '',
  `activity` VARCHAR(60) NOT NULL DEFAULT '',
  `station` VARCHAR(190) NOT NULL DEFAULT '',
  `driver` VARCHAR(190) NOT NULL DEFAULT '',
  `details` TEXT NULL,
  `event_date` VARCHAR(20) NOT NULL DEFAULT '',
  `event_time` VARCHAR(20) NOT NULL DEFAULT '',
  `created_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `order_events` ADD KEY `idx_events_order` (`order_id`);
ALTER TABLE `order_events` ADD KEY `idx_events_tracking` (`tracking`);

CREATE TABLE IF NOT EXISTS `wilayas` (
  `wilaya_id` INT NOT NULL,
  `name_fr` VARCHAR(190) NOT NULL DEFAULT '',
  `name_ar` VARCHAR(190) NOT NULL DEFAULT '',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `has_stop_desk` TINYINT(1) NOT NULL DEFAULT 0,
  `synced_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `wilayas` ADD PRIMARY KEY (`wilaya_id`);

CREATE TABLE IF NOT EXISTS `communes` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `wilaya_id` INT NOT NULL,
  `name` VARCHAR(190) NOT NULL DEFAULT '',
  `code_postal` VARCHAR(20) NOT NULL DEFAULT '',
  `has_stop_desk` TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `communes` ADD KEY `idx_communes_wilaya` (`wilaya_id`);
ALTER TABLE `communes` ADD UNIQUE KEY `uq_communes` (`wilaya_id`, `name`);

CREATE TABLE IF NOT EXISTS `desks` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `hub_id` VARCHAR(40) NOT NULL DEFAULT '',
  `name` VARCHAR(190) NOT NULL DEFAULT '',
  `wilaya` VARCHAR(190) NOT NULL DEFAULT '',
  `commune` VARCHAR(190) NOT NULL DEFAULT '',
  `address` TEXT NULL,
  `phone` VARCHAR(60) NOT NULL DEFAULT '',
  `phone2` VARCHAR(60) NOT NULL DEFAULT '',
  `email` VARCHAR(190) NOT NULL DEFAULT '',
  `map` VARCHAR(500) NOT NULL DEFAULT '',
  `hours` TEXT NULL,
  `is_my_desk` TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `shipping_fees` (
  `wilaya_id` INT NOT NULL,
  `wilaya_name` VARCHAR(190) NOT NULL DEFAULT '',
  `delivery_home` DOUBLE NOT NULL DEFAULT 0,
  `delivery_stopdesk` DOUBLE NOT NULL DEFAULT 0,
  `pickup_home` DOUBLE NOT NULL DEFAULT 0,
  `pickup_stopdesk` DOUBLE NOT NULL DEFAULT 0,
  `exchange_home` DOUBLE NOT NULL DEFAULT 0,
  `exchange_stopdesk` DOUBLE NOT NULL DEFAULT 0,
  `collection_home` DOUBLE NOT NULL DEFAULT 0,
  `collection_stopdesk` DOUBLE NOT NULL DEFAULT 0,
  `return_home` DOUBLE NOT NULL DEFAULT 0,
  `return_stopdesk` DOUBLE NOT NULL DEFAULT 0,
  `raw` TEXT NULL,
  `synced_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `shipping_fees` ADD PRIMARY KEY (`wilaya_id`);

CREATE TABLE IF NOT EXISTS `ecotrack_products` (
  `reference` VARCHAR(190) NOT NULL,
  `barcode` VARCHAR(190) NOT NULL DEFAULT '',
  `title` VARCHAR(255) NOT NULL DEFAULT '',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `image` VARCHAR(500) NOT NULL DEFAULT '',
  `stock_disponible` INT NOT NULL DEFAULT 0,
  `stock_reserve` INT NOT NULL DEFAULT 0,
  `stock_phisique` INT NOT NULL DEFAULT 0,
  `synced_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `ecotrack_products` ADD PRIMARY KEY (`reference`);

CREATE TABLE IF NOT EXISTS `activity_log` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NULL,
  `username` VARCHAR(190) NOT NULL DEFAULT '',
  `action` VARCHAR(100) NOT NULL DEFAULT '',
  `entity` VARCHAR(60) NOT NULL DEFAULT '',
  `entity_id` VARCHAR(60) NOT NULL DEFAULT '',
  `details` TEXT NULL,
  `ok` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `activity_log` ADD KEY `idx_log_created` (`created_at`);

CREATE TABLE IF NOT EXISTS `sync_jobs` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `kind` VARCHAR(60) NOT NULL DEFAULT '',
  `status` VARCHAR(30) NOT NULL DEFAULT '',
  `message` TEXT NULL,
  `count` INT NOT NULL DEFAULT 0,
  `started_at` DATETIME NULL,
  `finished_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
