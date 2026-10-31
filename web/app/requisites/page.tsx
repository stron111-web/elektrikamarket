import type { Metadata } from 'next';
import { PlainPage } from '../../components/plain-page';

export const metadata: Metadata = { title: 'Реквизиты' };

export default function RequisitesPage() {
  return (
    <PlainPage title="Реквизиты">
      <p>Юридическое название и ИНН поставим сюда, когда вы их пришлёте. Телефон и почта уже указаны в подвале.</p>
    </PlainPage>
  );
}
