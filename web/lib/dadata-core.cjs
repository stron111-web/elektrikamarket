'use strict';
// Imported only by the server-only wrapper and a non-HTTP owner probe.
const PARTY_URL='https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';
const BALANCE_URL='https://dadata.ru/api/v2/profile/balance';
const unavailable=()=>({ok:false,message:'Справочник не ответил. Реквизиты можно ввести вручную.'});
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
function validPair(pair){return pair&&['apiKey','secretKey'].every(k=>typeof pair[k]==='string'&&/^[\x21-\x7e]{1,512}$/.test(pair[k]));}
async function request(url,pair,body){
 const response=await fetch(url,{method:body?'POST':'GET',redirect:'error',cache:'no-store',
  headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Token ${pair.apiKey}`,'X-Secret':pair.secretKey},
  ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 if(!response.ok||response.url&&response.url!==url)throw Error('provider_unavailable');
 return response.json();
}
async function lookupParty(inn,pair){
 if(typeof inn!=='string'||!/^(?:\d{10}|\d{12})$/.test(inn))return{ok:false,message:'ИНН — 10 или 12 цифр.'};
 if(!validPair(pair))return{ok:false,message:'Справочник по ИНН на этом запуске не подключён.'};
 try{
  const body=await request(PARTY_URL,pair,{query:inn,branch_type:'MAIN',count:1});
  const data=Array.isArray(body?.suggestions)?body.suggestions[0]?.data:null;
  if(!data)return{ok:false,message:'По этому ИНН справочник организацию не нашёл. Реквизиты введите вручную.'};
  const party={company:text(data.name?.short_with_opf||data.name?.full_with_opf,1000),
   address:text(data.address?.unrestricted_value||data.address?.value,2000),kpp:text(data.kpp,9),ogrn:text(data.ogrn,15)};
  if(Object.values(party).some(v=>v&&(v.includes(pair.apiKey)||v.includes(pair.secretKey))))return unavailable();
  if(!party.company&&!party.address)return{ok:false,message:'Справочник не вернул название и адрес. Введите реквизиты вручную.'};
  return{ok:true,party};
 }catch{return unavailable();}
}
async function validatePair(pair,inn='7707083893'){
 if(!validPair(pair))return{accepted:false,reason:'invalid_pair'};
 try{
  // findById authenticates the API key; profile/balance checks BOTH keys.
  const balance=await request(BALANCE_URL,pair);
  if(typeof balance?.balance!=='number'||!Number.isFinite(balance.balance))return{accepted:false,reason:'credentials_not_confirmed'};
  const result=await lookupParty(inn,pair);
  if(!result.ok)return{accepted:false,reason:'lookup_failed'};
  const fields=Object.fromEntries(Object.entries(result.party).map(([k,v])=>[k,Boolean(v)]));
  return{accepted:fields.company&&fields.address&&fields.kpp&&fields.ogrn,fields};
 }catch{return{accepted:false,reason:'credentials_not_confirmed'};}
}
module.exports={lookupParty,validatePair};
