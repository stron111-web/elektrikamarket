'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import type {Filters,CatalogFacets} from '../lib/data';
export function CatalogFilters({filters,brands,facets}:{filters:Filters;brands:{id:number;name:string}[];facets:CatalogFacets}) {
 const [open,setOpen]=useState(true);
 useEffect(()=>{setOpen(window.matchMedia('(min-width:821px)').matches);},[]);
 const names:Record<string,string>={stock1:'Самара · склад 1',stock2:'Склад 2',stock3:'Склад 3'};
 const reset='/catalog'+(filters.category?'?category='+encodeURIComponent(filters.category):'?view=products');
 return <aside className="filter-sidebar"><details className="facet-panel" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Фильтры товаров <span aria-hidden="true">⌄</span></summary><form action="/catalog" className="facet-form">
  <input type="hidden" name="category" value={filters.category}/><input type="hidden" name="view" value="products"/>
  <label>Поиск в категории<input name="q" aria-label="Поиск в категории" defaultValue={filters.q} placeholder="Название или артикул"/></label>
  <label>Бренд<select name="brand" defaultValue={filters.brand||''}><option value="">Все бренды</option>{brands.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label>
  <fieldset><legend>Розничная цена, ₽</legend><div className="price-inputs"><label>От<input name="minPrice" inputMode="decimal" defaultValue={filters.minPrice} placeholder={facets.minPrice??'0'} maxLength={13}/></label><label>До<input name="maxPrice" inputMode="decimal" defaultValue={filters.maxPrice} placeholder={facets.maxPrice??'—'} maxLength={13}/></label></div></fieldset>
  <label>Наличие<select name="stock" defaultValue={filters.stock}><option value="">На любом складе</option>{facets.stocks.filter(s=>names[s.warehouse]).map(s=><option key={s.warehouse} value={s.warehouse}>{names[s.warehouse]} ({s.total.toLocaleString('ru-RU')})</option>)}</select></label>
  <p className="facet-note">Только доступные к продаже товары. Для выбранного склада учитывается положительный разрешённый остаток.</p><button type="submit">Применить фильтры</button><Link href={reset}>Сбросить фильтры</Link>
 </form></details></aside>;
}
