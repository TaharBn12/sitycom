# مرجع Ecotrack API v1 — التوثيق الكامل

> المصدر: [ECOTRACK API — Postman Documenter](https://documenter.getpostman.com/view/14517169/Tz5je15g)
> هذا الملف هو المرجع المعتمد داخل مشروع Sitycom، ويقابله التنفيذ في `server/lib/ecotrack.js`.

## 0. أساسيات

| العنصر | القيمة |
|---|---|
| الرابط الأساسي | `https://{tenant}.ecotrack.dz` (لكل شركة نطاقها) |
| المسار | `/api/v1/…` |
| المصادقة | `Authorization: Bearer {api_token}` |
| استثناءات | `validate/token` و `get/orders/status` تستقبلان `api_token` كـ **query param** |
| حد الطلبات | 50/دقيقة · 1500/ساعة · 15000/يوم → `429 {"message":"Too Many Attempts."}` |
| الترويسات | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Limit-Day`, `X-RateLimit-Remaining-Day`, `X-RateLimit-Limit-Hour`, `X-RateLimit-Remaining-Hour`, `Retry-After` |
| اللغة | أسماء الحقول فرنسية snake_case |

### أشكال الأخطاء (يجب التعامل مع الاثنين)

```jsonc
// HTTP 422 — حقيبة تحقق Laravel
{ "message": "The given data was invalid.", "errors": { "telephone": ["Le champ téléphone est obligatoire."] } }

// HTTP 200 مع فشل تجاري
{ "success": false, "error": 10002, "message": "Pas de livraison pour la wilaya sélectionnée" }
```

| الرمز | المعنى |
|---|---|
| `10001` | الطلبية غير قابلة للتعديل (تمت مصادقتها/شحنها) |
| `10002` | لا يوجد توصيل للولاية المختارة |
| `10003` | لا يمكن طلب الإرجاع لهذه الطلبية |

### أنواع الطلبية (`type`)

| القيمة | المعنى |
|---|---|
| 1 | توصيل — Livraison |
| 2 | تبديل — Échange |
| 3 | استلام — Pickup |
| 4 | تحصيل — Recouvrement |

### الحالات الرسمية (`get/orders/status`)

```
prete_a_expedier · en_ramassage · en_preparation_stock · vers_hub · en_hub · vers_wilaya
en_preparation · en_livraison · suspendu · livre_non_encaisse · encaisse_non_paye
paiements_prets · paye_et_archive · retour_chez_livreur · retour_transit_entrepot
retour_en_traitement · retour_recu · retour_archive · annule · all
```

### أحداث التتبع (`activity[].status`)

| المفتاح | المعنى |
|---|---|
| `order_information_received_by_carrier` | تسجيل الطلبية والمصادقة عليها |
| `notification_on_order` | ملاحظة جديدة (maj) |
| `picked` | استلام من المرسِل |
| `accepted_by_carrier` | استلام في مركز الفرز |
| `dispatched_to_driver` | إرسال إلى الموصّل |
| `attempt_delivery` | محاولة توصيل |
| `return_asked` | بدء الإرجاع |
| `return_in_transit` | الإرجاع في الطريق |
| `Return_received` | استلام المرسِل للإرجاع |
| `livred` | تم التوصيل |
| `encaissed` | تحصيل المبلغ |
| `payed` | تحويل الدفعة للبائع |

---

## 1. `GET /api/v1/validate/token`

المعاملات: `api_token` (query).

```jsonc
{ "success": true,  "message": "VALID_TOKEN" }
{ "success": false, "message": "INVALID_TOKEN" }
{ "success": false, "message": "TOKEN_NOT_ALLOWED" }
```

## 2. `GET /api/v1/`

يعيد معلومات حد الطلبات (ترويسات `X-RateLimit-*`).

## 3. `POST /api/v1/create/order`

**كل المعاملات في الـ query string — لا يوجد جسم طلب.**

| المعامل | النوع | إلزامي | ملاحظة |
|---|---|:--:|---|
| `reference` | string ≤255 | | المرجع الداخلي (يُستخدم مفتاحاً في نتائج الإنشاء الجماعي) |
| `nom_client` | string ≤255 | ✔ | اسم المستلم |
| `telephone` | 9–10 أرقام | ✔ | |
| `telephone_2` | 9–10 أرقام | | |
| `adresse` | string ≤255 | ✔ | |
| `code_postal` | numeric | | رمز المكتب لطلبيات Stop Desk |
| `commune` | string ≤255 | ✔ | اسم البلدية (مطابق تماماً لقائمة الحساب) |
| `code_wilaya` | 1–58 | ✔ | |
| `montant` | numeric | ✔ | المبلغ المطلوب تحصيله (شامل رسوم التوصيل) |
| `type` | 1–4 | ✔ | |
| `stop_desk` | 0/1 | | 0 منزلي · 1 مكتب |
| `produit` | string ≤255 | | الأسماء، أو المراجع مفصولة بفاصلة عند `stock=1` |
| `stock` | 0/1 | | الطلبية من مخزون الشركة |
| `quantite` | string | ✔ إن `stock=1` | كميات مفصولة بفاصلة |
| `produit_a_recuperer` | string ≤255 | | لطلبيات التبديل |
| `boutique` | string ≤255 | | اسم المتجر (حسابات متعددة المتاجر) |
| `remarque` | string ≤255 | | ملاحظات التوصيل |
| `weight` | numeric | | الوزن بالكيلوغرام |
| `fragile` | 0/1 | | قابل للكسر |
| `gps_link` | URL | | موقع الزبون |

```jsonc
{ "success": true, "tracking": "ECQFLD2103047673" }
```

## 4. `POST /api/v1/create/orders` — جماعي (≤100)

الجسم كائن **مُرقّم** (ليس مصفوفة):

```json
{ "orders": { "0": { "reference": "DEMO852", "nom_client": "Client 1", "telephone": "0500000000",
                     "adresse": "…", "commune": "Oum Touyour", "code_wilaya": "5",
                     "montant": "5000", "type": "1", "stop_desk": 0, "stock": 1,
                     "produit": "tesrty", "quantite": "1", "weight": "2" } } }
```

النتائج مُفاتحها `reference` إن وُجد وإلا الفهرس:

```json
{ "results": { "DEMO852": { "telephone": ["Le champ téléphone est obligatoire."] },
               "DEMO853": { "success": true, "tracking": "ECTNYH2407062554" } } }
```

## 5. `POST /api/v1/update/order`

⚠️ **أسماء الحقول مختلفة عن الإنشاء**: `client` بدل `nom_client`، `tel` بدل `telephone`،
`tel2`, `wilaya` بدل `code_wilaya`, `product` بدل `produit`.
المعاملات: `tracking` (إلزامي) + البقية اختيارية قبل المصادقة.

```jsonc
{ "success": true, "message": "Commande modifiée avec succès" }
{ "success": false, "error": 10001, "message": "Commande non modifiable" }
```

## 6. `DELETE /api/v1/delete/order`

`?tracking=…` — قبل المصادقة فقط.
`{"success":true,"message":"Commande supprimée"}` (أو الصيغة القديمة `{"delete":"success"}`).

## 7. `POST /api/v1/valid/order`

`?tracking=…&ask_collection=1` — `ask_collection=1` يطلب استلام الطرد من مكانك.
يُقفل الطلبية: لا تعديل ولا حذف بعدها.
`{"success":true,"message":"Commande expedier avec succès"}`

## 8. `POST /api/v1/valid/returns`

الجسم: `{ "trackings": ["ECO-123", "ECO-456"] }`
`{"returned":"success"}` أو `{"returned":"fail"}` (لا شيء مؤهَّل).

## 9. `GET /api/v1/get/order/label`

`?tracking=…` — يعيد **بايتات PDF خام** (يحتاج Bearer).

## 10. `POST /api/v1/add/maj`

`?tracking=…&content=…` (≤255) — ملاحظة مرئية للشركة وللمرسِل.
`{"success":true,"message":"Mise a jour avec success"}`

## 11. `GET /api/v1/get/maj`

`?tracking=…` — مصفوفة JSON عادية:

```json
[{ "remarque": "Nom Boutique : contenu", "station": "", "livreur": "",
   "created_at": "2021-03-05 11:04:19", "tracking": "ECQFLD2103047673" }]
```

## 12. `POST /api/v1/ask/for/order/return`

`?tracking=…` — قد تتجاهل الشركة الطلب.
`{"success":true,"message":"Retour demandé avec succès"}` أو `error: 10003`.

## 13. `GET /api/v1/get/tracking/info`

`?tracking=…` — كائن (ليس مغلّفاً بـ `data`):

```jsonc
{ "recipientName": "client", "shippedBy": "Boutique", "originCity": 16,
  "destLocationCity": 16, "currentStation": "Médéa",
  "activity": [{ "date": "2021-03-04", "time": "22:32:47",
                 "status": "order_information_received_by_carrier",
                 "station": "", "scanLocation": "HUB" }],
  "reasons": [] }
```

## 14. `GET /api/v1/get/trackings/info`

`?trackings[]=A&trackings[]=B` (≤100) — نفس الأحداث + حالة فرنسية للعرض.

## 15. `GET /api/v1/get/orders`

`?page=&start_date=&end_date=&tracking=` — 40 طلبية/صفحة، آخر 90 يوماً، المؤرشفة مستثناة.

```jsonc
{ "tracking": "ECG4SU2112195902", "reference": "REF123", "client": "kas", "phone": "0560351041",
  "phone_2": null, "adresse": "Alger", "commune": "Ain Taya", "wilaya_id": 16,
  "montant": "500", "tarif_prestation": "400", "tarif_retour": "200", "type_id": 1,
  "created_at": "2021-12-19", "payment_id": 312, "return_id": null,
  "status": "prete_a_expedier", "products": "Prod 1" }
```

## 16. `GET /api/v1/get/orders/status`

⚠️ `api_token` كـ **query param**. `?trackings=A,B&status=en_livraison,suspendu` (≤100).
الرد `data` مُفاتحته أرقام التتبع، ويتضمن `activity` مع `reason`, `details`, `station`,
`driver`, `date`, `time`, `postponed_to`، وحقول المكتب عند Stop Desk.

## 17. `GET /api/v1/get/wilayas`

مصفوفة: `[{"wilaya_id":1,"wilaya_name":"Adrar"}, …]` — الولايات التي يوصّل إليها الحساب فقط.

## 18. `GET /api/v1/get/desks`

```jsonc
{ "my_desk": { "hub_id": 6, "hub_name": "Station Batna",
    "location": { "wilaya": "Batna", "commune": "Batna", "adresse": "…", "phone": "…",
                  "phone2": null, "email": "…", "map": "https://…" },
    "working_hours": [{ "days": "…", "hours": "09:00 - 17:00" }] },
  "other_desks": [{ "name": "Station Adrar", "phone": "…", "code_wilaya": "1",
                    "wilaya": "Adrar", "commune": "Adrar", "adresse": "…", "map": null }] }
```

## 19. `GET /api/v1/get/communes`

`?wilaya_id=` (اختياري) — **كائن مُرقّم**:

```json
{ "0": { "nom": "Abadla", "wilaya_id": 8, "code_postal": "817", "has_stop_desk": 0 } }
```

`has_stop_desk = 1` ⇒ البلدية فيها مكتب استلام، و`code_postal` هو رمز المكتب.

## 20. `GET /api/v1/get/fees`

أسعار حسابك لكل ولاية ولكل خدمة:

```jsonc
[{ "wilaya_id": 16, "wilaya_name": "Alger",
   "livraison":     { "tarif": "600", "tarif_stopdesk": "500" },
   "pickup":        { "tarif": "700", "tarif_stopdesk": "600" },
   "echange":       { "tarif": "800", "tarif_stopdesk": "700" },
   "recouvrement":  { "tarif": "300", "tarif_stopdesk": "250" },
   "retour":        { "tarif": "300", "tarif_stopdesk": "250" } }]
```

## 21. `GET /api/v1/get/products/list`

`?page=` — 15 منتجاً/صفحة:

```jsonc
{ "products": [{ "reference": "REF1", "barcode": "…", "title": "…", "is_active": 1,
                 "image": "", "stock_disponible": 20, "stock_reserve": 2, "stock_phisique": 20 }],
  "pagination": { "current_page": 1, "per_page": 15, "total": 8, "last_page": 1 } }
```

---

## ملاحظات تطبيقية (من واقع التنفيذ في هذا المشروع)

1. **أسماء البلديات** يجب أن تُنسخ حرفياً من `get/communes` — أشهر سبب لرفض الإنشاء.
2. **`montant`** يشمل رسوم التوصيل (المبلغ الذي يستلمه الموصّل من الزبون).
3. **اختلاف حقول `update/order`** عن `create/order` يتطلب mapper صريحاً (موجود في
   `server/routes/orders.js`: `buildCreateParams` / `buildUpdateParams`).
4. **التقسيم إلى دفعات 100** مطلوب في `create/orders` و`get/trackings/info`
   و`get/orders/status` (مطبّق في `bulk-push` و`sync-status`).
5. **الحالة مقابل الحدث**: `status` (19 قيمة) لحالة الطلبية المعروضة،
   و`activity` (12 حدثاً) للسجل الزمني — لا تخلطهما.
6. **المزامنة الدورية** يكفيها `get/orders/status?status=all` لآخر 100 طلبية كل بضع دقائق.
