import { PlainPage } from '../../components/plain-page';

export default function EstimatePage() {
  return (
    <PlainPage title="Смета по вашему списку">
      <p>Петрович на главной — это приглашение прислать список: Excel, фото, PDF или рукописный лист. Файл на сайт пока не загружается.</p>
      <p>Сейчас список можно отправить двумя рабочими способами:</p>
      <ul>
        <li><a href="https://max.ru/" target="_blank" rel="noopener noreferrer">написать в MAX</a>;</li>
        <li><a href="mailto:info@elektrikamarket.ru">отправить на info@elektrikamarket.ru</a>.</li>
      </ul>
      <p>Стрелка «Отправить в чат» на рисунке — это будущий чат Jivo. Его на новом сайте ещё нет, поэтому баннер открывает эту страницу, а не пустую ссылку.</p>
    </PlainPage>
  );
}
