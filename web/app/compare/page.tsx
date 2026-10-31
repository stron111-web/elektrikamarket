import type { Metadata } from 'next';
import { PlainPage } from '../../components/plain-page';

export const metadata: Metadata = { title: 'Сравнение' };

export default function ComparePage() {
  return (
    <PlainPage title="Сравнение">
      <p>Сравнение товаров появится здесь. Пока раздел только намечен в шапке.</p>
    </PlainPage>
  );
}
