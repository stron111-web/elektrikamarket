import type { Metadata } from 'next';
import { PlainPage } from '../../components/plain-page';

export const metadata: Metadata = { title: 'Производители' };

export default function BrandsPage() {
  return (
    <PlainPage title="Производители">
      <p>Каталог брендов появится здесь. В списке товаров бренд уже можно выбрать фильтром.</p>
    </PlainPage>
  );
}
