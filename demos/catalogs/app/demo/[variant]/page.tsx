import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadCatalog } from '../../../lib/data';
import { href, roots, variants, trail, examples } from '../../../lib/navigation';
import { DemoHeader, DemoFilters, MegaMenu } from '../../../components/interactive';
import { Breadcrumbs, VariantSwitch, CategoryTile, ContextRail, ProductCard } from '../../../components/catalog-ui';
import type { Variant } from '../../../lib/types';
export const dynamic = 'force-dynamic';
export default async function Demo({ params, searchParams }: { params: Promise<{ variant: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { variant: segment } = await params;
  if (!/^catalog-v[123]$/.test(segment)) notFound();
  const variant = Number(segment.slice(-1)) as Variant;
  const p = await searchParams;
  const value = (key: string) => typeof p[key] === 'string' ? p[key] as string : '';
  const filters = { q: value('q').trim().slice(0,120), category: value('category').slice(0,200), brand: 0, page: /^\d{1,6}$/.test(value('page')) ? Math.max(1,Number(value('page'))) : 1 };
  const force = value('view') === 'products';
  const { categories, snapshot, selected, children, catalog } = await loadCatalog(filters, variant, force);
  if (filters.category && !selected) notFound();
  const path = trail(categories, selected), root = path[0], home = !selected && !filters.q;
  const title = filters.q ? `Результаты поиска «${filters.q}»` : selected?.name ?? 'Каталог электротоваров';
  const common = examples(categories), departments = roots(categories), current = variants[variant-1];
  const groups = selected ? children : departments;
  const brands = [...new Set(catalog?.items.flatMap(i => i.brand ? [i.brand] : []) ?? [])];
  return <><DemoHeader variant={variant} categories={categories} category={filters.category} q={filters.q} rootId={root?.id}/><main id="demo-main" className={`container demo-page demo-v${variant}`}>
    <VariantSwitch variant={variant} category={filters.category} q={filters.q} page={catalog?.page ?? 1} products={force}/>
    <Breadcrumbs categories={categories} selected={selected} variant={variant}/>
    <div className="demo-page-heading"><div><p className="eyebrow">ВАРИАНТ 0{variant} · {current.reference.toLocaleUpperCase('ru-RU')}</p><h1>{title}</h1><p>{catalog ? `${catalog.total.toLocaleString('ru-RU')} предложений` : home ? current.description : `${selected?.count.toLocaleString('ru-RU')} предложений · выберите товарную группу`}</p></div>{selected && !catalog && <Link className="demo-outline-link" href={href(variant, selected.slug, '', 1, true)}>Все товары раздела →</Link>}</div>
    {home && variant === 1 && <><div className="demo-instruction"><span>01</span><p><b>Выберите раздел слева.</b> Справа сразу видны группы и подгруппы — переходите к нужным товарам.</p></div><MegaMenu categories={categories} variant={variant}/><div className="demo-quick-strip"><b>Для сравнения</b>{common.map(c=><Link key={c.id} href={href(variant,c.slug)}>{c.name} →</Link>)}</div></>}
    {home && variant === 3 && <section className="demo-hybrid-start"><div><span className="demo-kicker">ЕСЛИ УЖЕ ЗНАЕТЕ, ЧТО ИЩЕТЕ</span><h2>К нужной группе —<br/>коротким путём.</h2><p>Выберите товарную группу или откройте большой каталог в шапке.</p></div><div className="demo-hybrid-shortcuts">{common.map(c=><CategoryTile key={c.id} category={c} variant={variant} compact/>)}</div></section>}
    {!catalog && !(home && variant === 1) && <div className={variant === 3 && selected ? 'demo-explorer-context' : ''}>{variant === 3 && selected && <ContextRail categories={categories} selected={selected} variant={variant}/>}<section className="demo-explorer" aria-label="Подкатегории"><div className="demo-section-heading"><h2>{home ? 'Все разделы каталога' : 'Выберите подкатегорию'}</h2><span>{groups.length} {home ? 'разделов' : 'групп'}</span></div>{variant === 3 && selected ? <div className="demo-branch-list">{groups.map(c=><article key={c.id}><div className="demo-branch-head"><Link href={href(variant,c.slug)}>{c.name} <span>→</span></Link><small>{c.count.toLocaleString('ru-RU')} предложений</small></div><div className="demo-sibling-chips">{categories.filter(child=>child.parentId===c.id).map(child=><Link key={child.id} href={href(variant,child.slug)}>{child.name}</Link>)}</div></article>)}</div> : <div className={`demo-category-grid ${variant===3?'demo-hybrid-grid':''}`}>{groups.map(c=><CategoryTile key={c.id} category={c} variant={variant} children={categories.filter(child=>child.parentId===c.id)}/>)}</div>}</section></div>}
    {catalog && <>{children.length>0 && <nav className="demo-sibling-chips demo-child-chips" aria-label="Уточнить категорию">{children.map(c=><Link key={c.id} href={href(variant,c.slug)}>{c.name} <small>{c.count.toLocaleString('ru-RU')}</small></Link>)}</nav>}<div className="demo-products-layout"><div className="demo-left-column">{variant===3 && selected && <ContextRail categories={categories} selected={selected} variant={variant}/>}<DemoFilters key={selected?.id ?? 'search'} family={path.map(c=>c.name).join(' ')} brands={brands}/></div><section className="demo-listing"><div className="demo-list-toolbar"><div><b>{catalog.total.toLocaleString('ru-RU')}</b> предложений <span>· страница {catalog.page} из {catalog.pages}</span></div><label>Сортировка <select disabled aria-label="Сортировка — демонстрация"><option>По умолчанию · демо</option></select></label></div>{catalog.searchMode==='typo' && <p className="demo-search-note">Точных совпадений нет. Показаны близкие варианты написания.</p>}{catalog.items.length ? <div className="product-grid demo-products">{catalog.items.map(item=><ProductCard key={item.id} item={item} variant={variant}/>)}</div> : <div className="empty"><h2>Товары не найдены</h2><p>Попробуйте другой запрос или вернитесь к разделам.</p><Link className="demo-primary-link" href={href(variant,filters.category)}>Сбросить поиск →</Link></div>}<nav className="pagination" aria-label="Страницы товаров">{catalog.page>1 && <Link href={href(variant,filters.category,filters.q,catalog.page-1,force)}>← Назад</Link>}<span>{catalog.page} / {catalog.pages}</span>{catalog.page<catalog.pages && <Link href={href(variant,filters.category,filters.q,catalog.page+1,force)}>Далее →</Link>}</nav></section></div></>}
    <div className="demo-source-note">Цены и доступные остатки из действующего ассортимента · {snapshot.productCount.toLocaleString('ru-RU')} предложений. Заказы на этом стенде не оформляются.</div>
  </main></>;
}
