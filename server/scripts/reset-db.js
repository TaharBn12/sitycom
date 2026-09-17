import { resetDb, DB_PATH } from '../db.js';
import fs from 'node:fs';

for (const suffix of ['', '-wal', '-shm']) {
  const p = DB_PATH + suffix;
  if (fs.existsSync(p)) fs.rmSync(p);
}
resetDb();
console.log('✔ تمت إعادة تهيئة قاعدة البيانات والبيانات التجريبية');
process.exit(0);
