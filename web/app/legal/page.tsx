import type { Metadata } from 'next';
import { PlainPage } from '../../components/plain-page';

export const metadata: Metadata = { title: 'Правовая информация' };

export default function LegalPage() {
  return (
    <PlainPage title="Правовая информация">
      <p>Оферта и политика персональных данных будут опубликованы до открытия магазина покупателям.</p>
    </PlainPage>
  );
}
