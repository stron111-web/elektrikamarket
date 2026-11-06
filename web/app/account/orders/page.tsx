import type { Metadata } from 'next';
import Link from 'next/link';
import { Cabinet } from '../../../components/cabinet';
import { money } from '../../../lib/format';
import { shop } from '../../../lib/shop';
import { currentBuyer } from '../../../lib/session';

export const metadata: Metadata = { title: 'Мои заказы' };
export const dynamic = 'force-dynamic';

const statusText: Record<string, string> = { placed: 'Принят', paid: 'Оплачен', unpaid: 'Не оплачен', sent: 'Передан в магазин', cancelled: 'Отменён' };
const deliveryText: Record<string, string> = { pickup: 'Самовывоз', address: 'Доставка по адресу', pvz: 'Пункт выдачи' };

export default async function OrdersPage() {
  const buyer = await currentBuyer();
  const orders = buyer ? await shop()<{ id: string; status: string; created_at: Date; items: string; total: string; delivery_kind: string; carrier: string | null; delivery_point: string | null }[]>`
    SELECT o.id::text, o.status, o.created_at, o.delivery_kind, o.carrier, o.delivery_point,
      (SELECT count(*)::text FROM order_items i WHERE i.order_id = o.id) AS items,
      (SELECT coalesce(sum(quantity * unit_price), 0)::text FROM order_items i WHERE i.order_id = o.id) AS total
    FROM orders o WHERE o.buyer_id = ${buyer.id} ORDER BY o.id DESC` : [];
  return (
    <Cabinet title="Мои заказы" current="/account/orders">
      {!buyer ? <p>Войдите, чтобы увидеть заказы. Кнопка «Войти» справа в шапке.</p> : orders.length === 0 ? (
        <p>Заказов пока нет. <Link href="/catalog">В каталог</Link></p>
      ) : (
        <ul className="order-list">
          {orders.map((order) => (
            <li key={order.id}>
              <b>Заказ {order.id}</b>
              <span>{new Date(order.created_at).toLocaleString('ru-RU')}</span>
              <span>{statusText[order.status] ?? order.status}</span>
              <span>{order.items} поз.</span>
              <span>{money(order.total)}</span>
              <span>{deliveryText[order.delivery_kind] ?? order.delivery_kind}{order.carrier ? `, ${order.carrier}` : ''}{order.delivery_point ? `: ${order.delivery_point}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Cabinet>
  );
}
