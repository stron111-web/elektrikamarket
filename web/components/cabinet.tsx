import Link from 'next/link';
import type { ReactNode } from 'react';

const links = [
  { href: '/account', label: 'Профиль' },
  { href: '/account/orders', label: 'Мои заказы' },
  { href: '/favorites', label: 'Избранное' },
  { href: '/compare', label: 'Сравнение' },
];

export function Cabinet({ title, current, children }: { title: string; current: string; children: ReactNode }) {
  return (
    <div className="cabinet">
      <nav className="cabinet-nav" aria-label="Личный кабинет">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={link.href === current ? 'current' : undefined}>{link.label}</Link>
        ))}
      </nav>
      <article>
        <h1>{title}</h1>
        {children}
      </article>
    </div>
  );
}
