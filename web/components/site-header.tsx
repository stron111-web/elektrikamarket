'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { CatalogMenu } from './catalog-menu';
import type { MenuCategory } from '../lib/navigation';
import {parseCatalogFilters} from '../../scripts/storefront/filters.cjs';
import {EtimInputs} from './etim-inputs';

export function SiteHeader({categories}: {categories: MenuCategory[]}) {
  const pathname = usePathname(), search = useSearchParams();
  const filters=parseCatalogFilters({...Object.fromEntries(search.entries()),etim:search.getAll('etim')});
  const route = pathname + '?' + search.toString();
  const [open,setOpen] = useState(false), toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); },[route]);
  useEffect(() => {
    if (!open) return;
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); toggle.current?.focus(); } };
    window.addEventListener('keydown',escape); return () => window.removeEventListener('keydown',escape);
  },[open]);
  return <header className="site-header" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <div className="header-shell"><div className="topbar"><div className="container topbar-inner">
      <nav aria-label="Быстрые разделы"><Link href="/catalog">Каталог</Link><Link href="/catalog?q=кабель">Кабель и провод</Link><Link href="/catalog?q=светильник">Освещение</Link><Link href="/catalog?q=инструмент">Инструмент</Link></nav>
      <span>Электрика для дома и профессиональных задач</span>
    </div></div>
    <div className="container header-main"><Link href="/" className="site-logo" aria-label="Электрика Маркет, на главную" onClick={() => setOpen(false)}>
      <img src="/brand/logo.png" width="86" height="86" alt="Электрика Маркет" />
    </Link><form action="/catalog" className="site-search" id="site-search">{['category','brand','minPrice','maxPrice','stock','sort','view'].map(k=>search.get(k)?<input type="hidden" key={k} name={k} value={search.get(k)??''}/>:null)}<EtimInputs filters={filters}/><input key={search.get('q') ?? ''} name="q" defaultValue={search.get('q') ?? ''} aria-label="Поиск товаров" placeholder="Название, код или артикул товара" /><button type="submit">Найти</button></form></div>
    <div className="container section-nav"><button type="button" ref={toggle} className="catalog-toggle" aria-expanded={open} aria-controls="header-catalog-menu" onClick={() => setOpen(v => !v)}><span aria-hidden="true">☰</span> Каталог товаров</button>
      <Link href="/catalog?view=products">Все товары</Link><span className="header-tagline">Оборудование · Кабель · Освещение</span>
    </div></div>
    {open && <><button className="catalog-backdrop" aria-label="Закрыть меню каталога" onClick={() => setOpen(false)} />
      <div className="catalog-popover" id="header-catalog-menu"><div className="container"><CatalogMenu key={search.get('category') ?? ''} categories={categories}
        selectedSlug={search.get('category') ?? ''} filters={{q:search.get('q') ?? '',brand:Number(search.get('brand')) || 0}} close={() => setOpen(false)} /></div></div>
    </>}
  </header>;
}
