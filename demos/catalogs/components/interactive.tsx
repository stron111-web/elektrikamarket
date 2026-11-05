'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Category, Variant } from '../lib/types';
import { href, roots } from '../lib/navigation';

export function MegaMenu({ categories, variant, close, initialRoot }: { categories: Category[]; variant: Variant; close?: () => void; initialRoot?: number }) {
  const departments = roots(categories);
  const [activeId, setActiveId] = useState(initialRoot ?? departments[0]?.id);
  const active = departments.find(c => c.id === activeId) ?? departments[0];
  const groups = categories.filter(c => c.parentId === active?.id);
  return <div className="demo-mega" aria-label="Быстрый переход по каталогу">
    <nav className="demo-mega-roots" aria-label="Основные разделы">{departments.map(c => <button key={c.id} type="button" aria-pressed={c.id === active?.id} onMouseEnter={() => setActiveId(c.id)} onFocus={() => setActiveId(c.id)} onClick={() => setActiveId(c.id)}><span>{c.name}</span><span aria-hidden="true">›</span></button>)}</nav>
    <label className="demo-mega-mobile">Основной раздел<select value={active?.id} onChange={e => setActiveId(Number(e.target.value))}>{departments.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="demo-mega-content"><div className="demo-mega-heading"><div><span className="demo-kicker">БЫСТРЫЙ ПЕРЕХОД</span><h2>{active?.name}</h2></div>{active && <Link prefetch={false} href={href(variant, active.slug)} onClick={close}>Весь раздел →</Link>}</div>
      <div className="demo-mega-columns">{groups.map(group => <section key={group.id}><Link prefetch={false} className="demo-mega-group" href={href(variant, group.slug)} onClick={close}>{group.name}</Link>{categories.filter(c => c.parentId === group.id).map(child => <Link prefetch={false} key={child.id} href={href(variant, child.slug)} onClick={close}>{child.name}<small>{child.count.toLocaleString('ru-RU')}</small></Link>)}</section>)}</div>
      {!groups.length && active && <Link className="demo-primary-link" href={href(variant, active.slug)} onClick={close}>Посмотреть товары →</Link>}
    </div>
  </div>;
}

export function DemoHeader({ variant = 1, categories, category = '', q = '', rootId }: { variant?: Variant; categories: Category[]; category?: string; q?: string; rootId?: number }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!open) return; const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [open]);
  return <header className="site-header demo-header">
    <div className="topbar"><div className="container topbar-inner"><span>Электрика Маркет · каталог электротоваров</span><span className="demo-access">Демоверсия · только просмотр</span></div></div>
    <div className="container header-main"><Link href="/demo/catalogs" className="site-logo" aria-label="Электрика Маркет — выбор демоверсии"><img src="/brand/logo.png?v=2" alt="Электрика Маркет"/></Link><form className="site-search" action={href(variant)}><input key={`${category}:${q}`} name="q" defaultValue={q} aria-label="Поиск товаров" placeholder="Название, код или артикул товара"/>{category && <input type="hidden" name="category" value={category}/>}<button type="submit">Найти</button></form><div className="demo-cart" title="Заказы в демоверсии не оформляются"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7h4l3 13h12l3-10H11M14 25h.01M23 25h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg><span>Корзина <small>демо</small></span></div></div>
    <div className="container section-nav">{variant === 2 ? <Link className="catalog-toggle" href={href(variant)}>☰ Каталог товаров</Link> : <button ref={button} className="catalog-toggle" aria-controls="demo-global-menu" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '× Закрыть каталог' : '☰ Каталог товаров'}</button>}<nav aria-label="Навигация демонстрации"><Link href="/demo/catalogs">Все три варианта</Link><span className="demo-header-note">Одинаковые товары. Разные пути.</span></nav></div>
    {open && <><button className="demo-menu-backdrop" aria-label="Закрыть меню" onClick={() => setOpen(false)}/><div id="demo-global-menu" className="demo-menu-overlay"><div className="container"><MegaMenu categories={categories} variant={variant} initialRoot={rootId} close={() => setOpen(false)}/></div></div></>}
  </header>;
}

type Group = { name: string; values?: string[]; range?: boolean };
export function DemoFilters({ family, brands }: { family: string; brands: string[] }) {
  const lamp = /ламп|освещ/i.test(family), breaker = /выключател|низковольт/i.test(family), cable = /кабел|провод/i.test(family);
  const specific: Group[] = lamp ? [{ name: 'Цоколь', values: ['E27', 'E14', 'GU10', 'G13'] }, { name: 'Мощность, Вт', range: true }, { name: 'Цветовая температура, К', values: ['2700', '3000', '4000', '6500'] }, { name: 'Напряжение, В', values: ['12', '24', '220–240'] }] : breaker ? [{ name: 'Номинальный ток, А', values: ['6', '10', '16', '25', '32', '63'] }, { name: 'Количество полюсов', values: ['1', '2', '3', '4'] }, { name: 'Характеристика отключения', values: ['B', 'C', 'D'] }] : cable ? [{ name: 'Марка', values: ['ВВГнг(А)-LS', 'ПВС', 'КГ', 'NYM'] }, { name: 'Сечение, мм²', values: ['1,5', '2,5', '4', '6', '10'] }, { name: 'Количество жил', values: ['2', '3', '4', '5'] }] : [];
  const groups: Group[] = [{ name: 'Цена, ₽', range: true }, ...specific, { name: 'Бренды на этой странице', values: brands.slice(0, 8) }];
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [ranges, setRanges] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const apply = () => { setNotice('Демонстрация: выбор сохранён на экране. Список товаров не изменён.'); dialog.current?.close(); };
  const reset = () => { setPicked({}); setRanges({}); setNotice('Демонстрационный выбор сброшен.'); };
  const content = <><div className="demo-filter-title"><h2>Фильтры</h2><span className="demo-pill">МАКЕТ</span></div><p className="demo-filter-explanation">Пример интерфейса. Эти условия пока не меняют выдачу.</p>{groups.map((g, index) => <details className="demo-filter-group" key={g.name} open={index < 3}><summary>{g.name}<span aria-hidden="true">⌄</span></summary>{g.range ? <div className="demo-range">{['от', 'до'].map(edge => <label key={edge}><span>{edge}</span><input type="number" min="0" placeholder="—" aria-label={`${g.name} ${edge}`} value={ranges[g.name + edge] ?? ''} onChange={e => setRanges({ ...ranges, [g.name + edge]: e.target.value })}/></label>)}</div> : <div className="demo-checks">{g.values?.length ? g.values.map(value => <label key={value}><input type="checkbox" checked={Boolean(picked[g.name + value])} onChange={e => setPicked({ ...picked, [g.name + value]: e.target.checked })}/><span>{value}</span></label>) : <p className="muted">В этом списке бренды не указаны</p>}</div>}</details>)}<div className="demo-filter-actions"><button type="button" onClick={apply}>Применить · демо</button><button type="button" className="demo-reset" onClick={reset}>Сбросить</button></div></>;
  return <><button className="demo-mobile-filters" onClick={() => dialog.current?.showModal()}>☷ Фильтры <span>демо</span></button><aside className="demo-filter-desktop">{content}</aside><dialog ref={dialog} className="demo-filter-dialog"><button className="demo-dialog-close" aria-label="Закрыть фильтры" onClick={() => dialog.current?.close()}>×</button>{content}</dialog><p className="demo-filter-notice" role="status">{notice}</p></>;
}
