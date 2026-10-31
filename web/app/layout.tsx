import type { Metadata } from 'next';
import { Golos_Text } from 'next/font/google';
import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';
import './globals.css';

const golos = Golos_Text({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Электрика Маркет — электротовары', template: '%s | Электрика Маркет' },
  description: 'Каталог электротоваров: оборудование, освещение, кабель и инструмент. Тольятти.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className={golos.className}>
        <SiteHeader />
        <main className="container">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
