// ════════════════════════════════════════════════════════════════════
//  طبقة البيانات — Supabase (PostgreSQL عبر REST)
//  المتطلبات:
//    1) تنفيذ  database/supabase.sql  مرة واحدة في Supabase ← SQL Editor
//    2) ضبط SUPABASE_URL و SUPABASE_ANON_KEY في ملف .env
// ════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { WILAYAS, COMMUNES, mockFees } from './data/geo.js';
import { hashPassword, now, uid } from './lib/util.js';

// العميل يُنشأ عند أول استعمال (كسول) — ضروري على Cloudflare Workers
// حيث لا تتوفّر متغيرات البيئة أثناء تقييم الوحدات.
let _client = null;

export function getSupabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'إعدادات Supabase ناقصة — اضبط SUPABASE_URL و SUPABASE_ANON_KEY '
      + '(ملف .env محليًا، أو أسرار Cloudflare عند النشر)',
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/** واجهة متوافقة مع الاستعمال القديم: supabase.from(...) */
export const supabase = new Proxy({}, {
  get(_t, prop) {
    const client = getSupabase();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

/** PostgREST لا يعيد أكثر من 1000 سطر في الطلب الواحد */
export const REST_PAGE = 1000;

/** يفحص نتيجة Supabase ويرمي خطأ واضحاً عند الفشل */
export function must(res, what = '') {
  if (res.error) {
    const msg = res.error.message || String(res.error);
    const missingTable = res.error.code === '42P01' || res.error.code === 'PGRST205'
      || /does not exist|schema cache/i.test(msg);
    const network = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(msg);
    const hint = missingTable
      ? '\n  ↳ نفّذ ملف  database/supabase.sql  في Supabase ← SQL Editor ثم أعد المحاولة.'
      : network
        ? '\n  ↳ تعذّر الوصول إلى Supabase — تحقّق من الاتصال بالإنترنت ومن صحة SUPABASE_URL في ملف .env'
        : '';
    throw new Error(`قاعدة البيانات${what ? ` (${what})` : ''}: ${msg}${hint}`);
  }
  return res.data;
}

/** يقطّع مصفوفة كبيرة إلى دفعات صغيرة للإدراج الجماعي */
export function chunk(arr, size = 400) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** يجلب كل الأسطر على صفحات (لتجاوز حد 1000 سطر لكل طلب) */
export async function fetchAllPages(build, what = 'fetchAll', maxPages = 50) {
  const out = [];
  for (let from = 0, page = 0; page < maxPages; from += REST_PAGE, page += 1) {
    const rows = must(await build(from, from + REST_PAGE - 1), what);
    out.push(...rows);
    if (rows.length < REST_PAGE) break;
  }
  return out;
}

// ── الإعدادات ────────────────────────────────────────────────
export async function getSetting(key, fallback = null) {
  const row = must(
    await supabase.from('settings').select('value').eq('key', key).maybeSingle(),
    'getSetting',
  );
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export async function setSetting(key, value) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  must(
    await supabase.from('settings').upsert({ key, value: payload, updated_at: now() }, { onConflict: 'key' }),
    'setSetting',
  );
}

export async function allSettings() {
  const rows = must(await supabase.from('settings').select('key, value'), 'allSettings');
  const out = {};
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}

export async function logActivity(userId, username, action, entity = '', entityId = '', details = '', ok = 1) {
  try {
    await supabase.from('activity_log').insert({
      user_id: userId ?? null,
      username: username ?? '',
      action,
      entity,
      entity_id: String(entityId ?? ''),
      details: typeof details === 'string' ? details : JSON.stringify(details),
      ok: ok ? 1 : 0,
      created_at: now(),
    });
  } catch {
    /* لا نُفشل الطلب بسبب السجل */
  }
}

/** يعيد عدد الأسطر المطابقة (يُستخدم مع  count: 'exact', head: true) */
export async function countRows(queryPromise, what = 'count') {
  const res = await queryPromise;
  must(res, what);
  return Number(res.count || 0);
}

// ── البذرة الأولى ────────────────────────────────────────────
export async function seedIfEmpty() {
  const count = await countRows(
    supabase.from('users').select('id', { count: 'exact', head: true }),
    'seed.check',
  );
  if (count > 0) return false;

  const stamp = now();

  // المستخدم الإداري — يُنشأ فقط إذا وُجدت بيانات في .env
  // وإلا يُنشئ أول مستخدم حسابه بنفسه من صفحة register.html (ويصبح مديرًا)
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    must(
      await supabase.from('users').insert({
        username: String(process.env.ADMIN_USERNAME).trim().toLowerCase(),
        name: process.env.ADMIN_NAME || 'المدير',
        password_hash: hashPassword(process.env.ADMIN_PASSWORD),
        role: 'admin',
        active: 1,
        created_at: stamp,
      }),
      'seed.user',
    );
  }

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
      // استيراد تلقائي للطلبيات المنشأة في منصة شركة التوصيل
      auto_import: 1,
      auto_import_interval: 5,
      auto_import_pages: 1,
    },
  };
  for (const [k, v] of Object.entries(defaults)) await setSetting(k, v);

  // الولايات
  for (const part of chunk(WILAYAS, 400)) {
    must(
      await supabase.from('wilayas').upsert(
        part.map(([id, fr, ar]) => ({ wilaya_id: id, name_fr: fr, name_ar: ar, active: 1, has_stop_desk: 0 })),
        { onConflict: 'wilaya_id', ignoreDuplicates: true },
      ),
      'seed.wilayas',
    );
  }

  // البلديات
  const communes = Object.entries(COMMUNES).flatMap(([wid, names]) =>
    names.map((name) => ({ wilaya_id: Number(wid), name, code_postal: '', has_stop_desk: 0 })));
  for (const part of chunk(communes, 400)) {
    must(
      await supabase.from('communes').upsert(part, { onConflict: 'wilaya_id,name', ignoreDuplicates: true }),
      'seed.communes',
    );
  }

  // أسعار تجريبية
  const fees = mockFees().map((f) => ({
    wilaya_id: f.wilaya_id,
    wilaya_name: f.wilaya_name,
    delivery_home: Number(f.livraison.tarif),
    delivery_stopdesk: Number(f.livraison.tarif_stopdesk),
    pickup_home: Number(f.pickup.tarif),
    pickup_stopdesk: Number(f.pickup.tarif_stopdesk),
    exchange_home: Number(f.echange.tarif),
    exchange_stopdesk: Number(f.echange.tarif_stopdesk),
    collection_home: Number(f.recouvrement.tarif),
    collection_stopdesk: Number(f.recouvrement.tarif_stopdesk),
    return_home: Number(f.retour.tarif),
    return_stopdesk: Number(f.retour.tarif_stopdesk),
    raw: JSON.stringify(f),
    synced_at: stamp,
  }));
  must(await supabase.from('shipping_fees').upsert(fees, { onConflict: 'wilaya_id' }), 'seed.fees');

  // التصنيفات (نحفظ المعرّفات الفعلية لربط المنتجات بها)
  const cats = [
    ['إلكترونيات', 'Électronique', 'Electronics'],
    ['أزياء', 'Mode', 'Fashion'],
    ['منزل ومطبخ', 'Maison & Cuisine', 'Home & Kitchen'],
    ['تجميل وعناية', 'Beauté & Soin', 'Beauty & Care'],
    ['رياضة', 'Sport', 'Sports'],
  ];
  const categoryIds = [];
  for (const [ar, fr, en] of cats) {
    const row = must(
      await supabase.from('categories').insert({
        name_ar: ar, name_fr: fr, name_en: en,
        slug: String(Math.random()).slice(2, 8), active: 1, created_at: stamp,
      }).select('id').single(),
      'seed.category',
    );
    categoryIds.push(Number(row.id));
  }

  // منتجات تجريبية
  const products = [
    ['SKU-001', 'سماعات بلوتوث لاسلكية', 'Écouteurs Bluetooth', 'Wireless Earbuds', 0, 4500, 2800, 40, 0.3, 0],
    ['SKU-002', 'ساعة ذكية رياضية', 'Montre connectée sport', 'Smart Sport Watch', 0, 8900, 5600, 25, 0.2, 0],
    ['SKU-003', 'شاحن سريع 65W', 'Chargeur rapide 65W', '65W Fast Charger', 0, 3200, 1900, 60, 0.25, 0],
    ['SKU-004', 'حقيبة ظهر مقاومة للماء', 'Sac à dos étanche', 'Waterproof Backpack', 1, 5400, 3100, 18, 0.7, 0],
    ['SKU-005', 'قميص قطني رجالي', 'T-shirt coton homme', "Men's Cotton T-Shirt", 1, 2200, 1100, 80, 0.25, 0],
    ['SKU-006', 'حذاء رياضي خفيف', 'Chaussures de sport', 'Running Shoes', 1, 11500, 7200, 12, 0.9, 0],
    ['SKU-007', 'طقم أواني طبخ 12 قطعة', 'Set de cuisine 12 pièces', '12-Pc Cookware Set', 2, 14500, 9800, 9, 4.5, 1],
    ['SKU-008', 'مقلاة غير لاصقة 28سم', 'Poêle antiadhésive 28cm', 'Non-stick Pan 28cm', 2, 3900, 2200, 22, 1.2, 1],
    ['SKU-009', 'كريم مرطب بالأرغان', 'Crème hydratante Argan', 'Argan Moisturizer', 3, 2600, 1400, 50, 0.2, 0],
    ['SKU-010', 'شامبو بالزيوت الطبيعية', 'Shampoing aux huiles', 'Natural Oil Shampoo', 3, 1900, 950, 3, 0.35, 0],
    ['SKU-011', 'سجادة رياضية', 'Tapis de sport', 'Yoga Mat', 4, 4100, 2400, 15, 1.5, 0],
    ['SKU-012', 'دمبلز حديد 10كغ', 'Haltères 10 kg', '10kg Dumbbell Set', 4, 9800, 6300, 2, 10, 1],
  ];
  must(
    await supabase.from('products').insert(products.map(([sku, ar, fr, en, cat, price, cost, stock, weight, fragile]) => ({
      sku, name_ar: ar, name_fr: fr, name_en: en, description: '',
      price, cost, stock, category_id: categoryIds[cat],
      image_url: '', weight, fragile, ecotrack_reference: sku,
      active: 1, created_at: stamp, updated_at: stamp,
    }))),
    'seed.products',
  );

  // عملاء + طلبيات تجريبية
  const demoCustomers = [
    ['أحمد بن علي', '0550123456', '0661234567', 16, 'Bab Ezzouar', '17 Rue des Frères Bouadou'],
    ['سارة مزياني', '0661987654', '', 31, 'Es Senia', 'Cité 200 logements Bt 12'],
    ['يوسف قاسمي', '0770334455', '', 25, 'El Khroub', 'Rue 1er Novembre'],
    ['نورة بوعزيز', '0551789654', '0661002233', 6, 'Akbou', 'Cité Sidi Ali'],
    ['محمد طويل', '0699887766', '', 30, 'Rouissat', 'Hay Nasr Bt 04'],
    ['ليلى حداد', '0554231567', '', 35, 'Thenia', 'Rue de la Gare'],
  ];
  must(
    await supabase.from('customers').insert(demoCustomers.map(([name, phone, phone2, wilaya, commune, address]) => ({
      name, phone, phone2, email: '', wilaya_id: wilaya, commune, address, notes: '', created_at: stamp,
    }))),
    'seed.customers',
  );

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

    const orderRow = must(
      await supabase.from('orders').insert({
        order_number: orderNumber, customer_id: null, customer_name: cust[0], phone: cust[1], phone2: cust[2],
        wilaya_id: wilayaId, wilaya_name: wilayaName, commune: cust[4], address: cust[5],
        stop_desk: 0, subtotal, shipping_fee: shipping, discount: 0, total,
        status, payment_status: status === 'livre_non_encaisse' ? 'collected' : 'unpaid',
        source: 'admin', notes: '', created_at: created, updated_at: created,
      }).select('id').single(),
      'seed.order',
    );
    const orderId = Number(orderRow.id);

    must(
      await supabase.from('order_items').insert(items.map((it) => ({
        order_id: orderId, product_id: null, name: it.name, sku: 'SKU-DEMO',
        qty: it.qty, unit_price: it.price, line_total: it.price * it.qty,
      }))),
      'seed.order_items',
    );

    if (tracking) {
      must(
        await supabase.from('shipments').insert({
          order_id: orderId, tracking, reference: orderNumber, type: 1, stop_desk: 0,
          produit: items.map((i) => `${i.name} x${i.qty}`).join(' / '),
          quantite: '', stock: 0, boutique: '', remarque: '',
          weight: 1, fragile: 0, ecotrack_status: status, delivery_fee: shipping, pushed_at: created,
        }),
        'seed.shipment',
      );
      must(
        await supabase.from('order_events').insert({
          order_id: orderId, tracking, status, activity: 'order_information_received_by_carrier',
          station: '', driver: '', details: '', event_date: created.slice(0, 10), event_time: '', created_at: created,
        }),
        'seed.event',
      );
    }
  }

  await logActivity(null, 'system', 'seed', 'database', '', 'تهيئة قاعدة البيانات والبيانات التجريبية', 1);
  return true;
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

/** إعادة تهيئة قاعدة البيانات على Supabase (حذف كل الصفوف ثم البذرة من جديد) */
export async function resetDb() {
  const tables = [
    ['order_events', 'id'], ['shipments', 'id'], ['order_items', 'id'], ['orders', 'id'],
    ['customers', 'id'], ['products', 'id'], ['categories', 'id'],
    ['communes', 'id'], ['desks', 'id'],
    ['shipping_fees', 'wilaya_id'], ['wilayas', 'wilaya_id'], ['ecotrack_products', 'reference'],
    ['activity_log', 'id'], ['sync_jobs', 'id'], ['sessions', 'token'], ['users', 'id'], ['settings', 'key'],
  ];
  for (const [table, pk] of tables) {
    must(await supabase.from(table).delete().not(pk, 'is', null), `reset.${table}`);
  }
  await seedIfEmpty();
}

export { uid };
