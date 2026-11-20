'use strict';
const {parseEtim,etimTokens}=require('./etim.cjs');
function parseCatalogFilters(params={}) {
 const one=k=>typeof params[k]==='string'?params[k]:'';
 const integer=(s,fallback)=>/^\d{1,7}$/.test(s)&&Number(s)>0?Number(s):fallback;
 const price=k=>{const s=one(k).trim().replace(',','.');return /^\d{1,10}(\.\d{1,2})?$/.test(s)?s.replace(/^0+(?=\d)/,''):'';};
 const category=one('category').slice(0,200);
 return {q:one('q').trim().slice(0,120),category,etim:parseEtim(params,category),brand:integer(one('brand'),0),page:integer(one('page'),1),minPrice:price('minPrice'),maxPrice:price('maxPrice'),stock:['stock1','stock2','stock3'].includes(one('stock'))?one('stock'):'',sort:['price_asc','price_desc','quantity_asc','quantity_desc','brand_asc','brand_desc'].includes(one('sort'))?one('sort'):''};
}
function catalogHref(filters,changes={}) {
 const f={...filters,...changes},p=new URLSearchParams();
 for(const k of ['q','category','brand','minPrice','maxPrice','stock','sort','page'])if(f[k]&&!(k==='page'&&Number(f[k])===1))p.set(k,String(f[k]));
 if(f.category===filters.category&&f.category&&f.etim?.length){p.set('etimCategory',f.category);for(const value of etimTokens(f.etim))p.append('etim',value);}
 p.set('view','products');
 return '/catalog?'+p.toString();
}
module.exports={parseCatalogFilters,catalogHref};
