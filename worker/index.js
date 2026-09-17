// ════════════════════════════════════════════════════════════════════
//  Sitycom على Cloudflare Workers
//  ─ الواجهة (public/) تُقدَّم عبر Static Assets  → binding: ASSETS
//  ─ مسارات /api/* تمرّ إلى تطبيق Express نفسه عبر node:http bridge
//  المتطلبات: compatibility_flags = ["nodejs_compat"]
//             compatibility_date  >= 2025-08-15
// ════════════════════════════════════════════════════════════════════
import { httpServerHandler } from 'cloudflare:node';
import app, { bootstrap, finalize } from '../server/app.js';

// على Workers لا يوجد نظام ملفات: لا express.static — الأصول عبر ASSETS
finalize({ static: false });

const PORT = 8787;
const server = app.listen(PORT);
const nodeHandler = httpServerHandler({ port: PORT });

/** ينقل أسرار/متغيرات Cloudflare إلى process.env ليقرأها كود الخادم كما هو */
let envApplied = false;
function applyEnv(env) {
  if (envApplied) return;
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value === 'string' && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  envApplied = true;
}

let booted = null;

export default {
  async fetch(request, env, ctx) {
    applyEnv(env);

    const url = new URL(request.url);

    // 1) الأصول الثابتة (HTML/CSS/JS) — تُخدَم مباشرة من شبكة Cloudflare
    if (!url.pathname.startsWith('/api/') && env.ASSETS) {
      const res = await env.ASSETS.fetch(request);
      if (res.status !== 404) return res;
    }

    // 2) التهيئة (بذرة القاعدة + تنظيف الجلسات) مرة واحدة لكل عزل
    if (!booted) booted = bootstrap().catch((err) => console.error('[boot]', err.message));
    ctx.waitUntil(booted);

    // 3) مسارات API عبر Express
    return nodeHandler.fetch(request, env, ctx);
  },
};

export { server };
