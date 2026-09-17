# 🛒 Sitycom — منصة تجارة إلكترونية جزائرية مرتبطة بـ Ecotrack

منصة إدارة متجر إلكتروني (طلبيات، منتجات، عملاء، تقارير) **مرتبطة بالكامل بـ Ecotrack API v1**
— كل الـ 21 endpoint الموجودة في
[توثيق Ecotrack الرسمي](https://documenter.getpostman.com/view/14517169/Tz5je15g) مطبّقة ويمكن
استدعاؤها من لوحة التحكم أو عبر API المحلي.

> الواجهة: **HTML + CSS + JavaScript** (بدون إطارات) · الخادم: **Node.js + Express** ·
> القاعدة: **Supabase (PostgreSQL)** عبر REST API بمفتاح `anon`.
> ثلاث لغات: 🇩🇿 العربية (RTL) · 🇫🇷 الفرنسية · 🇬🇧 الإنجليزية.

---

## 1. التشغيل السريع

### 1.1 إعداد قاعدة Supabase (مرة واحدة)

1. أنشئ مشروعاً على [supabase.com](https://supabase.com) (أو استخدم مشروعاً موجوداً).
2. من لوحة المشروع افتح **SQL Editor ← New query**.
3. الصق محتوى الملف **`database/supabase.sql`** كاملاً ثم اضغط **Run**.
   (ينشئ 17 جدولاً + الفهارس + سياسات الأمان + دوال التجميع للوحة والتقارير وقائمة الطلبيات.)
4. من **Settings ← API** انسخ:
   - **Project URL** ← ضعه في `SUPABASE_URL`
   - **anon public key** ← ضعه في `SUPABASE_ANON_KEY`

> الخادم يستخدم مفتاح `anon` مع سياسات RLS مفتوحة للتطبيق الداخلي.
> عند أول تشغيل ينشئ الخادم المستخدم الإداري والبيانات التجريبية تلقائياً على Supabase.

### 1.2 التشغيل

```bash
node -v                # يتطلب Node.js 18 أو أحدث

git clone <repo> && cd sitycom
npm install            # يثبّت Express + @supabase/supabase-js
cp .env.example .env   # ثم ضع SUPABASE_URL و SUPABASE_ANON_KEY
npm start              # http://localhost:3000
```

- لوحة التحكم: <http://localhost:3000/> (أو `/index.html`)
- صفحة تتبّع الزبون (عمومية بدون دخول): <http://localhost:3000/track.html>
- بيانات الدخول التجريبية: `admin` / `admin123`
- فحص حالة القاعدة: <http://localhost:3000/api/health>

للتطوير مع إعادة التشغيل التلقائي: `npm run dev`
لإعادة تهيئة القاعدة (حذف كل الصفوف على Supabase وإعادة البيانات التجريبية): `npm run reset-db`

### ملف `.env`

انسخ `.env.example` إلى `.env` وعدّله (ملف `.env` غير مرفوع إلى Git):

```env
# قاعدة البيانات (من لوحة Supabase ← Settings ← API)
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...

PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123

ECOTRACK_BASE_URL=          # مثال: https://votre-societe.ecotrack.dz
ECOTRACK_API_TOKEN=         # التوكن من حساب Ecotrack
ECOTRACK_AUTH_MODE=both     # both | bearer | query
ECOTRACK_MOCK=0             # 1 = بيانات تجريبية دائماً
ECOTRACK_TIMEOUT=20000
```

---
## 2. الاستضافة على InfinityFree (PHP + MySQL)

نسخة PHP جاهزة للرفع على أي استضافة مشتركة (InfinityFree تستضيف PHP + MySQL فقط — لا تدعم Node.js).

### 2.1 ما ترفعه

ارفع إلى مجلد `htdocs`:

```
htdocs/
├── api/                  ← مجلد api كاملاً من المشروع
├── assets/               ← من داخل public/
├── index.html, login.html, orders.html … (كل ملفات public/)
└── .htaccess             ← ملف .htaccess الموجود في جذر المشروع
```

### 2.2 إعداد قاعدة البيانات

1. من لوحة تحكم InfinityFree ← **MySQL Databases** ← أنشئ قاعدة جديدة.
   ستظهر لك: **MySQL Host Name** (مثل `sql110.infinityfree.com`) واسم القاعدة
   (`epiz_XXXXXX_sitycom`) واسم المستخدم وكلمة المرور.
2. انسخ `api/config.local.example.php` باسم **`api/config.local.php`** واملأ البيانات:

```php
return [
    'db' => [
        'driver' => 'mysql',
        'host'   => 'sql110.infinityfree.com',
        'name'   => 'epiz_XXXXXX_sitycom',
        'user'   => 'epiz_XXXXXX',
        'pass'   => '••••••••',
    ],
    'ecotrack' => [
        'base_url'  => 'https://votre-societe.ecotrack.dz',
        'api_token' => 'OijXEUsjLZ…',
    ],
];
```

3. افتح **`https://موقعك/api/setup.php?key=sitycom`** — تنشئ الصفحة الجداول (17 جدولاً)
   وتدرج البيانات التجريبية، ثم اضغط «فتح لوحة التحكم».
   (أو استورد `database/mysql.sql` يدوياً عبر phpMyAdmin كما في القسم 2.2.)
4. سجّل الدخول بـ `admin` / `admin123` و**غيّر كلمة المرور فوراً** من الإعدادات.

### 2.2 الربط خطوة بخطوة عبر phpMyAdmin

**أ) احصل على بيانات الاتصال** (من Client Area ← الحساب ← قسم “MySQL Details”، أو من لوحة التحكم ← MySQL Databases):

| الحقل | المثال | ملاحظة |
|---|---|---|
| MySQL Hostname | `sql110.infinityfree.com` | **ليس** `localhost` |
| MySQL Username | `epiz_12345678` | مستخدم الحساب (يبدأ بـ `epiz_`) |
| MySQL Password | كلمة مرور **حساب الاستضافة** | تختلف عن كلمة مرور Client Area |
| Database Name | `epiz_12345678_sitycom` | الاسم الكامل **مع البادئة** |

**ب) أنشئ القاعدة:** لوحة التحكم ← **MySQL Databases** ← اكتب `sitycom` ← Create Database
(سيظهر الاسم الكامل `epiz_XXXXXX_sitycom` في القائمة).

**ج) افتح phpMyAdmin:** زر **phpMyAdmin** (أو Admin) بجانب القاعدة؛
سجّل الدخول بنفس اسم المستخدم وكلمة مرور حساب الاستضافة. إن طلب حقل “Server” اكتب `sql110.infinityfree.com`.

**د) استورد المخطط:** من الشريط الأيسر اختر قاعدة `epiz_XXXXXX_sitycom` ← تبويب **Import (استيراد)**
← **Choose File** ← اختر `database/mysql.sql` ← اترك التنسيق `SQL` وترميز الملف `utf-8` ← **Go (تنفيذ)**.
يجب أن تظهر رسالة خضراء بأن الاستيراد نجح و**17 جدولاً** في القائمة.

**هـ) تحقّق:** افتح `https://موقعك/api/health` — إن كان كل شيء صحيحاً ستظهر:
`{"ok":true,"db":"mysql",...}`. وإن كانت هناك مشكلة في البيانات ستظهر رسالة توضّح السبب.

**و) أشهر المشاكل:**
| الرسالة | السبب والحل |
|---|---|
| `Access denied for user` | كلمة المرور هي كلمة مرور **حساب الاستضافة** لا Client Area؛ والمستخدم `epiz_XXXXXX` وليس اسم القاعدة |
| `Unknown database` | استخدم الاسم الكامل `epiz_XXXXXX_sitycom` كما يظهر في لوحة التحكم |
| `No tables` بعد الاستيراد | تأكد أنك اخترت القاعدة من الشريط الأيسر قبل الاستيراد |
| phpMyAdmin لا يفتح | انتظر دقائق بعد إنشاء الحساب، ثم أعد المحاولة من لوحة التحكم |

### 2.3 متطلبات الاستضافة
- PHP 7.4 أو أحدث مع `pdo_mysql` و `cURL` و `json` (مفعّلة افتراضياً على InfinityFree).
- `mod_rewrite` مفعّل (موجود) — وبدونه يعمل الـ API عبر `api/index.php?p=المسار`.
- لا حاجة لـ Composer أو SSH أو أي اعتمادية خارجية.

### 2.4 الفرق بين الباكندين
| | Node.js (`server/`) | PHP (`api/`) |
|---|---|---|
| الاستخدام | التشغيل المحلي/خادم VPS | الاستضافة المشتركة (InfinityFree) |
| القاعدة | **Supabase (PostgreSQL)** عبر REST | MySQL (ويمكن SQLite للتجربة) |
| التشغيل | `npm start` | Apache + PHP |
| الواجهة والـ API | **نفس الواجهة ونفس مسارات الـ API تماماً** | |

## 3. ربط حساب Ecotrack (مهم)

Ecotrack هي المنصّة التي تعمل عليها عشرات شركات التوصيل الجزائرية (DHD، Conexlog، MSM Go،
Rocket…). **لكل شركة نطاقها الخاص**، لذلك تحتاج قيمتين من لوحة حسابك:

1. **الرابط الأساسي** مثل `https://votre-societe.ecotrack.dz`
2. **التوكن** (من: الحساب ← API ← توليد توكن)

أدخلهما من: **لوحة التحكم ← التوصيل (Ecotrack) ← لوحة الشحن ← حالة الاتصال** ثم اضغط
**اختبار الاتصال** (يستدعي `GET /api/v1/validate/token`).

> إلى حين إدخال الرابط، يعمل التطبيق تلقائياً في **وضع تجريبي (Mock)** يعيد بيانات واقعية
> مطابقة لأشكال استجابات Ecotrack — لتجربة كل الشاشات بدون حساب فعلي.

بعد الحفظ، اضغط **مزامنة شاملة** لسحب: الولايات (17)، المكاتب (18)، البلديات (19)،
الأسعار (20)، المنتجات (21).

⚠️ **حد الطلبات:** 50 طلب/دقيقة · 1500/ساعة · 15000/يوم.
المزامنة تحترم ذلك تلقائياً (تأخير 120–150ms بين الطلبات + تقسيم 100 طلبية لكل نداء).

---

## 4. الصفحات (12 صفحة)

| الصفحة | الملف | الوظيفة |
|---|---|---|
| تسجيل الدخول | `login.html` | دخول + اختيار اللغة |
| لوحة المعلومات | `index.html` | مؤشرات، مبيعات يومية، توزيع الحالات، أحدث الطلبيات، المخزون المنخفض، حالة الربط |
| الطلبيات | `orders.html` | فلاتر متقدمة، إجراءات فردية/جماعية، نافذة تفاصيل مع السجل الزمني |
| طلبية جديدة | `orders-new.html` | اختيار زبون/ولاية/بلدية/مكتب، سلة منتجات، سعر توصيل تلقائي من `get/fees` |
| لوحة الشحن | `shipping.html` | إعدادات الاتصال، اختبار التوكن، المزامنة، الأسعار، الولايات، البلديات، المكاتب، منتجات Ecotrack، السجل + قائمة الـ 21 endpoint |
| تتبع الطرود | `tracking.html` | تتبّع طرد/عدة طرود، ملاحظات، طلب إرجاع، ملصق PDF |
| المرتجعات | `returns.html` | طلب إرجاع + تأكيد الاستلام (`valid/returns`) |
| المنتجات | `products.html` | منتجات + تصنيفات + استيراد منتجات Ecotrack |
| العملاء | `customers.html` | سجل العملاء مع عدد الطلبيات وإجمالي المشتريات |
| التقارير | `reports.html` | حسب اليوم/الولاية/المنتج/الحالة + تصدير CSV |
| الإعدادات | `settings.html` | بيانات المتجر، إعدادات الطلبيات، المستخدمون، كلمة المرور، السجل |
| تتبّع الزبون | `track.html` | صفحة عمومية — يدخل الزبون رقم التتبع ويرى الحالة |

---

## 5. تغطية Ecotrack API (21/21)

| # | Method | Endpoint Ecotrack | الاستخدام في المشروع | API المحلي |
|---|---|---|---|---|
| 1 | GET | `/api/v1/validate/token` | زر «اختبار الاتصال» | `POST /api/ecotrack/test` |
| 2 | GET | `/api/v1/` | عرض حد الطلبات | `GET /api/ecotrack/rate-limit` |
| 3 | POST | `/api/v1/create/order` | إرسال طلبية | `POST /api/orders/:id/push` |
| 4 | POST | `/api/v1/create/orders` | إرسال جماعي (≤100) | `POST /api/orders/bulk-push` |
| 5 | POST | `/api/v1/update/order` | تعديل عند Ecotrack | `POST /api/orders/:id/update-ecotrack` |
| 6 | DELETE | `/api/v1/delete/order` | حذف من Ecotrack | `DELETE /api/orders/:id/ecotrack` |
| 7 | POST | `/api/v1/valid/order` | مصادقة وشحن | `POST /api/orders/:id/validate` |
| 8 | POST | `/api/v1/valid/returns` | تأكيد استلام المرتجعات | `POST /api/ecotrack/valid-returns` |
| 9 | GET | `/api/v1/get/order/label` | ملصق PDF | `GET /api/orders/:id/label` |
| 10 | POST | `/api/v1/add/maj` | إضافة ملاحظة | `POST /api/orders/:id/maj` |
| 11 | GET | `/api/v1/get/maj` | قراءة الملاحظات | `GET /api/orders/:id/maj` |
| 12 | POST | `/api/v1/ask/for/order/return` | طلب إرجاع | `POST /api/orders/:id/ask-return` |
| 13 | GET | `/api/v1/get/tracking/info` | تتبّع طرد | `GET /api/ecotrack/tracking/:tracking` |
| 14 | GET | `/api/v1/get/trackings/info` | تتبّع ≤100 | `POST /api/ecotrack/trackings` |
| 15 | GET | `/api/v1/get/orders` | استيراد الطلبيات | `POST /api/orders/import-ecotrack` |
| 16 | GET | `/api/v1/get/orders/status` | مزامنة الحالات | `POST /api/orders/sync-status` |
| 17 | GET | `/api/v1/get/wilayas` | مزامنة الولايات | `POST /api/ecotrack/sync/wilayas` |
| 18 | GET | `/api/v1/get/desks` | مزامنة المكاتب | `POST /api/ecotrack/sync/desks` |
| 19 | GET | `/api/v1/get/communes` | مزامنة البلديات | `POST /api/ecotrack/sync/communes` |
| 20 | GET | `/api/v1/get/fees` | مزامنة الأسعار | `POST /api/ecotrack/sync/fees` |
| 21 | GET | `/api/v1/get/products/list` | مزامنة المنتجات | `POST /api/ecotrack/sync/products` |

التفاصيل الكاملة لكل endpoint (المعاملات، الأخطاء، الحالات) في **[docs/ECOTRACK.md](docs/ECOTRACK.md)**.

---

## 6. API المحلي (للتوسعة)

```
POST   /api/auth/login · /logout · /me · /password · /users
GET    /api/dashboard?days=30
GET    /api/reports?from=&to=
GET    /api/orders?...            POST /api/orders            PUT /api/orders/:id   DELETE /api/orders/:id
POST   /api/orders/bulk-push      POST /api/orders/sync-status
POST   /api/orders/:id/{push,validate,update-ecotrack,sync,maj,ask-return}
DELETE /api/orders/:id/ecotrack   GET  /api/orders/:id/label   POST /api/orders/quote
GET    /api/catalog/products      POST|PUT|DELETE /api/catalog/products[/:id]
GET    /api/catalog/categories    POST|PUT|DELETE /api/catalog/categories[/:id]
GET    /api/customers             POST|PUT|DELETE /api/customers[/:id]
GET    /api/geo/{bootstrap,wilayas,communes,desks,fees,products}
GET    /api/ecotrack/{status,rate-limit,wilayas,communes,desks,fees,products,orders,orders-status}
POST   /api/ecotrack/{test,create-order,create-orders,update-order,valid-order,valid-returns,maj,ask-return,trackings}
POST   /api/ecotrack/sync/{wilayas,communes,desks,fees,products,all}
GET    /api/settings · PUT /api/settings/:group · GET /api/settings/logs
GET    /api/public/status · /api/public/track?tracking=…   (بدون مصادقة)
```

كل المسارات (ما عدا `/api/public/*`) تتطلب `Authorization: Bearer <session-token>`.

---

## 7. هيكل المشروع

```
sitycom/
├── api/                  # ⭐ باكند PHP للاستضافة المشتركة (نفس مسارات الـ API)
│   ├── index.php         # الموجّه
│   ├── config.php · config.local.php (غير مرفوع)
│   ├── setup.php         # صفحة التثبيت
│   ├── lib/              # db.php (PDO + مخطط) · ecotrack.php · util.php · geo.php
│   └── routes/           # auth · orders · catalog · eco · misc · helpers
├── database/
│   ├── supabase.sql         # ⭐ مخطط Supabase (PostgreSQL) — يُنفذ مرة واحدة في SQL Editor
│   └── mysql.sql            # مخطط MySQL لنسخة PHP (للاستيراد اليدوي)
├── server/
│   ├── index.js              # الخادم + المسارات العامة
│   ├── db.js                 # طبقة بيانات Supabase (العميل + البذرة + الإعدادات)
│   ├── lib/
│   │   ├── ecotrack.js       # ⭐ عميل Ecotrack الكامل (21 endpoint + Mock)
│   │   ├── auth.js · util.js · env.js
│   ├── routes/               # auth · orders · catalog · customers · ecotrack · geo · dashboard · settings
│   └── data/geo.js           # الولايات (58) + بلديات + أسعار تجريبية
├── public/
│   ├── *.html                # 12 صفحة
│   └── assets/
│       ├── css/app.css       # نظام التصميم (RTL/LTR)
│       └── js/
│           ├── i18n.js       # ar / fr / en
│           ├── api.js · ui.js · shell.js
│           └── pages/*.js
├── docs/ECOTRACK.md          # مرجع API الكامل
├── .htaccess                 # يُنسخ إلى htdocs عند الرفع
└── .env                      # SUPABASE_URL + SUPABASE_ANON_KEY (غير مرفوع)
```

---

## 8. تدفّق العمل المقترح

1. أنشئ المنتجات (أو استوردها من Ecotrack).
2. من «لوحة الشحن»: أدخل الرابط والتوكن ← اختبار ← مزامنة شاملة.
3. أنشئ الطلبية (تُحتسب رسوم التوصيل تلقائياً من أسعار ولايتك).
4. من «الطلبيات»: **إرسال إلى Ecotrack** ← يظهر رقم التتبع ← **مصادقة وشحن** ← **ملصق PDF**.
5. تابع الحالة بزر **مزامنة** (أو المزامنة الجماعية) — تُحدَّث الحالة والسجل الزمني تلقائياً.
6. عند الإرجاع: **طلب إرجاع** ثم **تأكيد الاستلام** من شاشة المرتجعات.

---

## 9. ملاحظات أمنية

- لا تُرفع ملفات `.env` أو `data/*.db` إلى Git (مستثناة في `.gitignore`).
- غيّر كلمة المرور الافتراضية `admin123` من الإعدادات بعد أول دخول.
- التوكن يُخزَّن في قاعدة البيانات محلياً ويُعرض مقنّعاً في الواجهة
  (`OijXEU••••••••k8gv2u`). لا يُرسل إلى المتصفح كاملاً.
- كل طلبات Ecotrack تمرّ عبر الخادم (لا CORS ولا كشف للتوكن في المتصفح).

---

## 10. استكشاف الأخطاء

| المشكلة | السبب والحل |
|---|---|
| «إعدادات Ecotrack غير مكتملة» | أدخل الرابط والتوكن في لوحة الشحن |
| `10002 Pas de livraison pour la wilaya` | الولاية غير مفعّلة في حسابك — استخدم `get/wilayas` |
| `10001 Commande non modifiable` | الطلبية صُودق عليها؛ لا يمكن تعديلها/حذفها |
| `422 The given data was invalid` | اسم البلدية غير مطابق تماماً لقائمة Ecotrack — استخدم زر المزامنة واختر من القائمة |
| `429 Too Many Attempts` | تجاوزت 50 طلب/دقيقة — انتظر قليلاً |
| خطأ في القاعدة | نفّذ `database/supabase.sql` في SQL Editor، وتحقق من `SUPABASE_URL` و`SUPABASE_ANON_KEY` في `.env`، وافتح `/api/health` |

---

© Sitycom — مبني لربط التجارة الإلكترونية الجزائرية بشركات التوصيل.
