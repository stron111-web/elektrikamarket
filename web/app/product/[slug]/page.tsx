import Link from 'next/link';
import { notFound } from 'next/navigation';
import { product, safeUrl } from '../../../lib/data';
import { money, number, unit } from '../../../lib/format';
import { duplicateBasic } from '../../../lib/product-features.cjs';
import { Gallery } from '../../../components/photo';
import '../product.css';
export const dynamic = 'force-dynamic';

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await product(slug);
  if (!data) notFound();
  const { item: p, packaging, features } = data;
  const fields: [string,unknown][] = [
    ['Серия',p.series],['Страна',Array.isArray(p.countries) ? p.countries.join(', ') : null],['Гарантия',p.guaranteePeriod],
    ...(['weight','depth','width','height'] as const).map((key):[string,unknown] => [
      {weight:'Вес',depth:'Глубина',width:'Ширина',height:'Высота'}[key],
      Number(p[key])>0 ? `${number(p[key])} ${key==='weight' ? p.weightUnit ?? '' : p.dimensionUnit ?? ''}`.trim() : null,
    ]),
    ['ТН ВЭД',p.tnved],['ОКПД2',p.okpd2],['ГОСТ',Array.isArray(p.gost) ? p.gost.join(', ') : null],['ТУ',Array.isArray(p.ty) ? p.ty.join(', ') : null],
  ];
  const basic=fields.filter(([label,v])=>v!=null && String(v).trim() && !duplicateBasic(label,v,features));
  const documentTypes: Record<string,string> = {certificate:'Сертификат',passport:'Паспорт',catalog:'Каталог',video:'Видео'};
  const documents=data.documents.flatMap(d=>{const url=safeUrl(d.url);return url?[{...d,url}]:[];});
  const images=[...new Map(data.images.flatMap(i=>{const url=safeUrl(i.url);return url?[[url,{...i,url}] as const]:[];})).values()];
  const warehouseNames:Record<string,string>={stock1:'Самара · склад №1',stock2:'Склад №2',stock3:'Склад №3'};
  const featureRows=(rows:typeof features)=><dl className="technical-list">{rows.map(f=><div key={f.key}><dt>{f.name}{f.uom && <span className="feature-unit">, {f.uom}</span>}</dt><dd>{f.values.map((v:string)=><span className="feature-value" key={v}>{v}</span>)}</dd></div>)}</dl>;
  return <article className="product-detail">
    <div className="breadcrumbs"><Link href="/catalog">Каталог</Link> / {p.categorySlug ? <Link href={`/catalog?category=${encodeURIComponent(p.categorySlug)}`}>{p.category}</Link> : 'Без категории'}</div>
    <h1 className="product-title">{p.name}</h1>
    <div className="product-identifiers"><b>{p.brand ?? 'Бренд не указан'}</b><span>Код: {p.supplierCode}</span><span>Артикул: {p.vendorNumber ?? '—'}</span></div>
    <nav className="product-anchors" aria-label="Разделы товара"><a href="#technical">Характеристики · {features.length}</a><a href="#description">Описание</a><a href="#documents">Документы · {documents.length}</a></nav>
    <div className="product-top">
      <Gallery images={images} name={p.name}/>
      <section className="purchase-panel" aria-label="Цена и наличие">
        <p className="eyebrow">РОЗНИЧНАЯ ЦЕНА</p>
        <div className="big-price">{p.price ? money(p.price.retailPrice) : 'Нет доступного предложения'}</div>
        {p.price && <p>за {unit(p.price.uom)}{p.price.uom==='NMP' ? ' — целую упаковку' : ''}</p>}
        <span className={p.stocks.length ? 'availability' : 'unavailable'}>{p.stocks.length ? '● Доступен к продаже' : 'Нет доступного остатка'}</span>
        <h2>Наличие по складам</h2>
        <dl className="stock-list">{['stock1','stock2','stock3'].map(w=>{const s=p.stocks.find(s=>s.warehouse===w);return <div key={w}><dt>{warehouseNames[w]}</dt><dd>{s ? `${number(s.quantity)} ${unit(s.uom)}` : 'Нет доступного остатка'}</dd></div>;})}</dl>
        <h2>Единица и упаковка</h2>
        <dl className="spec-list">
          <div><dt>Единица продажи</dt><dd>{p.price ? `${unit(p.price.uom)} (${p.price.uom})` : 'Не подтверждена'}</dd></div>
          <div><dt>Содержимое единицы продажи</dt><dd>{packaging?.itemsPerUnit!=null ? `${number(packaging.itemsPerUnit)}${packaging.itemsPerUom ? ' '+packaging.itemsPerUom : ' (единица содержимого не указана)'}` : 'Не указано'}</dd></div>
          <div><dt>Кратность у поставщика</dt><dd>{packaging?.multiplicityRaw==='' || packaging?.multiplicityRaw==null ? 'Не указана' : String(packaging.multiplicityRaw)}</dd></div>
        </dl>
        {p.price?.uom==='NMP' && <p className="package-note">Цена и остатки указаны за целую упаковку. Упаковки не делятся. Содержимое упаковки не является остатком в штуках.</p>}
      </section>
    </div>
    <div className="product-sections">
      <section className="content-panel product-technical" id="technical">
        <h2>Технические характеристики</h2>
        {features.length ? <><p className="muted">Характеристик ETIM: {features.length}. Данные поставщика для этого товара.</p>{featureRows(features.slice(0,10))}{features.length>10 && <details className="all-product-features"><summary>Все характеристики · {features.length} <span>ещё {features.length-10}</span></summary>{featureRows(features.slice(10))}</details>}</> : <p className="muted">Для этого товара ETIM-характеристики в каталоге поставщика не заполнены.</p>}
      </section>
      <section className="content-panel" id="description"><h2>Описание</h2><div className="description">{p.description?.trim() || 'Поставщик не добавил описание.'}</div></section>
      <section className="content-panel"><h2>Общие сведения</h2>{basic.length ? <dl className="spec-list">{basic.map(([label,v])=><div key={label}><dt>{label}</dt><dd>{String(v)}</dd></div>)}</dl> : <p className="muted">Дополнительные общие сведения не указаны.</p>}</section>
      <section className="content-panel product-documents" id="documents"><h2>Документы и видео</h2>{documents.length ? <ul className="documents">{documents.map((d,i)=>{let filename=new URL(d.url).pathname.split('/').pop()||'';try{filename=decodeURI(filename);}catch{}const ext=filename.match(/\.(pdf|docx?|xlsx?|zip|png|jpe?g)$/i)?.[1]?.toUpperCase();return <li key={i}><a href={d.url} target="_blank" rel="noopener noreferrer">↗ {d.name || filename || documentTypes[d.type] || 'Документ'}<small>{documentTypes[d.type] || 'Документ'}{ext ? ' · '+ext : ''}</small></a></li>;})}</ul> : <p className="muted">Поставщик не добавил документы.</p>}</section>
    </div>
  </article>;
}
