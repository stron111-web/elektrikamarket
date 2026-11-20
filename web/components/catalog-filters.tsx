'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import type {Filters,CatalogFacets} from '../lib/data';
import {EtimFilters} from './etim-filters';
import {etimTokens} from '../../scripts/storefront/etim.cjs';
export function CatalogFilters({filters,brands,facets}:{filters:Filters;brands:{id:number;name:string}[];facets:CatalogFacets}) {
 const [open,setOpen]=useState(true);
 useEffect(()=>{setOpen(window.matchMedia('(min-width:821px)').matches);},[]);
 const names:Record<string,string>={stock1:'Самара · склад 1',stock2:'Склад 2',stock3:'Склад 3'};
 const reset='/catalog'+(filters.category?'?category='+encodeURIComponent(filters.category):'?view=products');
 const [selected,setSelected]=useState(()=>new Set(etimTokens(filters.etim))),[warning,setWarning]=useState('');
 function choose(value:string,checked:boolean){
  const next=new Set(selected);if(checked)next.add(value);else next.delete(value);
  const groups=new Map<string,number>();for(const v of next){const a=JSON.parse(v);const k=JSON.stringify(a.slice(0,3));groups.set(k,(groups.get(k)||0)+1);}
  if(groups.size>8||[...groups.values()].some(n=>n>8)||[...next].reduce((n,v)=>n+encodeURIComponent(v).length,0)>6000){setWarning('Достигнут предел выбора: до 8 характеристик и 8 значений каждой, с ограничением длины ссылки. Снимите одно из выбранных значений.');return;}
  setWarning('');setSelected(next);
 }
 const unavailable=etimTokens(filters.etim).some(v=>!facets.etim.some(f=>f.options.some(o=>o.token===v)));
 return <aside className="filter-sidebar"><details className="facet-panel" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Фильтры товаров <span aria-hidden="true">⌄</span></summary><form action="/catalog" className="facet-form">
  <input type="hidden" name="category" value={filters.category}/><input type="hidden" name="view" value="products"/><input type="hidden" name="sort" value={filters.sort}/>
  <label>{filters.category?'Поиск в категории':'Поиск в выдаче'}<input name="q" aria-label={filters.category?'Поиск в категории':'Поиск в выдаче'} defaultValue={filters.q} placeholder="Название или артикул"/></label>
  <label>Бренд<select name="brand" defaultValue={filters.brand||''}><option value="">Все бренды</option>{brands.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label>
  <fieldset><legend>Розничная цена, ₽</legend><div className="price-inputs"><label>От<input name="minPrice" inputMode="decimal" defaultValue={filters.minPrice} placeholder={facets.minPrice??'0'} maxLength={13}/></label><label>До<input name="maxPrice" inputMode="decimal" defaultValue={filters.maxPrice} placeholder={facets.maxPrice??'—'} maxLength={13}/></label></div></fieldset>
  <label>Наличие<select name="stock" defaultValue={filters.stock}><option value="">На любом складе</option>{facets.stocks.filter(s=>names[s.warehouse]).map(s=><option key={s.warehouse} value={s.warehouse}>{names[s.warehouse]} ({s.total.toLocaleString('ru-RU')})</option>)}</select></label>
  {filters.category&&<EtimFilters category={filters.category} facets={facets} selected={selected} choose={choose}/>}
  {unavailable&&<p className="facet-note">Часть значений в ссылке отсутствует у доступных товаров категории. Сбросьте фильтры или выберите существующие значения.</p>}<p role="status" className="facet-note">{warning}</p><p className="facet-note">Только доступные к продаже товары. Для выбранного склада учитывается положительный разрешённый остаток.</p><button type="submit">Применить фильтры</button><Link href={reset}>Сбросить фильтры</Link>
 </form></details></aside>;
}
