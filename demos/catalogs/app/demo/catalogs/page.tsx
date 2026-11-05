import Link from 'next/link';
import { loadCatalog } from '../../../lib/data';
import { DemoHeader } from '../../../components/interactive';
import { variants, examples, href } from '../../../lib/navigation';
export const dynamic = 'force-dynamic';
export default async function Selection() {
  const data = await loadCatalog({ q: '', category: '', brand: 0, page: 1 }, 2, false);
  const common = examples(data.categories);
  return <><DemoHeader categories={data.categories}/><main id="demo-main" className="container demo-selection"><div className="demo-selection-heading"><div><p className="eyebrow">ВЫБИРАЕМ БУДУЩИЙ КАТАЛОГ</p><h1>Один магазин.<br/><em>Три способа найти своё.</em></h1><p>Попробуйте каждый маршрут: от общего раздела до конкретного товара.<br className="demo-desktop-br"/> Цены, бренды и наличие во всех вариантах одинаковые.</p></div><div className="demo-data-note"><b>{data.snapshot.productCount.toLocaleString('ru-RU')}</b><span>доступных предложений<br/>из действующего каталога</span><i>● Реальные данные · только просмотр</i></div></div>
    <div className="demo-concept-grid">{variants.map(v => <article key={v.id} className={`demo-concept demo-concept-${v.id}`}><div className="demo-concept-top"><span>КОНЦЕПЦИЯ 0{v.id}</span><span>{v.reference}</span></div><div className={`demo-wireframe demo-wireframe-${v.id}`} aria-hidden="true"><div className="demo-wire-header"/><div className="demo-wire-body"><div className="demo-wire-rail"><i/><i/><i/><i/></div><div className="demo-wire-cells">{Array.from({length:6},(_,i)=><i key={i}/>)}</div></div></div><h2>{v.name}</h2><p>{v.description}</p><Link className="demo-primary-link" href={href(v.id)}>Открыть вариант 0{v.id} <span>→</span></Link><div className="demo-concept-examples"><span>Или сразу сравнить раздел:</span>{common.map(c=><Link key={c.id} href={href(v.id,c.slug)}>{c.name} ↗</Link>)}</div></article>)}</div>
    <div className="demo-selection-foot"><div><b>Что работает</b><p>Категории, переходы, поиск, страницы товаров, цены и наличие.</p></div><div><b>Что показано как макет</b><p>Фильтры и сортировка. Они явно отмечены и не меняют выдачу.</p></div><div><b>Что сравниваем</b><p>Удобство навигации на компьютере и телефоне. Решение — за вами.</p></div></div>
  </main></>;
}
