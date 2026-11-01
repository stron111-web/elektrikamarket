import type { Metadata } from 'next';
import { ShopPage } from '../../components/shop-page';

export const metadata: Metadata = { title: 'Реквизиты' };

export default function RequisitesPage() {
  return (
    <ShopPage slug="requisites" title="Реквизиты">
      <ul>
        <li>Сокращённое наименование: ООО «ТОЛЬЯТТИНСКАЯ КАБЕЛЬНАЯ КОМПАНИЯ»</li>
        <li>Полное наименование: ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «ТОЛЬЯТТИНСКАЯ КАБЕЛЬНАЯ КОМПАНИЯ»</li>
        <li>ИНН: 6323061940</li>
        <li>КПП: 632001001</li>
        <li>ОГРН: 1036301010866</li>
        <li>Дата регистрации: 19.09.2001</li>
        <li>Реестр СМиСП: не числится</li>
        <li>Юридический адрес: 445043, Самарская область, г.о. Тольятти, г. Тольятти, ул. Вокзальная, влд. 44, офис 104</li>
      </ul>
    </ShopPage>
  );
}
