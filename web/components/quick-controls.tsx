'use client';
import type {Filters} from '../lib/data';
export function QuickControls({filters,brands}:{filters:Filters;brands:{id:number;name:string}[]}) {
 return <div className="quick-controls"><form action="/catalog" onChange={e=>e.currentTarget.requestSubmit()} aria-label="Быстрые фильтры и сортировка">
  {(['q','category','minPrice','maxPrice','stock'] as const).map(k=><input type="hidden" key={k} name={k} value={filters[k]}/>)}<input type="hidden" name="view" value="products"/>
  <label>Сортировка<select name="sort" defaultValue={filters.sort}><option value="">По умолчанию</option><option value="price_asc">Цена: сначала дешевле ↑</option><option value="price_desc">Цена: сначала дороже ↓</option><option value="quantity_desc">В наличии: сначала больше ↓</option><option value="quantity_asc">В наличии: сначала меньше ↑</option><option value="brand_asc">Бренд: А–Я</option><option value="brand_desc">Бренд: Я–А</option></select></label>
  <label>Быстрый выбор бренда<select name="brand" defaultValue={filters.brand||''}><option value="">Все бренды</option>{brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button type="submit">Показать</button>
 </form>{filters.sort.startsWith('quantity')&&<p>Остаток {filters.stock?'выбранного склада':'по доступным складам'}. Товары сгруппированы по единице продажи; количество сравнивается внутри одной единицы.</p>}</div>;
}
