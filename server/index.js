// ════════════════════════════════════════════════════════════════════
//  نقطة الدخول لبيئة Node.js التقليدية (npm start / npm run dev)
//  لبيئة Cloudflare Workers انظر: worker/index.js
// ════════════════════════════════════════════════════════════════════
import './lib/env.js';
import app, { bootstrap, finalize } from './app.js';
import * as ecotrack from './lib/ecotrack.js';

finalize({ static: true });

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  await bootstrap().catch((err) => console.error('⚠️  فشل التهيئة:', err.message));

  app.listen(PORT, HOST, async () => {
    console.log('─'.repeat(60));
    console.log('  Sitycom — منصة التجارة الإلكترونية + Ecotrack');
    console.log('  القاعدة:  Supabase (PostgreSQL)');
    console.log(`  الخادم:   http://localhost:${PORT}`);
    console.log(`  لوحة التحكم: http://localhost:${PORT}/`);
    if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
      console.log(`  الدخول: ${process.env.ADMIN_USERNAME}`);
    } else {
      console.log(`  إنشاء حساب: http://localhost:${PORT}/register.html`);
    }
    try {
      const cfg = await ecotrack.getConfig();
      console.log(`  Ecotrack: ${cfg.configured && !cfg.mock ? cfg.baseUrl : 'وضع تجريبي (Mock) — أدخل الرابط والتوكن من الإعدادات'}`);
    } catch {
      console.log('  Ecotrack: تعذّر قراءة الإعدادات من القاعدة');
    }
    console.log('─'.repeat(60));
  });
}

start().catch((err) => {
  console.error('⚠️  فشل الإقلاع:', err.message);
  app.listen(PORT, HOST, () => console.error(`  الخادم يعمل على ${PORT} بدون قاعدة بيانات`));
});
