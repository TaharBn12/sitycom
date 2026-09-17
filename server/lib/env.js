// محمّل بسيط لملف .env (بدون اعتماديات خارجية)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let envPath = '';
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  envPath = path.join(__dirname, '..', '..', '.env');
} catch { /* بيئة بدون نظام ملفات (Cloudflare Workers) */ }

export function loadEnv(file = envPath) {
  if (!file) return false;
  // على Cloudflare Workers لا يوجد نظام ملفات — تأتي القيم من الأسرار/المتغيرات
  let raw;
  try {
    if (!fs.existsSync(file)) return false;
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

try { loadEnv(); } catch { /* بيئة بدون نظام ملفات (Cloudflare Workers) */ }
