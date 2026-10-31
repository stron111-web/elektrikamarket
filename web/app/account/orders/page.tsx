import type { Metadata } from 'next';
import { PlainPage } from '../../../components/plain-page';

export const metadata: Metadata = { title: 'Мои заказы' };

export default function OrdersPage() {
  return (
    <PlainPage title="Мои заказы">
      <p>Список заказов появится, когда заработает оформление. Пока заявка уходит по телефону и почте.</p>
    </PlainPage>
  );
}
