// ════════════════════════════════════════════════════════════════════
//  استيراد الطلبيات المنشأة في منصة شركة التوصيل (Ecotrack) إلى المتجر
//  يُستعمل من:
//    • POST /api/orders/import-ecotrack   (يدوي)
//    • POST /api/orders/auto-sync         (تلقائي عند فتح صفحة الطلبيات)
// ════════════════════════════════════════════════════════════════════
import { supabase, must, getSetting, setSetting } from '../db.js';
import { now, num, bool01 } from './util.js';
import * as ecotrack from './ecotrack.js';

/** الحالات التي تعني أن المبلغ حُصِّل */
const COLLECTED = ['encaisse_non_paye', 'paiements_prets', 'paye_et_archive'];

/** يقرأ حقلًا من رد Ecotrack مع كل التسميات البديلة الممكنة */
function pick(row, ...names) {
  for (const n of names) {
    const v = row?.[n];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

/** يحوّل سطر Ecotrack إلى الشكل الداخلي للمتجر */
export function mapEcotrackRow(row) {
  const tracking = String(pick(row, 'tracking', 'tracking_number', 'code')).trim();
  const montant = num(pick(row, 'montant', 'total', 'prix', 'amount'), 0);
  const fee = num(pick(row, 'tarif_prestation', 'tarif', 'delivery_fee', 'frais'), 0);
  const stopDesk = bool01(pick(row, 'stop_desk', 'stopdesk', 'is_stopdesk'));
  return {
    tracking,
    reference: String(pick(row, 'reference', 'ref', 'order_reference')),
    customer_name: String(pick(row, 'client', 'nom_client', 'customer', 'nom')) || 'عميل من شركة التوصيل',
    phone: String(pick(row, 'phone', 'telephone', 'tel', 'phone_1')),
    phone2: String(pick(row, 'phone_2', 'telephone_2', 'tel2', 'phone2')),
    wilaya_id: num(pick(row, 'wilaya_id', 'code_wilaya', 'wilaya'), 0) || null,
    commune: String(pick(row, 'commune', 'nom_commune', 'city')),
    address: String(pick(row, 'adresse', 'address', 'adress')),
    stop_desk: stopDesk,
    desk_name: String(pick(row, 'desk', 'desk_name', 'hub_name', 'point_relais')),
    montant,
    delivery_fee: fee,
    subtotal: Math.max(0, montant - fee),
    status: String(pick(row, 'status', 'statut', 'etat')) || 'prete_a_expedier',
    produit: String(pick(row, 'products', 'produit', 'product', 'articles')),
    quantite: String(pick(row, 'quantite', 'quantity', 'qty')),
    type: num(pick(row, 'type_id', 'type'), 1),
    weight: num(pick(row, 'weight', 'poids'), 0),
    fragile: bool01(pick(row, 'fragile')),
    remarque: String(pick(row, 'remarque', 'note', 'notes', 'commentaire')),
    created_at_remote: String(pick(row, 'date_creation', 'created_at', 'date')),
    raw: row,
  };
}

/**
 * يستورد/يحدّث طلبية واحدة قادمة من شركة التوصيل.
 * @returns {'imported'|'updated'|'skipped'}
 */
export async function upsertRemoteOrder(m, { source = 'ecotrack' } = {}) {
  if (!m.tracking) return 'skipped';

  const existing = must(
    await supabase.from('shipments').select('order_id, ecotrack_status').eq('tracking', m.tracking).maybeSingle(),
    'import.find',
  );

  // ── موجودة: نحدّث الحالة فقط (لا نلمس بيانات حرّرها المستخدم) ──
  if (existing) {
    if (existing.ecotrack_status === m.status) return 'skipped';
    must(
      await supabase.from('shipments').update({
        ecotrack_status: m.status,
        synced_at: now(),
        raw: JSON.stringify(m.raw),
      }).eq('tracking', m.tracking),
      'import.update.shipment',
    );
    must(
      await supabase.from('orders').update({
        status: m.status,
        payment_status: COLLECTED.includes(m.status) ? 'collected' : 'unpaid',
        updated_at: now(),
      }).eq('id', existing.order_id),
      'import.update.order',
    );
    return 'updated';
  }

  // ── جديدة: ننشئها كاملة ──
  const wilaya = m.wilaya_id
    ? must(await supabase.from('wilayas').select('name_fr, name_ar').eq('wilaya_id', m.wilaya_id).maybeSingle(), 'import.wilaya')
    : null;

  let orderNum = m.reference || `ECO-${m.tracking}`;
  const clash = must(
    await supabase.from('orders').select('id').eq('order_number', orderNum).maybeSingle(),
    'import.numcheck',
  );
  if (clash) orderNum = `${orderNum}-${m.tracking}`;

  // ربط العميل بسجل موجود عبر الهاتف، أو إنشاء سجل جديد
  let customerId = null;
  if (m.phone) {
    const c = must(
      await supabase.from('customers').select('id').eq('phone', m.phone).maybeSingle(),
      'import.customer.find',
    );
    if (c) {
      customerId = c.id;
    } else {
      const created = must(
        await supabase.from('customers').insert({
          name: m.customer_name,
          phone: m.phone,
          phone2: m.phone2 || '',
          wilaya_id: m.wilaya_id,
          commune: m.commune,
          address: m.address,
          created_at: now(),
        }).select('id').single(),
        'import.customer.create',
      );
      customerId = Number(created.id);
    }
  }

  const stamp = now();
  const orderRow = must(
    await supabase.from('orders').insert({
      order_number: orderNum,
      customer_id: customerId,
      customer_name: m.customer_name,
      phone: m.phone,
      phone2: m.phone2,
      wilaya_id: m.wilaya_id,
      wilaya_name: wilaya ? wilaya.name_fr : '',
      commune: m.commune,
      address: m.address,
      stop_desk: m.stop_desk,
      desk_name: m.desk_name || '',
      subtotal: m.subtotal,
      shipping_fee: m.delivery_fee,
      discount: 0,
      total: m.montant,
      status: m.status,
      payment_status: COLLECTED.includes(m.status) ? 'collected' : 'unpaid',
      source,
      notes: m.remarque || `مستوردة تلقائيًا من شركة التوصيل (${m.tracking})`,
      created_at: stamp,
      updated_at: stamp,
    }).select('id').single(),
    'import.order',
  );
  const orderId = Number(orderRow.id);

  // البنود: نحاول تفكيك "اسم x2 / اسم آخر x1"
  const items = parseProducts(m.produit, m.subtotal);
  must(
    await supabase.from('order_items').insert(items.map((it) => ({
      order_id: orderId,
      product_id: null,
      name: it.name,
      sku: '',
      qty: it.qty,
      unit_price: it.unit_price,
      line_total: it.qty * it.unit_price,
    }))),
    'import.items',
  );

  must(
    await supabase.from('shipments').insert({
      order_id: orderId,
      tracking: m.tracking,
      reference: orderNum,
      type: m.type,
      stop_desk: m.stop_desk,
      produit: m.produit,
      quantite: m.quantite,
      weight: m.weight,
      fragile: m.fragile,
      remarque: m.remarque,
      ecotrack_status: m.status,
      delivery_fee: m.delivery_fee,
      pushed_at: stamp,
      synced_at: stamp,
      raw: JSON.stringify(m.raw),
    }),
    'import.shipment',
  );

  return 'imported';
}

/** يفكّك نص المنتجات "قميص x2 / حذاء x1" إلى بنود */
export function parseProducts(text, totalValue = 0) {
  const raw = String(text || '').trim();
  if (!raw) return [{ name: 'منتج', qty: 1, unit_price: totalValue }];
  const parts = raw.split(/\s*[/،,|]\s*/).filter(Boolean);
  const parsed = parts.map((p) => {
    const mm = p.match(/^(.*?)\s*[x×*]\s*(\d+)$/i);
    return mm
      ? { name: mm[1].trim() || 'منتج', qty: Math.max(1, Number(mm[2]) || 1) }
      : { name: p.trim(), qty: 1 };
  });
  const totalQty = parsed.reduce((a, b) => a + b.qty, 0) || 1;
  const unit = totalValue > 0 ? Math.round((totalValue / totalQty) * 100) / 100 : 0;
  return parsed.map((p) => ({ ...p, unit_price: unit }));
}

/**
 * يسحب الطلبيات من شركة التوصيل ويستوردها.
 * @param {{pages?:number, start_date?:string, end_date?:string, source?:string}} opts
 */
export async function importFromCarrier(opts = {}) {
  const { pages = 1, start_date, end_date, source = 'ecotrack' } = opts;
  const maxPages = Math.min(20, Math.max(1, Number(pages) || 1));
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  let mock = false;

  for (let p = 1; p <= maxPages; p += 1) {
    let r;
    try {
      r = await ecotrack.getOrders({ page: p, start_date, end_date });
    } catch (err) {
      errors.push(`صفحة ${p}: ${err.message}`);
      break;
    }
    mock = mock || Boolean(r.mock);
    const rows = r.data?.data || (Array.isArray(r.data) ? r.data : []);
    if (!rows.length) break;

    for (const row of rows) {
      try {
        const result = await upsertRemoteOrder(mapEcotrackRow(row), { source });
        if (result === 'imported') imported += 1;
        else if (result === 'updated') updated += 1;
        else skipped += 1;
      } catch (err) {
        errors.push(`${row?.tracking || '?'}: ${err.message}`);
      }
    }
    // احترام حد 50 طلب/دقيقة
    if (p < maxPages) await new Promise((r2) => setTimeout(r2, 150));
  }

  return { imported, updated, skipped, errors, mock };
}

/** آخر وقت مزامنة تلقائية (لمنع الإفراط في استهلاك الحصة) */
export async function getAutoSyncState() {
  return (await getSetting('auto_sync', {})) || {};
}

export async function setAutoSyncState(patch) {
  const cur = await getAutoSyncState();
  await setSetting('auto_sync', { ...cur, ...patch });
}
