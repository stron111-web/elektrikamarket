'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { categoryHref, categoryTrail, menuRoots, type MenuCategory, type NavigationFilters } from '../lib/navigation';

export function CatalogMenu({ categories, selectedSlug = '', filters = {}, close }: {
  categories: MenuCategory[]; selectedSlug?: string; filters?: NavigationFilters; close?: () => void;
}) {
  const departments = menuRoots(categories);
  const selected = categories.find(c => c.slug === selectedSlug);
  const initialRoot = categoryTrail(categories, selected)[0];
  const [activeId,setActiveId] = useState(initialRoot?.id ?? departments[0]?.id);
  const active = departments.find(c => c.id === activeId) ?? departments[0];
  const context = selected && initialRoot?.id===active?.id && categories.some(c=>c.parentId===selected.id) ? selected : active;
  const groups = categories.filter(c => c.parentId === context?.id);
  const weights=groups.map(g=>2+categories.filter(c=>c.parentId===g.id).length);
  const totalWeight=weights.reduce((a,b)=>a+b,0);
  let split=1,best=Infinity,weight=0;
  for(let i=0;i<groups.length-1;i++){weight+=weights[i];const delta=Math.abs(totalWeight-2*weight);if(delta<best){best=delta;split=i+1;}}
  const columns=groups.length>1?[groups.slice(0,split),groups.slice(split)]:[groups];
  const id = useId();
  return <div className="catalog-mega" aria-label="Быстрый переход по каталогу">
    <nav className="catalog-mega-roots" aria-label="Основные разделы">
      {departments.map((c,index) => <button key={c.id} type="button" aria-pressed={c.id === active?.id}
        aria-controls={id} title={c.name} onMouseEnter={() => setActiveId(c.id)} onFocus={() => setActiveId(c.id)} onClick={() => setActiveId(c.id)}
        onKeyDown={e => {
          const next = e.key === 'ArrowDown' ? (index+1)%departments.length : e.key === 'ArrowUp' ? (index+departments.length-1)%departments.length : e.key === 'Home' ? 0 : e.key === 'End' ? departments.length-1 : -1;
          if (next >= 0) { e.preventDefault(); (e.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus(); }
        }}><span className="category-label">{c.name}</span><span aria-hidden="true">›</span></button>)}
    </nav>
    <label className="catalog-mega-mobile">Основной раздел
      <select value={active?.id} onChange={e => setActiveId(Number(e.target.value))}>
        {departments.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}
      </select>
    </label>
    <section id={id} className="catalog-mega-content" aria-label={context?.name ?? 'Группы каталога'}>
      <div className="catalog-mega-heading"><div><span className="eyebrow">ВЫБЕРИТЕ ТОВАРНУЮ ГРУППУ</span><h2 className="category-label" title={context?.name}>{context?.name}</h2></div>
        {context && <Link prefetch={false} href={categoryHref(context.slug,filters,true)} onClick={close}>Все товары раздела <span aria-hidden="true">→</span></Link>}
      </div>
      <div className={'catalog-mega-columns'+(groups.length===1?' single-group':'')}>{columns.map((column,index)=><div className="catalog-mega-column" key={index}>{column.map(group => <section key={group.id}>
        <Link prefetch={false} className="catalog-mega-group" title={group.name} href={categoryHref(group.slug,filters)} onClick={close}>
          <span className="category-label">{group.name}</span><small>{group.count.toLocaleString('ru-RU')}</small>
        </Link>
        {categories.filter(c => c.parentId === group.id).map(child => <Link prefetch={false} title={child.name}
          key={child.id} href={categoryHref(child.slug,filters)} onClick={close}>
          <span className="category-label">{child.name}</span><small>{child.count.toLocaleString('ru-RU')}</small>
        </Link>)}
      </section>)}</div>)}</div>
      {!groups.length && active && <Link className="all-products-link" href={categoryHref(active.slug,filters)} onClick={close}>Посмотреть товары →</Link>}
    </section>
  </div>;
}
