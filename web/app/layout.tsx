import type { Metadata } from 'next';
import { SiteHeader } from '../components/site-header';
import { navigation } from '../lib/data';
import './globals.css';
import './catalog-navigation.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: { default: 'elektrikamarket — электротовары', template: '%s | elektrikamarket' }, description: 'Каталог электротоваров: оборудование, освещение, кабель и инструмент.' };
export default async function Layout({ children }: { children: React.ReactNode }) {
  const categories = await navigation();
  return <html lang="ru"><body><a className="skip-link" href="#main-content">К содержимому</a><SiteHeader categories={categories} /><main id="main-content" className="container">{children}</main><footer className="container"><b>Электрика Маркет</b><span>Электротовары · Оборудование · Освещение</span></footer></body></html>;
}
