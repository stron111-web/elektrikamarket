import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadCatalog, loadProduct, safeImage } from '../../../../../lib/data';
import { DemoHeader } from '../../../../../components/interactive';
import { VariantSwitch, Breadcrumbs } from '../../../../../components/catalog-ui';
import { Photo } from '../../../../../components/preview/photo';
import { money, number, unit } from '../../../../../lib/format';
import { href } from '../../../../../lib/navigation';
import type { Variant } from '../../../../../lib/types';
export const dynamic = 'force-dynamic';
export default async function Product({ params }: { params: Promise<{ variant: string; slug: string }> }) {
  const { variant: segment, slug } = await params;
  if (!/^catalog-v[123]$/.test(segment)) notFound();
  const variant = Number(segment.slice(-1)) as Variant;
  const item = await loadProduct(slug);if(!item)notFound();
  const { categories, selected } = await loadCatalog({q:'',category:item.categorySlug??'',brand:0,page:1},2,false);
  return <><DemoHeader categories={categories} variant={variant} category={item.categorySlug??''}/><main id="demo-main" className="container demo-page"><VariantSwitch variant={variant} category={item.categorySlug??''}/><Breadcrumbs categories={categories} selected={selected} variant={variant}/><Link className="demo-back" href={href(variant,item.categorySlug??'')}>← К товарам категории</Link><h1 className="demo-product-title">{item.name}</h1><p className="product-identifiers"><span>Код: <b>{item.supplierCode}</b></span><span>Артикул: <b>{item.vendorNumber??'—'}</b></span><span>Бренд: <b>{item.brand??'не указан'}</b></span></p><div className="product-top"><div className="gallery demo-detail-photo"><Photo src={safeImage(item.image)} alt={item.name}/></div><section className="purchase-panel"><p className="eyebrow">РЕАЛЬНЫЕ ЦЕНА И НАЛИЧИЕ</p><strong className="big-price">{item.price?money(item.price.retailPrice):'Нет предложения'}</strong>{item.price&&<p>за {unit(item.price.uom)}</p>}<h2>Доступно на складах</h2><dl className="stock-list">{item.stocks.map(s=><div key={s.warehouse}><dt>{s.warehouse==='stock1'?'Самара · склад 1':s.warehouse==='stock2'?'Склад 2':'Склад 3'}</dt><dd>{number(s.quantity)} {unit(s.uom)}</dd></div>)}</dl><p className="demo-detail-note">Это демонстрация каталога. Корзина и оформление заказа отключены.</p><Link className="demo-primary-link" href={href(variant,item.categorySlug??'')}>Продолжить просмотр →</Link></section></div>{item.description&&<section className="content-panel demo-description"><h2>Описание</h2><p className="description">{item.description}</p></section>}</main></>;
}
