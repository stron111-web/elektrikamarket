import type { Metadata } from 'next';
import { Golos_Text } from 'next/font/google';
import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';
import { PaymentWatcher } from '../components/payment-watcher';
import { cartCount } from '../lib/cart';
import { compareIds, guestCompareIds } from '../lib/lists';
import { currentBuyer } from '../lib/session';
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

export default async function Layout({ children }: { children: React.ReactNode }) {
  const buyer = await currentBuyer();
  const count = buyer
    ? await compareIds(buyer.id).then((ids) => ids.length).catch(() => 0)
    : await guestCompareIds().catch(() => []).then((ids) => ids.length);
  const basket = await cartCount(buyer?.id);
  return (
    <html lang="ru">
      <body className={golos.className}>
        <PaymentWatcher />
        <SiteHeader buyer={buyer} compareCount={count} cartCount={basket} />
        <main className="container">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
