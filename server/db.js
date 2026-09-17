import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WILAYAS, COMMUNES, mockFees } from './data/geo.js';
import { hashPassword, now, uid } from './lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'sitycom.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ── أدوات استعلام بسيطة ───────────────────────────────────────
export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}
export function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}
export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  active INTEGER NOT NULL DEFAULT 1,
  last_login TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL DEFAULT '',
  name_en TEXT NOT NULL DEFAULT '',
  slug TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT,
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL DEFAULT '',
  name_en TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  category_id INTEGER,
  image_url TEXT DEFAULT '',
  weight REAL DEFAULT 0,
  fragile INTEGER NOT NULL DEFAULT 0,
  ecotrack_reference TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone2 TEXT DEFAULT '',
  email TEXT DEFAULT '',
  wilaya_id INTEGER,
  commune TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT UNIQUE NOT NULL,
  customer_id INTEGER,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone2 TEXT DEFAULT '',
  wilaya_id INTEGER,
  wilaya_name TEXT DEFAULT '',
  commune TEXT DEFAULT '',
  address TEXT DEFAULT '',
  stop_desk INTEGER NOT NULL DEFAULT 0,
  desk_code TEXT DEFAULT '',
  desk_name TEXT DEFAULT '',
  subtotal REAL NOT NULL DEFAULT 0,
  shipping_fee REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  source TEXT NOT NULL DEFAULT 'admin',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  name TEXT NOT NULL,
  sku TEXT DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

-- حقول الربط مع Ecotrack (سطر واحد لكل طلبية)
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER UNIQUE NOT NULL,
  tracking TEXT,
  reference TEXT,
  type INTEGER NOT NULL DEFAULT 1,           -- 1 Livraison 2 Échange 3 Pickup 4 Recouvrement
  stop_desk INTEGER NOT NULL DEFAULT 0,
  produit TEXT DEFAULT '',
  quantite TEXT DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,
  produit_a_recuperer TEXT DEFAULT '',
  boutique TEXT DEFAULT '',
  remarque TEXT DEFAULT '',
  weight REAL DEFAULT 0,
  fragile INTEGER NOT NULL DEFAULT 0,
  gps_link TEXT DEFAULT '',
  ask_collection INTEGER NOT NULL DEFAULT 0,
  ecotrack_status TEXT DEFAULT '',
  delivery_fee REAL DEFAULT 0,
  return_fee REAL DEFAULT 0,
  last_activity TEXT DEFAULT '',
  last_activity_at TEXT DEFAULT '',
  pushed_at TEXT,
  validated_at TEXT,
  return_asked_at TEXT,
  synced_at TEXT,
  raw TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  tracking TEXT,
  status TEXT,
  activity TEXT,
  station TEXT DEFAULT '',
  driver TEXT DEFAULT '',
  details TEXT DEFAULT '',
  event_date TEXT,
  event_time TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_events_tracking ON order_events(tracking);

CREATE TABLE IF NOT EXISTS wilayas (
  wilaya_id INTEGER PRIMARY KEY,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  has_stop_desk INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS communes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wilaya_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  code_postal TEXT DEFAULT '',
  has_stop_desk INTEGER NOT NULL DEFAULT 0,
  UNIQUE(wilaya_id, name)
);
CREATE INDEX IF NOT EXISTS idx_communes_wilaya ON communes(wilaya_id);

CREATE TABLE IF NOT EXISTS desks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hub_id TEXT,
  name TEXT NOT NULL,
  wilaya TEXT DEFAULT '',
  commune TEXT DEFAULT '',
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  phone2 TEXT DEFAULT '',
  email TEXT DEFAULT '',
  map TEXT DEFAULT '',
  hours TEXT DEFAULT '',
  is_my_desk INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shipping_fees (
  wilaya_id INTEGER PRIMARY KEY,
  wilaya_name TEXT DEFAULT '',
  delivery_home REAL NOT NULL DEFAULT 0,
  delivery_stopdesk REAL NOT NULL DEFAULT 0,
  pickup_home REAL NOT NULL DEFAULT 0,
  pickup_stopdesk REAL NOT NULL DEFAULT 0,
  exchange_home REAL NOT NULL DEFAULT 0,
  exchange_stopdesk REAL NOT NULL DEFAULT 0,
  collection_home REAL NOT NULL DEFAULT 0,
  collection_stopdesk REAL NOT NULL DEFAULT 0,
  return_home REAL NOT NULL DEFAULT 0,
  return_stopdesk REAL NOT NULL DEFAULT 0,
  raw TEXT,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS ecotrack_products (
  reference TEXT PRIMARY KEY,
  barcode TEXT DEFAULT '',
  title TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  image TEXT DEFAULT '',
  stock_disponible INTEGER DEFAULT 0,
  stock_reserve INTEGER DEFAULT 0,
  stock_phisique INTEGER DEFAULT 0,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT DEFAULT '',
  action TEXT NOT NULL,
  entity TEXT DEFAULT '',
  entity_id TEXT DEFAULT '',
  details TEXT DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_created ON activity_log(created_at);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT DEFAULT '',
  count INTEGER DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
`;

db.exec(SCHEMA);

// ── الإعدادات ────────────────────────────────────────────────
export function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(key, value) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, payload, now()],
  );
}

export function allSettings() {
  const out = {};
  for (const row of all('SELECT key, value FROM settings')) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}

export function logActivity(userId, username, action, entity = '', entityId = '', details = '', ok = 1) {
  try {
    run(
      `INSERT INTO activity_log (user_id, username, action, entity, entity_id, details, ok, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId ?? null, username ?? '', action, entity, String(entityId ?? ''), typeof details === 'string' ? details : JSON.stringify(details), ok ? 1 : 0, now()],
    );
  } catch {
    /* لا نُفشل الطلب بسبب السجل */
  }
}

// ── البذرة الأولى ────────────────────────────────────────────
export function seedIfEmpty() {
  const users = get('SELECT COUNT(*) AS c FROM users');
  if (num0(users) > 0) return false;

  const stamp = now();

  // المستخدم الإداري
  run(
    `INSERT INTO users (username, name, password_hash, role, active, created_at)
     VALUES (?, ?, ?, 'admin', 1, ?)`,
    [
      process.env.ADMIN_USERNAME || 'admin',
      'المدير',
      hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
      stamp,
    ],
  );

  // الإعدادات الافتراضية
  const defaults = {
    store: {
      name_ar: 'سيتي كوم',
      name_fr: 'Sitycom',
      name_en: 'Sitycom',
      phone: '0550 00 00 00',
      email: 'contact@sitycom.dz',
      address: 'الجزائر',
      currency: 'DZD',
    },
    ecotrack: {
      base_url: process.env.ECOTRACK_BASE_URL || '',
      api_token: process.env.ECOTRACK_API_TOKEN || '',
      auth_mode: process.env.ECOTRACK_AUTH_MODE || 'both',
      mock: process.env.ECOTRACK_MOCK === '1',
      timeout: Number(process.env.ECOTRACK_TIMEOUT || 20000),
      default_type: 1,
      default_origin_wilaya: 16,
      auto_validate: 0,
      ask_collection: 1,
      default_boutique: '',
      auto_sync_status: 0,
    },
    orders: {
      prefix: 'CMD',
      default_shipping_fee: 0,
      low_stock_alert: 5,
    },
  };
  for (const [k, v] of Object.entries(defaults)) setSetting(k, v);

  // الولايات والبلديات المبدئية
  const insWilaya = db.prepare(
    `INSERT OR IGNORE INTO wilayas (wilaya_id, name_fr, name_ar, active, has_stop_desk) VALUES (?, ?, ?, 1, 0)`,
  );
  for (const [id, fr, ar] of WILAYAS) insWilaya.run(id, fr, ar);

  const insCommune = db.prepare(
    `INSERT OR IGNORE INTO communes (wilaya_id, name, code_postal, has_stop_desk) VALUES (?, ?, '', 0)`,
  );
  for (const [wilayaId, names] of Object.entries(COMMUNES)) {
    for (const name of names) insCommune.run(Number(wilayaId), name);
  }

  // أسعار تجريبية
  const insFee = db.prepare(
    `INSERT OR IGNORE INTO shipping_fees (wilaya_id, wilaya_name, delivery_home, delivery_stopdesk,
      pickup_home, pickup_stopdesk, exchange_home, exchange_stopdesk,
      collection_home, collection_stopdesk, return_home, return_stopdesk, raw, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const f of mockFees()) {
    insFee.run(
      f.wilaya_id, f.wilaya_name,
      Number(f.livraison.tarif), Number(f.livraison.tarif_stopdesk),
      Number(f.pickup.tarif), Number(f.pickup.tarif_stopdesk),
      Number(f.echange.tarif), Number(f.echange.tarif_stopdesk),
      Number(f.recouvrement.tarif), Number(f.recouvrement.tarif_stopdesk),
      Number(f.retour.tarif), Number(f.retour.tarif_stopdesk),
      JSON.stringify(f), stamp,
    );
  }

  // تصنيفات
  const cats = [
    ['إلكترونيات', 'Électronique', 'Electronics'],
    ['أزياء', 'Mode', 'Fashion'],
    ['منزل ومطبخ', 'Maison & Cuisine', 'Home & Kitchen'],
    ['تجميل وعناية', 'Beauté & Soin', 'Beauty & Care'],
    ['رياضة', 'Sport', 'Sports'],
  ];
  for (const [ar, fr, en] of cats) {
    run(
      `INSERT INTO categories (name_ar, name_fr, name_en, slug, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
      [ar, fr, en, String(Math.random()).slice(2, 8), stamp],
    );
  }

  // منتجات تجريبية
  const products = [
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
  for (const [sku, ar, fr, en, cat, price, cost, stock, weight, fragile] of products) {
    run(
      `INSERT INTO products (sku, name_ar, name_fr, name_en, description, price, cost, stock, category_id,
        image_url, weight, fragile, ecotrack_reference, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, '', ?, ?, ?, 1, ?, ?)`,
      [sku, ar, fr, en, price, cost, stock, cat, weight, fragile, sku, stamp, stamp],
    );
  }

  // عملاء + طلبيات تجريبية
  const demoCustomers = [
    ['أحمد بن علي', '0550123456', '0661234567', 16, 'Bab Ezzouar', '17 Rue des Frères Bouadou'],
    ['سارة مزياني', '0661987654', '', 31, 'Es Senia', 'Cité 200 logements Bt 12'],
    ['يوسف قاسمي', '0770334455', '', 25, 'El Khroub', 'Rue 1er Novembre'],
    ['نورة بوعزيز', '0551789654', '0661002233', 6, 'Akbou', 'Cité Sidi Ali'],
    ['محمد طويل', '0699887766', '', 30, 'Rouissat', 'Hay Nasr Bt 04'],
    ['ليلى حداد', '0554231567', '', 35, 'Thenia', 'Rue de la Gare'],
  ];
  const insCustomer = db.prepare(
    `INSERT OR IGNORE INTO customers (name, phone, phone2, email, wilaya_id, commune, address, notes, created_at)
     VALUES (?, ?, ?, '', ?, ?, ?, '', ?)`,
  );
  for (const [name, phone, phone2, wilaya, commune, address] of demoCustomers) {
    insCustomer.run(name, phone, phone2, wilaya, commune, address, stamp);
  }

  const statuses = [
    ['draft', ''], ['prete_a_expedier', 'EC' + rand(12)], ['en_livraison', 'EC' + rand(12)],
    ['livre_non_encaisse', 'EC' + rand(12)], ['en_hub', 'EC' + rand(12)],
    ['retour_en_traitement', 'EC' + rand(12)], ['suspendu', 'EC' + rand(12)], ['en_preparation', 'EC' + rand(12)],
  ];

  let n = 0;
  for (const [status, tracking] of statuses) {
    n += 1;
    const cust = demoCustomers[n % demoCustomers.length];
    const wilayaId = cust[3];
    const wilayaName = (WILAYAS.find((w) => w[0] === wilayaId) || [0, ''])[1];
    const items = sampleItems(n);
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const shipping = 600 + ((n * 137) % 500);
    const total = subtotal + shipping;
    const orderNumber = `CMD-20260${(n % 9) + 1}1${String(n).padStart(2, '0')}`;
    const created = new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace('T', ' ');

    const info = run(
      `INSERT INTO orders (order_number, customer_id, customer_name, phone, phone2, wilaya_id, wilaya_name,
        commune, address, stop_desk, subtotal, shipping_fee, discount, total, status, payment_status,
        source, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, 'admin', '', ?, ?)`,
      [orderNumber, null, cust[0], cust[1], cust[2], wilayaId, wilayaName, cust[4], cust[5],
        subtotal, shipping, total, status, status === 'livre_non_encaisse' ? 'collected' : 'unpaid', created, created],
    );
    const orderId = Number(info.lastInsertRowid);

    for (const it of items) {
      run(
        `INSERT INTO order_items (order_id, product_id, name, sku, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, null, it.name, 'SKU-DEMO', it.qty, it.price, it.price * it.qty],
      );
    }

    if (tracking) {
      run(
        `INSERT INTO shipments (order_id, tracking, reference, type, stop_desk, produit, quantite,
          stock, boutique, remarque, weight, fragile, ecotrack_status, delivery_fee, pushed_at)
         VALUES (?, ?, ?, 1, 0, ?, '', 0, '', '', 1, 0, ?, ?, ?)`,
        [
          orderId,
          tracking,
          orderNumber,
          items.map((i) => `${i.name} x${i.qty}`).join(' / '),
          status,
          shipping,
          created,
        ],
      );
      run(
        `INSERT INTO order_events (order_id, tracking, status, activity, station, driver, details, event_date, event_time, created_at)
         VALUES (?, ?, ?, ?, '', '', '', ?, '', ?)`,
        [orderId, tracking, status, 'order_information_received_by_carrier', created.slice(0, 10), created],
      );
    }
  }

  logActivity(null, 'system', 'seed', 'database', '', 'تهيئة قاعدة البيانات والبيانات التجريبية', 1);
  return true;
}

function num0(row) {
  return Number(row?.c ?? 0);
}
function rand(len) {
  let s = '';
  for (let i = 0; i < len; i += 1) s += '0123456789'[Math.floor(Math.random() * 10)];
  return s;
}
function sampleItems(n) {
  const pool = [
    { name: 'سماعات بلوتوث لاسلكية', price: 4500 },
    { name: 'ساعة ذكية رياضية', price: 8900 },
    { name: 'حقيبة ظهر مقاومة للماء', price: 5400 },
    { name: 'قميص قطني رجالي', price: 2200 },
    { name: 'مقلاة غير لاصقة 28سم', price: 3900 },
    { name: 'سجادة رياضية', price: 4100 },
  ];
  const a = { ...pool[n % pool.length], qty: 1 };
  const b = { ...pool[(n * 3) % pool.length], qty: 2 };
  return a.name === b.name ? [b] : [a, b];
}

export function resetDb() {
  db.exec(`
    DELETE FROM order_events; DELETE FROM shipments; DELETE FROM order_items;
    DELETE FROM orders; DELETE FROM customers; DELETE FROM products; DELETE FROM categories;
    DELETE FROM shipping_fees; DELETE FROM wilayas; DELETE FROM communes; DELETE FROM desks;
    DELETE FROM ecotrack_products; DELETE FROM activity_log; DELETE FROM sync_jobs;
    DELETE FROM sessions; DELETE FROM users; DELETE FROM settings;
  `);
  seedIfEmpty();
}

export { uid };
