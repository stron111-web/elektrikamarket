import Link from 'next/link';

const companyLinks = [
  { href: '/about', label: 'О нас' },
  { href: '/contacts', label: 'Контакты' },
  { href: '/requisites', label: 'Реквизиты' },
  { href: '/certificates', label: 'Сертификаты' },
  { href: '/brands', label: 'Производители' },
  { href: '/legal', label: 'Правовая информация' },
  { href: '/delivery', label: 'Оплата' },
  { href: '/delivery#delivery', label: 'Доставка' },
  { href: '/delivery#pickup', label: 'Пункты выдачи' },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-company">
        <div className="footer-brand">
          <b>Электрика Маркет</b>
          <p>Магазин электротехники в Тольятти</p>
        </div>
        <a className="footer-phone" href="tel:+79272129859">+7 927 212-98-59</a>
        <a className="footer-mail" href="mailto:info@elektrikamarket.ru">info@elektrikamarket.ru</a>
      </div>
      <nav className="container footer-links" aria-label="О компании">
        {companyLinks.map((link) => (
          <Link key={link.href} href={link.href}>{link.label}</Link>
        ))}
      </nav>
      <div className="container footer-copy">© 2024–2026 Электрика Маркет</div>
    </footer>
  );
}
