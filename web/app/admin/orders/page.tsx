import { redirect } from 'next/navigation';
import { saveOrder, sendToCdek } from '../../../lib/admin-actions';
import { money, unit } from '../../../lib/format';
import { isPreviewStore } from '../../../lib/preview-store';
import { formatQty, parseQty } from '../../../lib/quantity';
import { shop } from '../../../lib/shop';
import { currentStaff } from '../../../lib/staff';

export const dynamic = 'force-dynamic';

const statusText: Record<string, string> = { placed: 'Принят', paid: 'Оплачен', unpaid: 'Не оплачен', sent: 'Отправлен', cancelled: 'Отменён' };
const deliveryText: Record<string, string> = { pickup: 'Самовывоз', address: 'Адрес', pvz: 'Пункт выдачи' };

type Item = { name: string; quantity: string; unit_price: string; uom: string };
type Order = {
  id: string;
  status: string;
  created_at: Date;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  delivery_kind: string;
  carrier: string | null;
  delivery_point: string | null;
  comment: string | null;
  staff_note: string | null;
  total: string;
  items: Item[];
  cdek_point_code: string | null;
  cdek_tariff_name: string | null;
  cdek_tariff_code: number | null;
  cdek_number: string | null;
  cdek_transfer: string;
  cdek_error: string | null;
};

export default async function AdminOrders() {
  if (!(await currentStaff())) redirect('/admin');
  const preview = isPreviewStore();
  const orders = await shop()<Order[]>`
    SELECT o.id::text, o.status, o.created_at, o.contact_name, o.contact_phone, o.contact_email,
      o.delivery_kind, o.carrier, o.delivery_point, o.comment, o.staff_note,
      o.cdek_point_code, o.cdek_tariff_name, o.cdek_tariff_code, o.cdek_number, o.cdek_transfer, o.cdek_error,
      (SELECT coalesce(sum(quantity * unit_price), 0)::text FROM order_items i WHERE i.order_id = o.id) AS total,
      COALESCE((SELECT json_agg(json_build_object('name', i.name, 'quantity', i.quantity::text, 'unit_price', i.unit_price::text, 'uom', i.uom) ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id), '[]'::json) AS items
    FROM orders o ORDER BY o.id DESC`;
  return (
    <>
      <h1>Заказы</h1>
      {orders.length === 0 ? <p>Заказов пока нет.</p> : (
        <ul className="admin-orders">
          {orders.map((order) => (
            <li key={order.id}>
              <div>
                <b>Заказ {order.id}</b>
                <span>{new Date(order.created_at).toLocaleString('ru-RU')}</span>
                <span>{money(order.total)}</span>
              </div>
              <p>{order.contact_name}, {order.contact_phone}{order.contact_email ? `, ${order.contact_email}` : ''}</p>
              <p>{deliveryText[order.delivery_kind] ?? order.delivery_kind}{order.carrier ? `, ${order.carrier}` : ''}{order.delivery_point ? `: ${order.delivery_point}` : ''}</p>
              {order.cdek_point_code ? <p>Пункт получения: {order.cdek_point_code}{order.cdek_tariff_name ? `, ${order.cdek_tariff_name}` : ''}</p> : null}
              {order.delivery_kind === 'pvz' && order.carrier === 'СДЭК' ? (
                <p>Передача в СДЭК: {order.cdek_number ? `отправление ${order.cdek_number}` : order.cdek_transfer === 'sent' ? 'передано, номер ещё не присвоен' : order.cdek_transfer === 'sending' ? 'идёт' : order.cdek_transfer === 'failed' ? (order.cdek_error || 'не передалось') : 'ещё не передавался'}</p>
              ) : null}
              {order.comment ? <p>Комментарий покупателя: {order.comment}</p> : null}
              <ul>
                {(order.items ?? []).map((item) => (
                  <li key={`${item.name}-${item.quantity}`}>{item.name} — {formatQty(parseQty(item.quantity) ?? 0n)} {unit(item.uom)} × {money(item.unit_price)}</li>
                ))}
              </ul>
              <form action={saveOrder} className="admin-inline">
                <input type="hidden" name="id" value={order.id} />
                <select name="status" defaultValue={order.status} aria-label="Статус заказа">
                  {Object.entries(statusText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <input name="note" defaultValue={order.staff_note ?? ''} placeholder="Заметка магазина" aria-label="Заметка магазина" />
                <button type="submit">Сохранить</button>
              </form>
              {preview && order.delivery_kind === 'pvz' && order.carrier === 'СДЭК' && order.cdek_point_code && order.cdek_tariff_code && order.cdek_transfer !== 'sending' && !(order.cdek_transfer === 'sent' && order.cdek_number) ? (
                <form action={sendToCdek} className="admin-inline">
                  <input type="hidden" name="id" value={order.id} />
                  <button type="submit">Передать в СДЭК</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
