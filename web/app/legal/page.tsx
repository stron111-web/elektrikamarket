import type { Metadata } from 'next';
import { ShopPage } from '../../components/shop-page';

export const metadata: Metadata = { title: 'Правовая информация' };

export default function LegalPage() {
  return (
    <ShopPage slug="legal" title="Правовая информация">
      <p>Оферта и политика персональных данных будут опубликованы до открытия магазина покупателям.</p>
    </ShopPage>
  );
}
