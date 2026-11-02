import Link from 'next/link';
import { AddToCart } from '../../components/add-to-cart';
import { catalog, offerPacks, parseFilters, safeUrl, type Category } from '../../lib/data';
import { money, unit } from '../../lib/format';
import { Photo } from '../../components/photo';

export const dynamic = 'force-dynamic';

export default async function Catalog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const data = await catalog(filters);
  const byId = new Map(data.categories.map((category) => [category.id, category]));
  const byParent = new Map<number, Category[]>();
  for (const category of data.categories) {
    const parent = category.parentId != null && byId.has(category.parentId) ? category.parentId : -1;
    byParent.set(parent, [...(byParent.get(parent) ?? []), category]);
  }
  const roots = byParent.get(-1) ?? [];
  const selected = data.categories.find((category) => category.slug === filters.category);
  const children = selected ? byParent.get(selected.id) ?? [] : roots;
  const trail: Category[] = [];
  const visited = new Set<number>();
  let cursor = selected;
  while (cursor && !visited.has(cursor.id)) {
    trail.unshift(cursor);
    visited.add(cursor.id);
    cursor = cursor.parentId == null ? undefined : byId.get(cursor.parentId);
  }
  const selectedAncestors = new Set(trail.map((category) => category.id));
  const forceProducts = params.view === 'products';
  const showProducts = Boolean(filters.q || filters.brand || forceProducts || (selected && children.length === 0) || (filters.category && !selected));
  const packs = showProducts
    ? await offerPacks(data.items.map((item) => item.id))
    : new Map<number, { multiplicity: string | null; multiplicityRaw: string | null }>();

  const url = (changes: Record<string, string>) => {
    const next = new URLSearchParams({
      q: filters.q,
      category: filters.category,
      brand: filters.brand ? String(filters.brand) : '',
      view: forceProducts ? 'products' : '',
      ...changes,
    });
    for (const [key, value] of [...next]) if (!value) next.delete(key);
    return '/catalog' + (next.size ? '?' + next.toString() : '');
  };
  const categoryHref = (category: Category) => '/catalog?category=' + encodeURIComponent(category.slug);
  const subtree = (parent: number, depth = 0): React.ReactNode => (
    <ul>
      {(byParent.get(parent) ?? []).map((category) => (
        <li key={category.id}>
          <Link className={category.id === selected?.id ? 'active' : ''} href={categoryHref(category)}>{category.name}</Link>
          {selectedAncestors.has(category.id) && depth < 4 ? subtree(category.id, depth + 1) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <section className="intro catalog-intro">
        <p className="eyebrow">ЭЛЕКТРИКА МАРКЕТ · КАТАЛОГ</p>
        <h1>{selected?.name ?? (filters.q ? 'Поиск товаров' : 'Каталог электротоваров')}</h1>
        <nav className="catalog-breadcrumbs" aria-label="Путь по каталогу">
          <Link href="/catalog">Каталог</Link>
          {trail.map((category) => <span key={category.id}><span aria-hidden="true">›</span><Link href={categoryHref(category)}>{category.name}</Link></span>)}
        </nav>
      </section>
      <div className="catalog-layout">
        <aside className="sidebar catalog-sidebar">
          <h2>Разделы каталога</h2>
          <Link className={!selected ? 'active' : ''} href="/catalog">Все категории</Link>
          <nav className="category-tree" aria-label="Дерево категорий">{subtree(-1)}</nav>
        </aside>
        <section className="catalog-content">
          {!showProducts ? (
            <>
              <div className="catalog-browser-heading">
                <div>
                  <p className="eyebrow">{selected ? 'ПОДКАТЕГОРИИ' : 'ВЫБЕРИТЕ РАЗДЕЛ'}</p>
                  <h2>{selected?.name ?? 'Все категории'}</h2>
                </div>
                {selected ? <Link className="catalog-all-products" href={url({ view: 'products', page: '' })}>Все товары раздела →</Link> : null}
              </div>
              {children.length ? (
                <div className="catalog-browser-grid">
                  {children.map((category) => (
                    <article className="catalog-browser-card" key={category.id}>
                      <Link className="catalog-browser-title" href={categoryHref(category)}>{category.name} <span aria-hidden="true">›</span></Link>
                      <div className="catalog-browser-children">
                        {(byParent.get(category.id) ?? []).map((child) => (
                          <Link key={child.id} href={categoryHref(child)}>{child.name}</Link>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p className="muted">В этом разделе пока нет подкатегорий.</p>}
            </>
          ) : (
            <>
              {selected && (byParent.get(selected.id) ?? []).length > 0 && (
                <Link className="catalog-back-categories" href={categoryHref(selected)}>← Вернуться к подкатегориям</Link>
              )}
              <form className="filters" action="/catalog">
                {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}
                {forceProducts ? <input type="hidden" name="view" value="products" /> : null}
                <input name="q" defaultValue={filters.q} aria-label="Поиск в каталоге" placeholder="Название, код или артикул" />
                <select name="brand" defaultValue={filters.brand || ''} aria-label="Бренд">
                  <option value="">Все бренды</option>
                  {data.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </select>
                <button>Применить</button>
                <Link href={selected ? categoryHref(selected) : '/catalog'}>Сбросить</Link>
              </form>
              <div className="results"><span>Найдено: <b>{data.total.toLocaleString('ru-RU')}</b></span><span>Страница {data.page} из {data.pages}</span></div>
              <div className="product-grid">
                {data.items.map((item) => (
                  <article className="product-card" key={item.id}>
                    <Link prefetch={false} href={`/product/${item.slug}`} className="card-photo"><Photo src={safeUrl(item.image)} alt={item.name} /></Link>
                    <div className="card-meta">{item.brand ?? 'Бренд не указан'} · Код {item.supplierCode}</div>
                    <Link prefetch={false} href={`/product/${item.slug}`} className="card-name">{item.name}</Link>
                    <p className="article">Артикул: {item.vendorNumber ?? '—'}</p>
                    <div className="card-bottom">
                      <strong>{item.price ? money(item.price.retailPrice) : item.offerUnavailable ? 'Нет доступного предложения' : item.priceAbsent ? 'Цена отсутствует' : 'Цена не подтверждена'}</strong>
                      {item.price && <small>за {unit(item.price.uom)}{item.price.uom === 'NMP' ? ' · целая упаковка' : ''}</small>}
                      <span className={item.stocks.length ? 'availability' : 'unavailable'}>{item.stocks.length ? '● В наличии' : 'Нет доступного остатка'}</span>
                      <AddToCart productId={item.id} canBuy={Boolean(item.price && item.stocks.length)} multiplicity={packs.get(item.id)?.multiplicity ?? null} multiplicityRaw={packs.get(item.id)?.multiplicityRaw ?? null} uom={item.price?.uom ?? ''} />
                      <Link prefetch={false} className="details-link" href={`/product/${item.slug}`}>Подробнее ↗</Link>
                    </div>
                  </article>
                ))}
              </div>
              {!data.total && <div className="empty"><h2>Товары не найдены</h2><p>Попробуйте другой запрос или сбросьте фильтры.</p></div>}
              <nav className="pagination" aria-label="Страницы каталога">
                {data.page > 1 && <Link href={url({ page: String(data.page - 1) })}>← Назад</Link>}
                <span>{data.page} / {data.pages}</span>
                {data.page < data.pages && <Link href={url({ page: String(data.page + 1) })}>Далее →</Link>}
              </nav>
            </>
          )}
        </section>
      </div>
    </>
  );
}
