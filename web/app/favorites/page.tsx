import type { Metadata } from 'next';
import { PlainPage } from '../../components/plain-page';

export const metadata: Metadata = { title: 'Избранное' };

export default function FavoritesPage() {
  return (
    <PlainPage title="Избранное">
      <p>Избранные товары появятся здесь. Пока раздел только намечен в шапке.</p>
    </PlainPage>
  );
}
