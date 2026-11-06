import 'server-only';
import { findShopShipment, registerShipment } from './cdek';
import { packagesFor } from './parcel';
import { totalOf } from './price';
import { isPreviewStore } from './preview-store';
import { parseQty, QTY_SCALE } from './quantity';
import { shop } from './shop';

const waitMs = 45_000;

type OrderRow = {
  id: string;
  status: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  delivery_kind: string;
  carrier: string | null;
  cdek_point_code: string | null;
  cdek_tariff_code: number | null;
  cdek_uuid: string | null;
  cdek_number: string | null;
  cdek_transfer: string;
  cdek_transfer_at: Date | null;
};

function phoneOf(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  return '';
}

function textOf(order: { cdek_number: string | null; cdek_transfer: string; cdek_error?: string | null }) {
  if (order.cdek_number) return `Передано в СДЭК. Отправление ${order.cdek_number}.`;
  if (order.cdek_transfer === 'sent') return 'Передано в СДЭК. Номер отправления ещё не присвоен.';
  if (order.cdek_transfer === 'sending') return 'Передача в СДЭК уже идёт. Второй запрос не отправлен.';
  return order.cdek_error || 'В СДЭК ещё не передавался.';
}

async function remember(id: string, uuid: string, cdekNumber: string | null) {
  await shop()`
    UPDATE orders
    SET cdek_uuid = ${uuid}, cdek_number = ${cdekNumber}, cdek_transfer = 'sent', cdek_transfer_at = now(), cdek_error = NULL
    WHERE id = ${id} AND status <> 'cancelled'`;
}

export async function handoffOrder(rawId: string): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  if (!isPreviewStore()) return { ok: false, message: 'Кнопка «Передать в СДЭК» работает только на превью.' };
  if (!/^\d{1,12}$/.test(rawId)) return { ok: false, message: 'Заказ не найден.' };
  const db = shop();
  const rows = await db<OrderRow[]>`
    SELECT id::text, status, contact_name, contact_phone, contact_email, delivery_kind, carrier,
      cdek_point_code, cdek_tariff_code, cdek_uuid, cdek_number, cdek_transfer, cdek_transfer_at
    FROM orders WHERE id = ${rawId} LIMIT 1`;
  const order = rows[0];
  if (!order) return { ok: false, message: 'Заказ не найден.' };
  if (order.delivery_kind !== 'pvz' || order.carrier !== 'СДЭК') return { ok: false, message: 'Это не заказ с доставкой СДЭК.' };
  if (!order.cdek_point_code || !order.cdek_tariff_code) return { ok: false, message: 'В заказе нет пункта получения или тарифа, по которому считали доставку.' };
  if (order.cdek_uuid) {
    const known = await findShopShipment(order.id);
    if (known.ok && known.found) await remember(order.id, known.uuid, known.cdekNumber ?? order.cdek_number);
    const fresh = known.ok && known.found ? known.cdekNumber ?? order.cdek_number : order.cdek_number;
    return { ok: true, text: textOf({ cdek_number: fresh, cdek_transfer: 'sent' }) };
  }

  const looked = await findShopShipment(order.id);
  if (!looked.ok && looked.timeout) return { ok: false, message: 'СДЭК не ответил. Повтор не отправлен: не видно, зарегистрирован ли заказ.' };
  if (!looked.ok) return { ok: false, message: looked.message };
  if (looked.found) {
    await remember(order.id, looked.uuid, looked.cdekNumber);
    return { ok: true, text: textOf({ cdek_number: looked.cdekNumber, cdek_transfer: 'sent' }) };
  }

  if (order.cdek_transfer === 'sending') {
    const age = order.cdek_transfer_at ? Date.now() - new Date(order.cdek_transfer_at).getTime() : waitMs;
    if (age < waitMs) return { ok: false, message: 'Передача в СДЭК уже идёт. Второй запрос не отправлен.' };
    await db`
      UPDATE orders SET cdek_transfer = 'failed', cdek_error = ${'Прошлая передача не подтвердилась. Повтор можно отправить заново.'}
      WHERE id = ${order.id} AND cdek_uuid IS NULL AND cdek_transfer = 'sending'`;
  }

  const claimed = await db<{ id: string }[]>`
    UPDATE orders
    SET cdek_transfer = 'sending', cdek_transfer_at = now(), cdek_error = NULL
    WHERE id = ${order.id} AND cdek_uuid IS NULL AND cdek_transfer IN ('none', 'failed')
    RETURNING id::text`;
  if (!claimed.length) return { ok: false, message: 'Передача в СДЭК уже идёт. Второй запрос не отправлен.' };

  const items = await db<{ product_id: number; supplier_code: string; name: string; quantity: string; unit_price: string }[]>`
    SELECT product_id, supplier_code, name, quantity::text, unit_price::text
    FROM order_items WHERE order_id = ${order.id} ORDER BY id`;
  const packed = await packagesFor(items.map((item) => ({ productId: item.product_id, quantity: item.quantity, name: item.name })));
  if (!packed.ok) {
    await db`UPDATE orders SET cdek_transfer = 'failed', cdek_error = ${packed.message}, cdek_transfer_at = now() WHERE id = ${order.id} AND cdek_uuid IS NULL`;
    return packed;
  }
  const phone = phoneOf(order.contact_phone);
  if (!phone) {
    const message = 'В заказе нет телефона получателя, который можно передать в СДЭК.';
    await db`UPDATE orders SET cdek_transfer = 'failed', cdek_error = ${message}, cdek_transfer_at = now() WHERE id = ${order.id} AND cdek_uuid IS NULL`;
    return { ok: false, message };
  }
  const places = items.map((item, index) => {
    const quantity = parseQty(item.quantity);
    const place = packed.packages[index];
    const cost = quantity ? Number(totalOf(item.unit_price, quantity, QTY_SCALE)) : 0;
    return { name: item.name, wareKey: item.supplier_code, cost, ...place };
  });
  const created = await registerShipment({
    number: order.id,
    tariffCode: order.cdek_tariff_code,
    deliveryPoint: order.cdek_point_code,
    recipientName: order.contact_name,
    phone,
    email: order.contact_email,
    places,
  });
  if (created.ok) {
    await remember(order.id, created.uuid, created.cdekNumber);
    return { ok: true, text: textOf({ cdek_number: created.cdekNumber, cdek_transfer: 'sent' }) };
  }
  const again = await findShopShipment(order.id);
  if (again.ok && again.found) {
    await remember(order.id, again.uuid, again.cdekNumber);
    return { ok: true, text: textOf({ cdek_number: again.cdekNumber, cdek_transfer: 'sent' }) };
  }
  if (created.timeout || ( !again.ok && again.timeout)) {
    await db`UPDATE orders SET cdek_transfer = 'sending', cdek_transfer_at = now(), cdek_error = ${'СДЭК не ответил. Повтор не отправлен, пока не ясно, зарегистрирован ли заказ.'} WHERE id = ${order.id} AND cdek_uuid IS NULL`;
    return { ok: false, message: 'СДЭК не ответил. Повтор не отправлен: не видно, зарегистрирован ли заказ.' };
  }
  const message = created.message || 'СДЭК не зарегистрировал заказ. Повторить отправку можно.';
  await db`UPDATE orders SET cdek_transfer = 'failed', cdek_error = ${message}, cdek_transfer_at = now() WHERE id = ${order.id} AND cdek_uuid IS NULL`;
  return { ok: false, message };
}
