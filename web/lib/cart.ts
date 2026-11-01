import 'server-only';
import { cookies } from 'next/headers';
import { productsForLists, productCode, type Item } from './data';
import { personalPriceMap } from './personal-price';
import { sumMoney, totalOf } from './price';
import { fitQuantity, formatQty, parseQty, QTY_SCALE, saleStep, sumQty } from './quantity';
import { hashToken, newSessionToken, shop } from './shop';
import type { Buyer } from './session';

const cartCookie = 'em_cart';
const guestCookie = 'em_guest';
const lineLimit = 40;

export type DeliveryKind = 'pickup' | 'address' | 'pvz';

export type CartLine = {
  productId: number;
  name: string;
  slug: string;
  code: string;
  quantity: string;
  step: string;
  stepKnown: boolean;
  unitCode: string;
  unitPrice: string | null;
  retailPrice: string | null;
  lineTotal: string | null;
  available: boolean;
  notice: string;
};

export type CartView = { lines: CartLine[]; total: string; payable: number };

type Stored = { productId: number; quantity: string; code: string };
type Pack = { multiplicity?: string | null; multiplicityRaw?: string | null } | null;

export type PaymentDraft = {
  goodsStamp: string;
  stamp: string;
  lines: { productId: number; code: string; name: string; uom: string; quantity: string; unitPrice: string }[];
  contactName: string;
  phone: string;
  email: string | null;
  deliveryKind: DeliveryKind;
  carrier: string | null;
  deliveryPoint: string | null;
  comment: string | null;
  organizationName: string | null;
  organizationInn: string | null;
};

const cookieBase = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 180, secure: process.env.NODE_ENV === 'production' };

function buyerPrice(item: Item, buyer: Buyer | null, personal: Map<number, string | null>) {
  if (!item.price) return { unit: null, retail: null };
  const retail = item.price.retailPrice;
  if (!buyer || buyer.status === 'regular') return { unit: retail, retail };
  return { unit: personal.get(item.id) ?? null, retail };
}

function stockOf(item: Item) {
  if (!item.price) return 0n;
  return sumQty(item.stocks.filter((stock) => stock.uom === item.price?.uom).map((stock) => stock.quantity));
}

async function readGuestKey() {
  const token = (await cookies()).get(guestCookie)?.value;
  if (!token || token.length < 40) return null;
  return hashToken(token);
}

async function ensureGuestKey() {
  const existing = await readGuestKey();
  if (existing) return existing;
  const { token } = newSessionToken();
  (await cookies()).set(guestCookie, token, cookieBase);
  return hashToken(token);
}

function parseGuest(raw: string | undefined): Stored[] {
  if (!raw) return [];
  const lines: Stored[] = [];
  for (const part of raw.split(',')) {
    const [id, qty, code] = part.split(':');
    const quantity = parseQty(qty);
    if (!/^\d{1,9}$/.test(id) || !quantity || !code) continue;
    lines.push({ productId: Number(id), quantity: formatQty(quantity), code: decodeURIComponent(code) });
    if (lines.length >= lineLimit) break;
  }
  return lines;
}

async function readStored(buyerId?: string): Promise<Stored[]> {
  if (buyerId) {
    const rows = await shop()<{ product_id: number; quantity: string; supplier_code: string }[]>`
      SELECT product_id, quantity::text, supplier_code FROM cart_items WHERE buyer_id = ${buyerId} ORDER BY updated_at, product_id`;
    return rows.map((row) => ({ productId: row.product_id, quantity: formatQty(parseQty(row.quantity) ?? 0n), code: row.supplier_code }));
  }
  return parseGuest((await cookies()).get(cartCookie)?.value);
}

async function writeStored(buyerId: string | undefined, lines: Stored[]) {
  if (buyerId) {
    const db = shop();
    await db.begin(async (tx) => {
      await tx`DELETE FROM cart_items WHERE buyer_id = ${buyerId}`;
      for (const line of lines) {
        await tx`INSERT INTO cart_items (buyer_id, product_id, supplier_code, quantity) VALUES (${buyerId}, ${line.productId}, ${line.code}, ${line.quantity})`;
      }
    });
    return;
  }
  const jar = await cookies();
  if (!lines.length) {
    jar.delete(cartCookie);
    return;
  }
  const raw = lines.map((line) => `${line.productId}:${line.quantity}:${encodeURIComponent(line.code)}`).join(',');
  jar.set(cartCookie, raw, cookieBase);
}

async function cancelPending(buyerId?: string) {
  const db = shop();
  if (buyerId) {
    await db`UPDATE payments SET status = 'cancelled' WHERE status = 'pending' AND buyer_id = ${buyerId}`;
    return;
  }
  const key = await readGuestKey();
  if (key) await db`UPDATE payments SET status = 'cancelled' WHERE status = 'pending' AND guest_key = ${key}`;
}

export async function cartCount(buyerId?: string) {
  try {
    return (await readStored(buyerId)).length;
  } catch {
    return 0;
  }
}

export async function cartQuantities(buyerId?: string) {
  try {
    return new Map((await readStored(buyerId)).map((line) => [line.productId, line.quantity]));
  } catch {
    return new Map<number, string>();
  }
}

export async function quantityInCart(buyerId: string | undefined, productId: number) {
  const line = (await readStored(buyerId)).find((item) => item.productId === productId);
  return line?.quantity ?? null;
}

export async function loadCart(buyer: Buyer | null, persist = true): Promise<CartView> {
  const stored = await readStored(buyer?.id);
  if (!stored.length) return { lines: [], total: '0.00', payable: 0 };
  const listed = await productsForLists(stored.map((line) => line.productId));
  const personal = await personalPriceMap(buyer, listed.map((row) => ({ id: row.item.id, retail: row.item.price?.retailPrice ?? null })));
  const byId = new Map(listed.map((row) => [row.item.id, row]));
  const next: Stored[] = [];
  const lines: CartLine[] = [];
  for (const row of stored) {
    const found = byId.get(row.productId);
    if (!found) {
      next.push(row);
      lines.push({
        productId: row.productId, name: `Товар ${row.code}`, slug: '', code: row.code, quantity: row.quantity,
        step: '1', stepKnown: false, unitCode: '', unitPrice: null, retailPrice: null, lineTotal: null,
        available: false, notice: 'Этого товара больше нет в каталоге.',
      });
      continue;
    }
    const item = found.item;
    const pack = found.packaging as Pack;
    const { step, known } = saleStep(pack?.multiplicity, pack?.multiplicityRaw);
    const prices = buyerPrice(item, buyer, personal);
    const stock = stockOf(item);
    const wanted = parseQty(row.quantity) ?? step;
    const fitted = prices.unit ? fitQuantity(wanted, step, stock) : null;
    const available = Boolean(fitted && prices.unit);
    const quantity = fitted ?? wanted;
    if (available) next.push({ productId: row.productId, quantity: formatQty(quantity), code: item.supplierCode });
    else next.push(row);
    lines.push({
      productId: item.id,
      name: item.name,
      slug: item.slug,
      code: item.supplierCode,
      quantity: formatQty(quantity),
      step: formatQty(step),
      stepKnown: known,
      unitCode: item.price?.uom ?? '',
      unitPrice: available ? prices.unit : null,
      retailPrice: prices.retail,
      lineTotal: available && prices.unit ? totalOf(prices.unit, quantity, QTY_SCALE) : null,
      available,
      notice: available ? '' : buyer?.status === 'markup' && item.price ? 'Персональная цена этого товара пока не посчитана.' : 'Сейчас этот товар купить нельзя: нет цены или остатка.',
    });
  }
  const changed = next.length !== stored.length || next.some((line, index) => line.quantity !== stored[index]?.quantity || line.productId !== stored[index]?.productId);
  if (persist && changed) await writeStored(buyer?.id, next);
  const payable = lines.filter((line) => line.available && line.lineTotal);
  return { lines, total: payable.length ? sumMoney(payable.map((line) => line.lineTotal as string)) : '0.00', payable: payable.length };
}

async function mutate(buyer: Buyer | null, productId: number, wanted: bigint | null) {
  if (!Number.isInteger(productId) || productId <= 0) return 'Товар не найден.';
  const code = await productCode(productId);
  if (!code) return 'Этого товара нет в каталоге.';
  const stored = await readStored(buyer?.id);
  const rest = stored.filter((line) => line.productId !== productId);
  if (wanted === null) {
    await writeStored(buyer?.id, rest);
    await cancelPending(buyer?.id);
    return '';
  }
  const listed = await productsForLists([productId]);
  const found = listed[0];
  if (!found?.item.price) return 'Этот товар сейчас нельзя положить в корзину.';
  const pack = found.packaging as Pack;
  const { step } = saleStep(pack?.multiplicity, pack?.multiplicityRaw);
  const fitted = fitQuantity(wanted, step, stockOf(found.item));
  if (!fitted) return 'Столько сейчас нет в наличии.';
  if (!stored.some((line) => line.productId === productId) && rest.length >= lineLimit) return 'В корзине уже сорок позиций. Уберите одну, чтобы добавить новую.';
  await writeStored(buyer?.id, [...rest, { productId, quantity: formatQty(fitted), code }]);
  await cancelPending(buyer?.id);
  if (fitted !== wanted) return 'Количество подровняли по кратности и остатку.';
  return '';
}

export async function addProduct(buyer: Buyer | null, productId: number) {
  const current = parseQty(await quantityInCart(buyer?.id, productId)) ?? 0n;
  const listed = await productsForLists([productId]);
  const pack = listed[0]?.packaging as Pack;
  const { step } = saleStep(pack?.multiplicity, pack?.multiplicityRaw);
  const message = await mutate(buyer, productId, current + step);
  return message;
}

export async function changeProduct(buyer: Buyer | null, productId: number, action: 'inc' | 'dec' | 'remove' | 'set', raw?: string) {
  if (action === 'remove') return mutate(buyer, productId, null);
  const current = parseQty((await readStored(buyer?.id)).find((line) => line.productId === productId)?.quantity) ?? 0n;
  const listed = await productsForLists([productId]);
  const pack = listed[0]?.packaging as Pack;
  const { step } = saleStep(pack?.multiplicity, pack?.multiplicityRaw);
  if (action === 'inc') return mutate(buyer, productId, (current || 0n) + step);
  if (action === 'dec') {
    if (current <= step) return 'Это минимальный шаг. Чтобы убрать товар, нажмите «Убрать».';
    return mutate(buyer, productId, current - step);
  }
  const typed = parseQty(raw);
  if (!typed) return 'Укажите количество числом.';
  return mutate(buyer, productId, typed);
}

export async function emptyCart(buyerId?: string) {
  await writeStored(buyerId, []);
  await cancelPending(buyerId);
}

export async function rememberGuestCart(buyerId: string) {
  try {
    const guest = parseGuest((await cookies()).get(cartCookie)?.value);
    if (guest.length) {
      const own = await readStored(buyerId);
      const merged = new Map(own.map((line) => [line.productId, line]));
      for (const line of guest) {
        const previous = merged.get(line.productId);
        const sum = (parseQty(previous?.quantity) ?? 0n) + (parseQty(line.quantity) ?? 0n);
        merged.set(line.productId, { productId: line.productId, quantity: formatQty(sum), code: line.code });
      }
      await writeStored(buyerId, [...merged.values()].slice(0, lineLimit));
      (await cookies()).delete(cartCookie);
    }
    const key = await readGuestKey();
    if (key) await shop()`UPDATE orders SET buyer_id = ${buyerId} WHERE guest_key = ${key} AND buyer_id IS NULL`;
  } catch {
    return;
  }
}

function clip(value: string, max: number) {
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

export async function openPayment(buyer: Buyer | null, input: {
  contactName: string; phone: string; email: string; deliveryKind: string; carrier: string; deliveryPoint: string; comment: string;
}): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  const contactName = clip(input.contactName, 200);
  const phone = clip(input.phone, 40);
  const digits = phone.replace(/\D/g, '');
  if (contactName.length < 2) return { ok: false, message: 'Укажите, как к вам обращаться.' };
  if (digits.length < 10 || digits.length > 15) return { ok: false, message: 'Укажите телефон: от 10 до 15 цифр.' };
  const kind = input.deliveryKind;
  if (kind !== 'pickup' && kind !== 'address' && kind !== 'pvz') return { ok: false, message: 'Выберите, как получить товар.' };
  const carrier = clip(input.carrier, 120);
  const deliveryPoint = clip(input.deliveryPoint, 500);
  if (kind === 'address' && deliveryPoint.length < 5) return { ok: false, message: 'Укажите адрес, куда привезти.' };
  if (kind === 'pvz' && carrier.length < 2) return { ok: false, message: 'Укажите компанию пункта выдачи, например СДЭК.' };
  if (kind === 'pvz' && deliveryPoint.length < 5) return { ok: false, message: 'Укажите адрес пункта выдачи.' };
  const email = buyer?.email ?? clip(input.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'Почта записана не целиком.' };
  const cart = await loadCart(buyer);
  const payable = cart.lines.filter((line) => line.available && line.unitPrice && line.lineTotal);
  if (!payable.length) return { ok: false, message: 'В корзине нет товаров, которые можно оплатить.' };
  const lines = payable.map((line) => ({
    productId: line.productId, code: line.code, name: line.name, uom: line.unitCode, quantity: line.quantity, unitPrice: line.unitPrice as string,
  }));
  const goodsStamp = lines.map((line) => `${line.productId}:${line.quantity}`).sort().join('|');
  const stamp = lines.map((line) => `${line.productId}:${line.quantity}:${line.unitPrice}`).sort().join('|');
  const payload: PaymentDraft = {
    goodsStamp, stamp, lines, contactName, phone, email: email || null, deliveryKind: kind,
    carrier: kind === 'pickup' ? null : carrier || null,
    deliveryPoint: kind === 'pickup' ? null : deliveryPoint,
    comment: clip(input.comment, 1000) || null,
    organizationName: buyer?.company ?? null,
    organizationInn: buyer?.inn ?? null,
  };
  const db = shop();
  const { token, hash } = newSessionToken();
  const guestKey = buyer ? null : await ensureGuestKey();
  await cancelPending(buyer?.id);
  await db`
    INSERT INTO payments (token_hash, buyer_id, guest_key, payload, amount)
    VALUES (${hash}, ${buyer?.id ?? null}, ${guestKey}, ${db.json(payload)}, ${cart.total})`;
  return { ok: true, token };
}

export async function paymentPreview(token: string) {
  if (!token || token.length < 40) return null;
  const rows = await shop()<{ amount: string; status: string; order_id: string | null }[]>`
    SELECT amount::text, status, order_id::text FROM payments WHERE token_hash = ${hashToken(token)} LIMIT 1`;
  return rows[0] ?? null;
}

export async function settlePayment(token: string, buyer: Buyer | null, mode: 'pay' | 'cancel') {
  if (!token || token.length < 40) return { ok: false as const, message: 'Окно оплаты устарело.' };
  const hash = hashToken(token);
  const guestKey = await readGuestKey();
  return shop().begin(async (tx) => {
    const rows = await tx<{ id: string; buyer_id: string | null; guest_key: string | null; payload: PaymentDraft; status: string; order_id: string | null }[]>`
      SELECT id::text, buyer_id::text, guest_key, payload, status, order_id::text
      FROM payments WHERE token_hash = ${hash} FOR UPDATE`;
    const payment = rows[0];
    if (!payment) return { ok: false as const, message: 'Окно оплаты устарело.' };
    const owns = (buyer && payment.buyer_id === buyer.id) || (!payment.buyer_id && guestKey && payment.guest_key === guestKey);
    if (!owns) return { ok: false as const, message: 'Это окно оплаты открыто в другом сеансе.' };
    if (payment.status === 'paid' && payment.order_id) return { ok: true as const, orderId: payment.order_id, guest: false, ids: [] as number[] };
    if (payment.status !== 'pending') return { ok: false as const, message: 'Эта оплата уже закрыта. Корзина на сайте осталась.' };
    if (mode === 'cancel') {
      await tx`UPDATE payments SET status = 'cancelled' WHERE id = ${payment.id}`;
      return { ok: false as const, message: 'Оплата не прошла. Корзина на месте, можно вернуться и оплатить снова.' };
    }
    const draft = payment.payload;
    const fresh = await loadCart(buyer, false);
    const payable = fresh.lines.filter((line) => line.available && line.unitPrice);
    const goodsStamp = payable.map((line) => `${line.productId}:${line.quantity}`).sort().join('|');
    const stamp = payable.map((line) => `${line.productId}:${line.quantity}:${line.unitPrice}`).sort().join('|');
    if (goodsStamp !== draft.goodsStamp) {
      await tx`UPDATE payments SET status = 'cancelled' WHERE id = ${payment.id}`;
      return { ok: false as const, message: 'Корзина изменилась. Закройте окно и оплатите заново.' };
    }
    if (stamp !== draft.stamp) {
      await tx`UPDATE payments SET status = 'cancelled' WHERE id = ${payment.id}`;
      return { ok: false as const, message: 'Цена изменилась. Закройте окно и оплатите заново.' };
    }
    const created = await tx<{ id: string }[]>`
      INSERT INTO orders (buyer_id, status, contact_name, contact_phone, contact_email, organization_name, organization_inn, delivery_kind, carrier, delivery_point, comment, guest_key)
      VALUES (${payment.buyer_id}, 'paid', ${draft.contactName}, ${draft.phone}, ${draft.email}, ${draft.organizationName}, ${draft.organizationInn}, ${draft.deliveryKind}, ${draft.carrier}, ${draft.deliveryPoint}, ${draft.comment}, ${payment.guest_key})
      RETURNING id::text`;
    const orderId = created[0].id;
    for (const line of draft.lines) {
      await tx`
        INSERT INTO order_items (order_id, product_id, supplier_code, name, uom, quantity, unit_price)
        VALUES (${orderId}, ${line.productId}, ${line.code}, ${line.name}, ${line.uom}, ${line.quantity}, ${line.unitPrice})`;
    }
    const ids = draft.lines.map((line) => line.productId);
    if (payment.buyer_id) await tx`DELETE FROM cart_items WHERE buyer_id = ${payment.buyer_id} AND product_id IN ${tx(ids)}`;
    await tx`UPDATE payments SET status = 'paid', order_id = ${orderId} WHERE id = ${payment.id}`;
    return { ok: true as const, orderId, guest: !payment.buyer_id, ids };
  }).then(async (result) => {
    if (result.ok && result.guest) {
      const left = parseGuest((await cookies()).get(cartCookie)?.value).filter((line) => !result.ids.includes(line.productId));
      await writeStored(undefined, left);
    }
    return result.ok ? { ok: true as const, orderId: result.orderId } : result;
  });
}

export type PaidOrder = {
  id: string;
  buyerId: string | null;
  guestKey: string | null;
  contactName: string;
  phone: string;
  email: string | null;
  deliveryKind: DeliveryKind;
  carrier: string | null;
  deliveryPoint: string | null;
  comment: string | null;
  total: string;
  items: { name: string; quantity: string; uom: string; unitPrice: string }[];
};

export async function paidOrder(id: string, buyer: Buyer | null): Promise<PaidOrder | 'hidden' | null> {
  if (!/^\d{1,12}$/.test(id)) return null;
  const guestKey = await readGuestKey();
  const rows = await shop()<{
    id: string; buyer_id: string | null; guest_key: string | null; contact_name: string; contact_phone: string; contact_email: string | null;
    delivery_kind: DeliveryKind; carrier: string | null; delivery_point: string | null; comment: string | null; total: string;
  }[]>`
    SELECT o.id::text, o.buyer_id::text, o.guest_key, o.contact_name, o.contact_phone, o.contact_email,
      o.delivery_kind, o.carrier, o.delivery_point, o.comment,
      (SELECT coalesce(sum(quantity * unit_price), 0)::text FROM order_items i WHERE i.order_id = o.id) AS total
    FROM orders o WHERE o.id = ${id} AND o.status = 'paid' LIMIT 1`;
  const order = rows[0];
  if (!order) return null;
  const allowed = (buyer && order.buyer_id === buyer.id) || (guestKey && order.guest_key === guestKey);
  if (!allowed) return 'hidden';
  const items = await shop()<{ name: string; quantity: string; uom: string; unit_price: string }[]>`
    SELECT name, quantity::text, uom, unit_price::text FROM order_items WHERE order_id = ${id} ORDER BY id`;
  return {
    id: order.id, buyerId: order.buyer_id, guestKey: order.guest_key, contactName: order.contact_name, phone: order.contact_phone,
    email: order.contact_email, deliveryKind: order.delivery_kind, carrier: order.carrier, deliveryPoint: order.delivery_point,
    comment: order.comment, total: order.total,
    items: items.map((item) => ({ name: item.name, quantity: formatQty(parseQty(item.quantity) ?? 0n), uom: item.uom, unitPrice: item.unit_price })),
  };
}
