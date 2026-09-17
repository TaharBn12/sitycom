# النشر على Cloudflare Workers

الموقع بالكامل (الواجهة + الخادم + API) يعمل على Cloudflare Workers:

| المكوّن | الطريقة |
|---|---|
| الواجهة `public/` | Cloudflare **Static Assets** (binding `ASSETS`) — تُخدم من شبكة Cloudflare مباشرة |
| الخادم `/api/*` | تطبيق **Express** نفسه عبر جسر `node:http` (`httpServerHandler`) |
| قاعدة البيانات | **Supabase** عبر REST (يعمل من داخل Workers بلا مشاكل) |

---

## 1. المتطلبات

- حساب Cloudflare (الخطة المجانية كافية)
- مشروع Supabase مع تنفيذ `database/supabase.sql` مرة واحدة في SQL Editor
- Node.js ≥ 22

```bash
npm install
```

---

## 2. تسجيل الدخول إلى Cloudflare

**الطريقة أ — عبر المتصفح:**
```bash
npx wrangler login
```

**الطريقة ب — عبر مفتاح API (بدون متصفح):**

أنشئ توكن من: Cloudflare Dashboard → My Profile → API Tokens → *Create Token* → قالب **Edit Cloudflare Workers**.

ثم ضعه في `.env`:
```env
CLOUDFLARE_API_TOKEN=xxxxxxxxxxxxxxxxxxxx
CLOUDFLARE_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxx
```
(الـ Account ID موجود في الشريط الجانبي لصفحة Workers & Pages.)

---

## 3. ضبط الأسرار

الأسرار **لا تُكتب في `wrangler.toml`** ولا تُرفع إلى Git.

**تلقائيًا من ملف `.env`:**
```bash
npm run cf:secrets
```

**أو يدويًا:**
```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put ECOTRACK_BASE_URL     # اختياري
npx wrangler secret put ECOTRACK_API_TOKEN    # اختياري
```

> `ADMIN_USERNAME` / `ADMIN_PASSWORD` اختياريان. إذا تُركا فارغين، أنشئ أول حساب من صفحة `/register.html` وسيصبح **مديرًا** تلقائيًا.

---

## 4. التجربة محليًا

```bash
npm run cf:dev        # محاكاة بيئة Workers الحقيقية (workerd)
```
افتح: http://localhost:8787

للتشغيل بـ Node العادي بدل Workers:
```bash
npm run dev
```

---

## 5. النشر

```bash
npm run cf:check      # فحص البناء بدون نشر
npm run cf:deploy     # النشر الفعلي
```

الموقع سيكون على:
```
https://sitycom.<your-subdomain>.workers.dev
```

### ربط نطاق خاص
في Cloudflare Dashboard → Workers & Pages → `sitycom` → **Settings** → **Domains & Routes** → *Add Custom Domain*.

---

## 6. النشر الآلي من GitHub

ملف `.github/workflows/deploy-cloudflare.yml` جاهز. أضف في:
**GitHub → Settings → Secrets and variables → Actions**

| السر | القيمة |
|---|---|
| `CLOUDFLARE_API_TOKEN` | توكن Workers |
| `CLOUDFLARE_ACCOUNT_ID` | معرّف الحساب |

أي دفعة (push) إلى `main` أو `arena/**` تنشر تلقائيًا.

---

## 7. ملاحظات تقنية

- `compatibility_flags = ["nodejs_compat"]` و `compatibility_date >= 2025-08-15` مطلوبان لدعم `node:http`.
- `run_worker_first = ["/api/*"]` يضمن أن مسارات API تذهب إلى Express وليس إلى الأصول الثابتة.
- عميل Supabase يُنشأ **كسولًا** عند أول استعمال، لأن متغيرات البيئة غير متاحة وقت تقييم الوحدات على Workers.
- `express.static` مُعطَّل على Workers (لا نظام ملفات) — الأصول عبر `env.ASSETS`.
- `public/config.js` يجب أن يبقى `window.API_BASE = ""` لأن الواجهة والـAPI على نفس النطاق.

## 8. حل المشاكل

| العطل | الحل |
|---|---|
| `إعدادات Supabase ناقصة` من `/api/health` | لم تُرفع الأسرار — شغّل `npm run cf:secrets` |
| خطأ 1101 / Worker threw exception | افحص السجلات: `npx wrangler tail` |
| الواجهة تظهر لكن API يرجع 404 | تأكد من `run_worker_first = ["/api/*"]` في `wrangler.toml` |
