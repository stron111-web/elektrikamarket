import type { Metadata } from 'next';
import { PlainPage } from '../../components/plain-page';

export const metadata: Metadata = { title: 'Сертификаты' };

export default function CertificatesPage() {
  return (
    <PlainPage title="Сертификаты">
      <p>Сертификаты компании появятся здесь. Документы конкретного товара по-прежнему открываются в его карточке.</p>
    </PlainPage>
  );
}
