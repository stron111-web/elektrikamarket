'use strict';
function parseCatalogFilters(params={}) {
 const one=k=>typeof params[k]==='string'?params[k]:'';
 const integer=(s,fallback)=>/^\d{1,7}$/.test(s)&&Number(s)>0?Number(s):fallback;
 const price=k=>{const s=one(k).trim().replace(',','.');return /^\d{1,10}(\.\d{1,2})?$/.test(s)?s.replace(/^0+(?=\d)/,''):'';};
 return {q:one('q').trim().slice(0,120),category:one('category').slice(0,200),brand:integer(one('brand'),0),page:integer(one('page'),1),minPrice:price('minPrice'),maxPrice:price('maxPrice'),stock:['stock1','stock2','stock3'].includes(one('stock'))?one('stock'):''};
}
function catalogHref(filters,changes={}) {
 const f={...filters,...changes},p=new URLSearchParams();
 for(const k of ['q','category','brand','minPrice','maxPrice','stock','page'])if(f[k]&&!(k==='page'&&Number(f[k])===1))p.set(k,String(f[k]));
 p.set('view','products');
 return '/catalog?'+p.toString();
}
module.exports={parseCatalogFilters,catalogHref};
