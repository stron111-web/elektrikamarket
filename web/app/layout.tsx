import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
export const metadata: Metadata = { title: { default: 'elektrikamarket — электротовары', template: '%s | elektrikamarket' }, description: 'Каталог электротоваров: оборудование, освещение, кабель и инструмент.' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body><div className="topline"><div className="container">Электрика для дома и профессиональных задач <span>Локальная витрина</span></div></div><header><div className="container header"><Link href="/" className="logo"><b>ϟ</b> elektrika<span>market</span></Link><form action="/catalog" className="search"><input name="q" aria-label="Поиск товаров" placeholder="Название, код или артикул товара" /><button>Найти</button></form></div><nav className="container"><Link href="/catalog">☰ Каталог товаров</Link><Link href="/catalog?q=кабель">Кабель и провод</Link><Link href="/catalog?q=светильник">Освещение</Link><Link href="/catalog?q=инструмент">Инструмент</Link></nav></header><main className="container">{children}</main><footer className="container"><b>elektrikamarket</b><span>Электротовары · Оборудование · Освещение</span></footer></body></html>;
}
