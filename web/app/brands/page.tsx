import type { Metadata } from 'next';
import { ShopPage } from '../../components/shop-page';

export const metadata: Metadata = { title: 'Производители' };

export default function BrandsPage() {
  return (
    <ShopPage slug="brands" title="Производители">
      <p>Каталог брендов появится здесь. В списке товаров бренд уже можно выбрать фильтром.</p>
    </ShopPage>
  );
}
