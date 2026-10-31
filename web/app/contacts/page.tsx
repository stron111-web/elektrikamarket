import type { Metadata } from 'next';
import { PlainPage } from '../../components/plain-page';

export const metadata: Metadata = { title: 'Контакты' };

export default function ContactsPage() {
  return (
    <PlainPage title="Контакты">
      <p>Вы можете связаться с нами любым удобным для вас способом:</p>
      <ul>
        <li>по телефону: <a href="tel:+79272129859">+7 927 212-98-59</a></li>
        <li>по электронной почте: <a href="mailto:info@elektrikamarket.ru">info@elektrikamarket.ru</a></li>
        <li>адрес: г. Тольятти, ул. Вокзальная, влд. 44, офис 104</li>
      </ul>
    </PlainPage>
  );
}
