import type { Metadata } from 'next';
import { ShopPage } from '../../components/shop-page';

export const metadata: Metadata = { title: 'Сертификаты' };

export default function CertificatesPage() {
  return (
    <ShopPage slug="certificates" title="Сертификаты">
      <p>Сертификаты компании появятся здесь. Документы конкретного товара по-прежнему открываются в его карточке.</p>
    </ShopPage>
  );
}
