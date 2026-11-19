import Link from 'next/link';
import {navigation} from '../lib/data';
import {categoryHref,menuRoots} from '../lib/navigation';
import {CategorySidebar} from '../components/category-sidebar';
export default async function Home() {
 const categories=await navigation(),roots=menuRoots(categories);
 return <div className="home-layout"><CategorySidebar categories={categories}/><section className="home-content"><div className="home-intro"><p className="eyebrow">ЭЛЕКТРИКА МАРКЕТ</p><h1>Электротовары для вашего проекта</h1><p>Кабель, освещение и оборудование. Выберите раздел или найдите товар по названию, коду и артикулу.</p><Link href="/catalog">Открыть каталог →</Link></div><h2>Разделы каталога</h2><div className="home-sections">{roots.map(c=><Link prefetch={false} href={categoryHref(c.slug)} key={c.id} title={c.name}><span className="category-label">{c.name}</span><small>{c.count.toLocaleString('ru-RU')} товаров</small><span aria-hidden="true">→</span></Link>)}</div></section></div>;
}
