import {navigation} from '../lib/data';
import {CategorySidebar} from '../components/category-sidebar';
export default async function Home() {
 const categories=await navigation();
 return <div className="home-layout"><h1 className="visually-hidden">Электрика Маркет — каталог электротоваров</h1><CategorySidebar categories={categories}/><div className="petrovich-banner"><img src="/brand/petrovich.jpg" alt="Петрович: Электрика Маркет — 20 лет опыта, широкий ассортимент электротоваров"/></div></div>;
}
