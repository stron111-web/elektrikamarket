'use client';
import {useState} from 'react';
import type {CatalogFacets,EtimFacet} from '../lib/data';
const identity=(f:EtimFacet)=>JSON.stringify([f.code,f.name,f.uom]);
async function load(params:Record<string,string>){
 const response=await fetch('/api/catalog/etim?'+new URLSearchParams(params),{cache:'no-store'});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось загрузить характеристики.');return data;
}
function Feature({facet,category,snapshot,selected,choose,initialOpen}:{facet:EtimFacet;category:string;snapshot:string;selected:Set<string>;choose:(value:string,checked:boolean)=>void;initialOpen:boolean}){
 const [options,setOptions]=useState(facet.options),[next,setNext]=useState(facet.nextOffset),[loaded,setLoaded]=useState(facet.loaded!==false);
 const [draft,setDraft]=useState(''),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[total,setTotal]=useState(facet.variants);
 async function values(offset:number,search:string,reset=false){
  if(busy)return;setBusy(true);setError('');
  try{const data=await load({category,snapshot,feature:identity(facet),offset:String(offset),search});
   setOptions(old=>reset?data.facet.options:[...new Map([...old,...data.facet.options].map(o=>[o.token,o])).values()]);
   setNext(data.facet.nextOffset);setLoaded(true);setQuery(search);setTotal(data.total);
  }catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить значения.');}finally{setBusy(false);}
 }
 const chosen=[...selected].filter(t=>{const a=JSON.parse(t);return JSON.stringify(a.slice(0,3))===identity(facet);}).length;
 return <details className="etim-facet" open={initialOpen} onToggle={e=>{if(e.currentTarget.open&&!loaded&&!busy)void values(0,'',true);}}>
  <summary>{facet.name}{facet.uom?` · ${facet.uom}`:''}{chosen>0&&<small> · выбрано {chosen}</small>}</summary>
  <fieldset><legend className="sr-only">{facet.name}{facet.uom?`, ${facet.uom}`:''}</legend>
   <p className="facet-note">Известное значение: у {facet.coverage.toLocaleString('ru-RU')} товаров · вариантов: {facet.variants}</p>
   {facet.variants>60&&<div className="etim-search"><label>Найти значение<input aria-label={'Найти значение: '+facet.name} value={draft} maxLength={80} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void values(0,draft,true);}}}/></label><button type="button" disabled={busy} onClick={()=>void values(0,draft,true)}>Найти значения</button></div>}
   <div className="etim-options">{options.map(o=><label className="etim-option" key={o.token}><input type="checkbox" value={o.token} checked={selected.has(o.token)} onChange={e=>choose(o.token,e.currentTarget.checked)}/><span>{o.value}</span><small>{o.total.toLocaleString('ru-RU')}</small></label>)}</div>
   {loaded&&<p className="facet-note">Показано {options.length} из {total}{query?' по запросу':''}.</p>}
   {next!==null&&loaded&&<button type="button" disabled={busy} className="etim-more" onClick={()=>void values(next,query)}>Показать остальные значения</button>}
   {!loaded&&!busy&&error&&<button type="button" onClick={()=>void values(0,'',true)}>Повторить загрузку значений</button>}
   <p className="facet-note" role="status">{busy?'Загрузка значений…':error}</p>
  </fieldset>
 </details>;
}
export function EtimFilters({category,facets,selected,choose}:{category:string;facets:CatalogFacets;selected:Set<string>;choose:(value:string,checked:boolean)=>void}){
 const [properties,setProperties]=useState(facets.etim),[all,setAll]=useState(facets.etimNextOffset===null);
 const [draft,setDraft]=useState(''),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function propertiesPage(term:string,append:boolean){
  if(busy)return;setBusy(true);setError('');
  try{
   let offset=append?(facets.etimNextOffset??0):0;const found:EtimFacet[]=[];
   do{const data=await load({category,snapshot:facets.etimSnapshot,offset:String(offset),search:term});found.push(...data.facets);if(data.nextOffset===null)break;if(data.nextOffset<=offset)throw new Error('Ошибка следующей страницы характеристик.');offset=data.nextOffset;}while(true);
   setProperties(old=>{const map=new Map((append?old:[]).map(f=>[identity(f),f]));for(const f of found)if(!map.has(identity(f)))map.set(identity(f),f);return [...map.values()];});setSearch(term);setAll(!term);
  }catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить характеристики.');}finally{setBusy(false);}
 }
 return <section className="etim-filters" aria-label="Характеристики ETIM"><h2>Характеристики</h2>
  <input type="hidden" name="etimCategory" value={category}/>{[...selected].map(value=><input key={value} type="hidden" name="etim" value={value}/>)}
  <p className="facet-note">Всего характеристик: {facets.etimTotal}. Показано: {properties.length}.</p>
  <p className="facet-note">Разные свойства — «И», значения одного — «ИЛИ». Счётчики относятся ко всей категории.</p>
  {facets.etimTotal>0?<><div className="etim-search"><label>Найти характеристику<input value={draft} maxLength={80} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void propertiesPage(draft,false);}}}/></label><button type="button" disabled={busy} onClick={()=>void propertiesPage(draft,false)}>Найти характеристику</button></div>
   {properties.map((f,i)=><Feature key={identity(f)} facet={f} category={category} snapshot={facets.etimSnapshot} selected={selected} choose={choose} initialOpen={i<3||f.options.some(o=>selected.has(o.token))}/>)}
   {!all&&!search&&<button type="button" className="etim-more" disabled={busy} onClick={()=>void propertiesPage('',true)}>Показать все характеристики</button>}
   {search&&<button type="button" disabled={busy} onClick={()=>{setDraft('');void propertiesPage('',false);}}>Показать все характеристики</button>}
   {!properties.length&&<p className="facet-note">Характеристики по запросу не найдены.</p>}
  </>:<p className="facet-note">У доступных товаров категории нет заполненных характеристик ETIM.</p>}
  <p className="facet-note" role="status">{busy?'Загрузка характеристик…':error}</p>
 </section>;
}
