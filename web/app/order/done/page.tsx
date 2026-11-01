import Link from 'next/link';
import { paidOrder, type DeliveryKind } from '../../../lib/cart';
import { money, number, unit } from '../../../lib/format';
import { currentBuyer } from '../../../lib/session';

export const dynamic = 'force-dynamic';

const deliveryText: Record<DeliveryKind, string> = {
  pickup: 'Самовывоз',
  address: 'Доставка по адресу',
  pvz: 'Пункт выдачи',
};

export default async function OrderDonePage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  const buyer = await currentBuyer();
  const paid = order ? await paidOrder(order, buyer) : null;
  if (!paid || paid === 'hidden') {
    return <section className="cart-page"><h1>Заказ</h1><p>Заказ открывается в кабинете покупателя или в том браузере, где его оплатили.</p></section>;
  }
  return (
    <section className="cart-page">
      <h1>Заказ {paid.id} оплачен</h1>
      <p>Магазин заказ сохранил и соберёт его к выдаче.</p>
      <ul className="order-list">
        {paid.items.map((item) => (
          <li key={`${item.name}-${item.quantity}`}>
            <b>{item.name}</b>
            <span>{number(item.quantity)} {unit(item.uom)}</span>
            <span>{money(item.unitPrice)}</span>
          </li>
        ))}
      </ul>
      <p>Итого {money(paid.total)}</p>
      <p>{deliveryText[paid.deliveryKind]}{paid.carrier ? `, ${paid.carrier}` : ''}{paid.deliveryPoint ? `: ${paid.deliveryPoint}` : ''}</p>
      <p>Контакт: {paid.contactName}, {paid.phone}{paid.email ? `, ${paid.email}` : ''}</p>
      {buyer ? (
        <p><Link href="/account/orders">Мои заказы</Link></p>
      ) : (
        <p>Эти данные в кабинете не сохранятся. <Link href="/register">Зарегистрируйтесь</Link>, если хотите, чтобы заказ и контакты остались у вас. Пока регистрация не сделана, заказ виден в этом браузере и у магазина.</p>
      )}
    </section>
  );
}
