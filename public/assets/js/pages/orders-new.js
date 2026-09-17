import { initShell } from '../shell.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import { el, clear, money, moneyWithCurrency, toast, field, modal } from '../ui.js';

const content = await initShell({ active: 'orders-new', title: 'orders.new' });
if (content) {
  const state = {
    wilayas: [], communes: [], desks: [], fees: [], products: [],
    items: [],
    shippingFee: 0,
    autoFee: true,
    stopDesk: false,
    type: 1,
    wilayaId: '',
    customerId: null,
  };
  window.__newOrder = state;

  try {
    const boot = await api.geoBootstrap();
    state.wilayas = boot.wilayas || [];
    state.communes = boot.communes || [];
    state.desks = boot.desks || [];
    state.fees = boot.fees || [];
  } catch (err) {
    toast(err.message, 'error');
  }
  try {
    const p = await api.products({ limit: 500, status: 'active' });
    state.products = p.products || [];
  } catch { /* ignore */ }

  build();
}

function build() {
  const s = window.__newOrder;
  clear(content);

  /* ── الزبون ─────────────────────────────────────────── */
  const cName = el('input', { type: 'text' });
  const cPhone = el('input', { type: 'text' });
  const cPhone2 = el('input', { type: 'text' });
  const searchResults = el('div', { class: 'flex mt-2' });

  const search = el('input', { type: 'text', placeholder: t('orders.customer_search') });
  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = search.value.trim();
    if (q.length < 2) return;
    searchTimer = setTimeout(async () => {
      try {
        const r = await api.searchCustomers(q);
        clear(searchResults);
        (r.customers || []).forEach((c) => {
          searchResults.appendChild(el('button', {
            class: 'btn btn-sm',
            text: `${c.name} — ${c.phone}`,
            onclick: () => {
              s.customerId = c.id;
              cName.value = c.name;
              cPhone.value = c.phone;
              cPhone2.value = c.phone2 || '';
              if (c.wilaya_id) { s.wilayaId = String(c.wilaya_id); wilayaSel.value = s.wilayaId; fillCommunes(); }
              communeInput.value = c.commune || '';
              address.value = c.address || '';
              clear(searchResults);
            },
          }));
        });
        searchResults.appendChild(el('button', {
          class: 'btn btn-sm btn-primary',
          text: t('orders.new_customer'),
          onclick: () => { s.customerId = null; cName.value = search.value; clear(searchResults); cName.focus(); },
        }));
      } catch { /* ignore */ }
    }, 300);
  });

  const customerCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h3', { text: t('orders.customer') })]),
    el('div', { class: 'card-body' }, [
      field('', search),
      searchResults,
      el('div', { class: 'form-row' }, [
        field(t('customers.name'), cName),
        field(t('orders.phone'), cPhone),
      ]),
      field(t('orders.phone2'), cPhone2),
    ]),
  ]);

  /* ── التوصيل ────────────────────────────────────────── */
  const wilayaSel = el('select');
  wilayaSel.appendChild(el('option', { value: '', text: t('common.select') }));
  s.wilayas.forEach((w) => wilayaSel.appendChild(el('option', { value: w.wilaya_id, text: `${w.wilaya_id} — ${w.name_ar || w.name_fr}` })));

  const communeInput = el('input', { type: 'text', list: 'commune-list' });
  const communeList = el('datalist', { id: 'commune-list' });
  const address = el('input', { type: 'text' });

  const fillCommunes = () => {
    clear(communeList);
    s.communes
      .filter((c) => String(c.wilaya_id) === String(s.wilayaId))
      .forEach((c) => communeList.appendChild(el('option', { value: c.name })));
  };

  const stopDeskBox = el('input', { type: 'checkbox' });
  stopDeskBox.addEventListener('change', () => {
    s.stopDesk = stopDeskBox.checked;
    deskBox.hidden = !stopDeskBox.checked;
    updateFee();
  });

  const deskSel = el('select');
  const fillDesks = () => {
    clear(deskSel);
    deskSel.appendChild(el('option', { value: '', text: t('common.select') }));
    const w = s.wilayas.find((x) => String(x.wilaya_id) === String(s.wilayaId));
    s.desks.forEach((d) => {
      if (!w || d.wilaya === w.name_fr) {
        deskSel.appendChild(el('option', { value: d.name, text: `${d.name}${d.commune ? ' — ' + d.commune : ''}` }));
      }
    });
  };

  const deskBox = el('div', { hidden: true }, [field(t('orders.desk'), deskSel)]);

  const gps = el('input', { type: 'url', placeholder: 'https://maps.app.goo.gl/…' });

  const wilayaWrap = el('div', { class: 'form-row' }, [
    field(t('orders.wilaya'), wilayaSel),
    field(t('orders.commune'), el('div', {}, [communeInput, communeList])),
  ]);

  wilayaSel.addEventListener('change', () => {
    s.wilayaId = wilayaSel.value;
    fillCommunes();
    fillDesks();
    updateFee();
  });

  /* ── المنتجات ───────────────────────────────────────── */
  const itemsBody = el('div');
  const renderItems = () => {
    clear(itemsBody);
    if (!s.items.length) {
      itemsBody.appendChild(el('div', { class: 'table-empty', text: t('common.no_data') }));
    } else {
      const table = el('table', { class: 'table' });
      table.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', { text: t('orders.product') }),
        el('th', { text: t('orders.qty') }),
        el('th', { text: t('orders.price') }),
        el('th', { text: t('common.total') }),
        el('th', { text: '' }),
      ])]));
      const tbody = el('tbody');
      s.items.forEach((it, idx) => {
        const qty = el('input', { type: 'number', value: it.qty, min: '1', style: { width: '80px' } });
        qty.addEventListener('change', () => { s.items[idx].qty = Math.max(1, Number(qty.value) || 1); updateTotals(); renderItems(); });
        const price = el('input', { type: 'number', value: it.unit_price, style: { width: '110px' } });
        price.addEventListener('change', () => { s.items[idx].unit_price = Number(price.value) || 0; updateTotals(); });
        tbody.appendChild(el('tr', {}, [
          el('td', { text: it.name }),
          el('td', {}, [qty]),
          el('td', {}, [price]),
          el('td', { class: 'num', text: money(it.qty * it.unit_price) }),
          el('td', {}, [el('button', {
            class: 'btn btn-xs btn-danger', text: '×',
            onclick: () => { s.items.splice(idx, 1); updateTotals(); renderItems(); },
          })]),
        ]));
      });
      table.appendChild(tbody);
      itemsBody.appendChild(el('div', { class: 'table-wrap' }, [table]));
    }
    updateTotals();
  };

  const productSel = el('select');
  productSel.appendChild(el('option', { value: '', text: t('orders.product') }));
  s.products.forEach((p) => productSel.appendChild(el('option', { value: p.id, text: `${p.name_ar} (${money(p.price)}) · ${p.stock}` })));

  const manualBtn = el('button', {
    class: 'btn btn-sm',
    text: `+ ${t('orders.add_item')}`,
    onclick: () => {
      const pid = productSel.value;
      if (pid) {
        const p = s.products.find((x) => String(x.id) === String(pid));
        s.items.push({ product_id: p.id, name: p.name_ar, sku: p.sku, qty: 1, unit_price: Number(p.price) });
      } else {
        s.items.push({ name: 'منتج', qty: 1, unit_price: 0 });
      }
      renderItems();
    },
  });

  /* ── خيارات الشحن ───────────────────────────────────── */
  const typeSel = el('select');
  [1, 2, 3, 4].forEach((n2) => typeSel.appendChild(el('option', { value: n2, text: t(`orders.type${n2}`) })));
  typeSel.addEventListener('change', () => { s.type = Number(typeSel.value); updateFee(); });

  const weight = el('input', { type: 'number', value: '1', step: '0.1' });
  const fragile = el('input', { type: 'checkbox' });
  const boutique = el('input', { type: 'text' });
  const stockFlag = el('input', { type: 'checkbox' });
  const quantite = el('input', { type: 'text', placeholder: '1,2,1' });
  const recover = el('input', { type: 'text' });
  const askCollection = el('input', { type: 'checkbox' });
  const remarque = el('textarea', { placeholder: t('orders.notes') });
  const reference = el('input', { type: 'text' });
  const decrementStock = el('input', { type: 'checkbox' });

  /* ── المجاميع ───────────────────────────────────────── */
  const subtotalEl = el('strong', { text: '0' });
  const feeInput = el('input', { type: 'number', value: '0' });
  const autoFeeBox = el('input', { type: 'checkbox' });
  autoFeeBox.checked = true;
  autoFeeBox.addEventListener('change', () => { s.autoFee = autoFeeBox.checked; feeInput.disabled = s.autoFee; updateFee(); });
  const discount = el('input', { type: 'number', value: '0' });
  discount.addEventListener('input', updateTotals);
  feeInput.addEventListener('input', updateTotals);
  const totalEl = el('strong', { style: { fontSize: '20px' }, text: '0' });

  function updateTotals() {
    s.shippingFee = Number(feeInput.value) || 0;
    const subtotal = s.items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
    const disc = Number(discount.value) || 0;
    const total = Math.max(0, subtotal + s.shippingFee - disc);
    subtotalEl.textContent = moneyWithCurrency(subtotal);
    totalEl.textContent = moneyWithCurrency(total);
  }

  async function updateFee() {
    if (!s.autoFee || !s.wilayaId) return;
    try {
      const r = await api.quote(s.wilayaId, s.stopDesk, s.type);
      if (r.found) {
        feeInput.value = String(r.fee || 0);
        updateTotals();
      }
    } catch { /* ignore */ }
  }

  /* ── التجميع ────────────────────────────────────────── */
  content.appendChild(el('div', { class: 'grid grid-2' }, [
    el('div', {}, [
      customerCard,
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h3', { text: t('orders.delivery_type') })]),
        el('div', { class: 'card-body' }, [
          wilayaWrap,
          field(t('orders.address'), address),
          el('label', { class: 'checkbox mb-2' }, [stopDeskBox, el('span', { text: t('orders.stopdesk') })]),
          deskBox,
          field(t('orders.gps'), gps),
          el('div', { class: 'form-row' }, [
            field(t('orders.type'), typeSel),
            field(t('orders.weight'), weight),
          ]),
          el('label', { class: 'checkbox mb-2' }, [fragile, el('span', { text: t('orders.fragile') })]),
        ]),
      ]),
    ]),
    el('div', {}, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h3', { text: t('orders.items') }),
          el('div', { class: 'flex' }, [productSel, manualBtn]),
        ]),
        el('div', { class: 'card-body' }, [itemsBody]),
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h3', { text: t('orders.shipment') })]),
        el('div', { class: 'card-body' }, [
          el('div', { class: 'form-row' }, [
            field(t('orders.reference'), reference),
            field(t('orders.boutique'), boutique),
          ]),
          el('label', { class: 'checkbox mb-2' }, [stockFlag, el('span', { text: t('orders.stock') })]),
          field(t('orders.quantite'), quantite),
          field(t('orders.recover'), recover),
          el('div', { class: 'form-row' }, [
            el('label', { class: 'checkbox' }, [askCollection, el('span', { text: t('orders.ask_collection') })]),
            el('label', { class: 'checkbox' }, [decrementStock, el('span', { text: t('orders.decrement_stock') })]),
          ]),
          field(t('orders.notes'), remarque),
        ]),
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h3', { text: t('common.total') })]),
        el('div', { class: 'card-body' }, [
          el('div', { class: 'row-between' }, [el('span', { text: t('orders.subtotal') }), subtotalEl]),
          el('label', { class: 'checkbox mb-2' }, [autoFeeBox, el('span', { text: t('orders.auto_fee') })]),
          field(t('orders.shipping_fee'), feeInput),
          field(t('orders.discount'), discount),
          el('div', { class: 'sep' }),
          el('div', { class: 'row-between' }, [el('strong', { text: t('orders.grand_total') }), totalEl]),
          el('div', { class: 'btn-group mt-2' }, [
            el('button', { class: 'btn btn-primary btn-block', text: t('orders.push_now'), onclick: () => save(true, false) }),
          ]),
          el('div', { class: 'btn-group mt-2' }, [
            el('button', { class: 'btn btn-success btn-block', text: t('orders.push_and_validate'), onclick: () => save(true, true) }),
            el('a', { class: 'btn btn-block', href: 'orders.html', text: t('common.cancel') }),
          ]),
        ]),
      ]),
    ]),
  ]));

  renderItems();

  /* ── الحفظ ──────────────────────────────────────────── */
  async function save(push, validate) {
    if (!cName.value.trim() || !cPhone.value.trim()) return toast(`${t('orders.customer')} / ${t('orders.phone')}`, 'error');
    if (!s.wilayaId) return toast(t('orders.wilaya'), 'error');
    if (!s.items.length) return toast(t('orders.add_item'), 'error');

    const payload = {
      customer_name: cName.value.trim(),
      phone: cPhone.value.trim(),
      phone2: cPhone2.value.trim(),
      wilaya_id: Number(s.wilayaId),
      commune: communeInput.value.trim(),
      address: address.value.trim(),
      stop_desk: stopDeskBox.checked ? 1 : 0,
      desk_name: stopDeskBox.checked ? deskSel.value : '',
      desk_code: '',
      shipping_fee: Number(feeInput.value) || 0,
      discount: Number(discount.value) || 0,
      notes: remarque.value.trim(),
      items: s.items.map((it) => ({
        product_id: it.product_id || null, name: it.name, sku: it.sku || '', qty: Number(it.qty) || 1, unit_price: Number(it.unit_price) || 0,
      })),
      source: 'admin',
      type: Number(typeSel.value),
      weight: Number(weight.value) || 0,
      fragile: fragile.checked ? 1 : 0,
      gps_link: gps.value.trim(),
      boutique: boutique.value.trim(),
      stock: stockFlag.checked ? 1 : 0,
      quantite: quantite.value.trim(),
      produit_a_recuperer: recover.value.trim(),
      ask_collection: askCollection.checked ? 1 : 0,
      reference: reference.value.trim(),
      decrement_stock: decrementStock.checked ? 1 : 0,
      push_to_ecotrack: push ? 1 : 0,
      validate_after_push: validate ? 1 : 0,
    };

    try {
      const res = await api.createOrder(payload);
      toast(t('orders.created_ok', { n: res.order.order_number }), 'success');
      if (push && res.push?.ok) {
        toast(t('orders.pushed_ok', { t: res.push.tracking }), 'success', 6000);
      } else if (push && res.push && res.push.ok === false) {
        toast(res.push.error, 'error', 8000);
      }
      setTimeout(() => { location.href = 'orders.html'; }, 900);
    } catch (err) {
      toast(err.message, 'error', 7000);
    }
  }
}
