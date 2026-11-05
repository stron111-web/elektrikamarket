import type { Metadata } from 'next';
import { Golos_Text } from 'next/font/google';
import '../../../web/app/globals.css';
import './demo.css';
const golos = Golos_Text({ subsets: ['cyrillic', 'latin'], weight: ['400', '500', '600', '700'], display: 'swap' });
export const metadata: Metadata = { title: 'Три каталога — Электрика Маркет', robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body className={golos.className}><a className="demo-skip" href="#demo-main">К содержимому</a>{children}<footer className="site-footer"><div className="container demo-footer"><div><b>Электрика Маркет</b><p>Три концепции каталога. Один реальный ассортимент.</p></div><p>Демонстрационный стенд<br/>Оформление заказов отключено</p></div></footer></body></html>;
}
