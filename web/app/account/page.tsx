import type { Metadata } from 'next';
import { PlainPage } from '../../components/plain-page';

export const metadata: Metadata = { title: 'Профиль' };

export default function AccountPage() {
  return (
    <PlainPage title="Профиль">
      <p>Личный кабинет появится вместе с заказами. Сейчас это место в шапке уже занято.</p>
    </PlainPage>
  );
}
