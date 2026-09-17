#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
//  رفع الأسرار إلى Cloudflare Workers دفعة واحدة من ملف .env
//  الاستعمال:  npm run cf:secrets
//  (يتطلب تسجيل الدخول:  npx wrangler login   أو  CLOUDFLARE_API_TOKEN)
// ════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

// الأسرار المدعومة (لا تُرفع القيم الفارغة)
const KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'ECOTRACK_BASE_URL',
  'ECOTRACK_API_TOKEN',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
];

if (!fs.existsSync(ENV_FILE)) {
  console.error('✘ لا يوجد ملف .env — انسخ .env.example إلى .env واملأ القيم أولًا.');
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, eq).trim()] = v;
}

const todo = KEYS.filter((k) => env[k]);
if (!todo.length) {
  console.error('✘ لا توجد قيم صالحة في .env من بين: ' + KEYS.join(', '));
  process.exit(1);
}

console.log('رفع ' + todo.length + ' سر إلى Cloudflare…\n');
let failed = 0;
for (const key of todo) {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', key], {
    input: env[key],
    cwd: ROOT,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (r.status === 0) {
    console.log(`  ✔ ${key}`);
  } else {
    console.error(`  ✘ ${key} — فشل الرفع`);
    failed++;
  }
}

console.log(failed ? `\nانتهى مع ${failed} خطأ.` : '\n✔ تم رفع كل الأسرار. شغّل الآن: npm run cf:deploy');
process.exit(failed ? 1 : 0);
