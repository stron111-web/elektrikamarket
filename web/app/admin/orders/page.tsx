import { redirect } from 'next/navigation';
import { SendToCdek } from '../../../components/send-to-cdek';
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
  total: string;
  items: Item[];
  cdek_point_code: string | null;
  cdek_tariff_name: string | null;
  cdek_tariff_code: number | null;
  cdek_tariff_sum: string | null;
  cdek_number: string | null;
  cdek_transfer: string;
  cdek_error: string | null;
};

function orderNo(id: string) {
  return /^\d+$/.test(id) ? id.padStart(4, '0') : id;
}

function orderWhen(value: Date) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function cdekReady(order: Order) {
  return order.delivery_kind === 'pvz' && order.carrier === 'СДЭК' && Boolean(order.cdek_point_code) && Boolean(order.cdek_tariff_code);
}

function transferText(order: Order) {
  if (order.delivery_kind !== 'pvz' || order.carrier !== 'СДЭК') return 'не СДЭК';
  if (order.cdek_number) return `отправление ${order.cdek_number}`;
  if (order.cdek_transfer === 'sent') return 'передано, номер ещё не присвоен';
  if (order.cdek_transfer === 'sending') return 'передача идёт';
  if (order.cdek_transfer === 'failed') return 'не передалось';
  return 'ещё не в СДЭК';
}

export default async function AdminOrders() {
  if (!(await currentStaff())) redirect('/admin');
  const preview = isPreviewStore();
  const orders = await shop()<Order[]>`
    SELECT o.id::text, o.status, o.created_at, o.contact_name, o.contact_phone, o.contact_email,
      o.delivery_kind, o.carrier, o.delivery_point, o.comment,
      o.cdek_point_code, o.cdek_tariff_name, o.cdek_tariff_code, o.cdek_tariff_sum::text, o.cdek_number, o.cdek_transfer, o.cdek_error,
      (SELECT coalesce(sum(quantity * unit_price), 0)::text FROM order_items i WHERE i.order_id = o.id) AS total,
      COALESCE((SELECT json_agg(json_build_object('name', i.name, 'quantity', i.quantity::text, 'unit_price', i.unit_price::text, 'uom', i.uom) ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id), '[]'::json) AS items
    FROM orders o ORDER BY o.id`;
  return (
    <>
      <h1>Заказы</h1>
      {orders.length === 0 ? <p>Заказов пока нет.</p> : (
        <div className="admin-orders">
          <div className="admin-order-line admin-order-head">
            <span />
            <span>Номер</span>
            <span>Дата, время</span>
            <span>Сумма</span>
            <span>Клиент</span>
            <span>Статус</span>
            <span>СДЭК</span>
          </div>
          {orders.map((order) => {
            const ready = cdekReady(order);
            const canSend = preview && ready && order.cdek_transfer !== 'sending' && !(order.cdek_transfer === 'sent' && order.cdek_number);
            const label = order.cdek_transfer === 'sent' ? 'Узнать номер отправления' : 'Передать в СДЭК';
            return (
              <details key={order.id} className="admin-order">
                <summary>
                  <span className="admin-order-line">
                    <span className="admin-order-chev" aria-hidden="true" />
                    <span className="admin-order-no">{orderNo(order.id)}</span>
                    <span className="admin-order-when">{orderWhen(order.created_at)}</span>
                    <span className="admin-order-sum">{money(order.total)}</span>
                    <span>{order.contact_name}</span>
                    <span>{statusText[order.status] ?? order.status}</span>
                    <span>{transferText(order)}</span>
                  </span>
                </summary>
                <div className="admin-order-body">
                  <p>{order.contact_name}, {order.contact_phone}{order.contact_email ? `, ${order.contact_email}` : ''}</p>
                  <p>{deliveryText[order.delivery_kind] ?? order.delivery_kind}{order.carrier ? `, ${order.carrier}` : ''}{order.delivery_point ? `: ${order.delivery_point}` : ''}</p>
                  {order.cdek_point_code ? <p>Пункт получения: {order.cdek_point_code}{order.cdek_tariff_name ? `, ${order.cdek_tariff_name}` : ''}{order.cdek_tariff_sum ? `, доставка ${money(order.cdek_tariff_sum)}` : ''}</p> : null}
                  {order.delivery_kind === 'pvz' && order.carrier === 'СДЭК' ? <p>Передача в СДЭК: {transferText(order)}{order.cdek_error ? `. ${order.cdek_error}` : ''}</p> : null}
                  {order.comment ? <p>Комментарий покупателя: {order.comment}</p> : null}
                  <ul>
                    {(order.items ?? []).map((item, index) => (
                      <li key={`${order.id}-${index}`}>{item.name} — {formatQty(parseQty(item.quantity) ?? 0n)} {unit(item.uom)} × {money(item.unit_price)}</li>
                    ))}
                  </ul>
                  {canSend ? <SendToCdek id={order.id} label={label} /> : null}
                  {preview && order.delivery_kind === 'pvz' && order.carrier === 'СДЭК' && !ready ? <p className="account-notice">В заказе нет пункта получения или тарифа. Передать в СДЭК нельзя, цену подставлять не будем.</p> : null}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}
