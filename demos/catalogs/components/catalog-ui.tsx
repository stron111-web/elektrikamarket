import Link from 'next/link';
import { Photo } from './preview/photo';
import { DepartmentIcon } from './preview/department-icon';
import { money, number, unit } from '../lib/format';
import { href, variants, iconKey, trail } from '../lib/navigation';
import { safeImage } from '../lib/data';
import type { Category, Item, Variant } from '../lib/types';

export function VariantSwitch({ variant, category = '', q = '', page = 1, products = false }: { variant: Variant; category?: string; q?: string; page?: number; products?: boolean }) {
  return <div className="demo-comparison"><div><b>Сравните этот раздел</b><span>Стиль Preview · три способа навигации</span></div><nav aria-label="Переключение демоверсий">{variants.map(v => <Link prefetch={false} aria-current={variant === v.id ? 'page' : undefined} key={v.id} href={href(v.id, category, q, page, products)}><span>0{v.id}</span>{v.name}</Link>)}</nav></div>;
}
export function Breadcrumbs({ categories, selected, variant }: { categories: Category[]; selected?: Category; variant: Variant }) {
  const path = trail(categories, selected);
  return <nav className="demo-breadcrumbs" aria-label="Хлебные крошки"><Link href={href(variant)}>Каталог</Link>{path.map((c, i) => <span key={c.id}><i aria-hidden="true">/</i>{i === path.length - 1 ? <b aria-current="page">{c.name}</b> : <Link href={href(variant, c.slug)}>{c.name}</Link>}</span>)}</nav>;
}
export function CategoryTile({ category, variant, children = [], compact = false }: { category: Category; variant: Variant; children?: Category[]; compact?: boolean }) {
  return <article className={`demo-category-tile ${compact ? 'demo-tile-compact' : ''}`}><Link className="demo-tile-main" href={href(variant, category.slug)}><DepartmentIcon id={iconKey(category.name)}/><div><h3>{category.name}</h3><span>{category.count.toLocaleString('ru-RU')} предложений</span></div><b aria-hidden="true">↗</b></Link>{!compact && children.length > 0 && <div className="demo-tile-preview">{children.slice(0, 3).map(c => variant === 2 ? <span key={c.id}>{c.name}</span> : <Link key={c.id} href={href(variant, c.slug)}>{c.name}</Link>)}</div>}</article>;
}
export function ContextRail({ categories, selected, variant }: { categories: Category[]; selected: Category; variant: Variant }) {
  const path = trail(categories, selected), parent = path[path.length - 2];
  const siblings = categories.filter(c => c.parentId === selected.parentId);
  return <nav className="demo-context" aria-label="Навигация по текущему разделу"><Link className="demo-up" href={href(variant, parent?.slug)}>← {parent ? parent.name : 'Все разделы'}</Link><span className="demo-kicker">НА ЭТОМ УРОВНЕ</span>{siblings.map(c => <Link prefetch={false} key={c.id} href={href(variant, c.slug)} aria-current={c.id === selected.id ? 'page' : undefined}>{c.name}<small>{c.count.toLocaleString('ru-RU')}</small></Link>)}</nav>;
}
export function ProductCard({ item, variant }: { item: Item; variant: Variant }) {
  const url = `/demo/catalog-v${variant}/product/${item.slug}`;
  return <article className="product-card demo-product" data-product-code={item.supplierCode}><Link prefetch={false} className="card-photo" href={url} aria-label={item.name}><Photo src={safeImage(item.image)} alt={item.name}/></Link><div className="card-meta">{item.brand ?? 'Бренд не указан'} <span>Код {item.supplierCode}</span></div><Link prefetch={false} className="card-name" href={url}>{item.name}</Link><p className="article">Артикул: {item.vendorNumber ?? '—'}</p><div className="card-bottom"><strong>{item.price ? money(item.price.retailPrice) : 'Нет предложения'}</strong>{item.price && <small>за {unit(item.price.uom)}{item.price.uom === 'NMP' ? ' · целая упаковка' : ''}</small>}<span className="availability">● В наличии</span><div className="demo-stock-summary">{item.stocks.map(s => <span key={s.warehouse}>{({stock1:'Самара',stock2:'Склад 2',stock3:'Склад 3'} as Record<string,string>)[s.warehouse] ?? s.warehouse}: {number(s.quantity)} {unit(s.uom)}</span>)}</div><Link prefetch={false} className="details-link" href={url}>Посмотреть товар →</Link></div></article>;
}
