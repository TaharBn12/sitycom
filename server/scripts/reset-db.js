import '../lib/env.js';
import { resetDb } from '../db.js';

try {
  await resetDb();
  console.log('✔ تمت إعادة تهيئة قاعدة البيانات على Supabase مع البيانات التجريبية');
  process.exit(0);
} catch (err) {
  console.error('✖ فشلت إعادة التهيئة:', err.message);
  process.exit(1);
}
