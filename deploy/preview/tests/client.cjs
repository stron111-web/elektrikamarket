'use strict';
const fs=require('fs'),assert=require('assert/strict');
const users=Object.fromEntries(['owner','developer'].map(n=>[n,fs.readFileSync('/checks/'+n+'_password','utf8')]));
const auth=user=>'Basic '+Buffer.from(user+':'+users[user]).toString('base64');
const get=(url,user)=>fetch(url,{headers:user?{Authorization:auth(user)}:{},signal:AbortSignal.timeout(60000)});
(async()=>{for(const host of ['test.elektro-24.ru','preview.elektro-24.ru']){
 const base='https://'+host+':8443';
 for(const route of ['/','/catalog','/api/health','/product/not-a-real-product','/_next/static/not-a-real-file.js']){const r=await get(base+route);assert.equal(r.status,401,host+route);assert.match(r.headers.get('x-robots-tag'),/noindex/);}
 const wrong=await fetch(base+'/catalog',{headers:{Authorization:'Basic '+Buffer.from('owner:incorrect').toString('base64')}});assert.equal(wrong.status,401);
 for(const user of ['owner','developer']){const r=await get(base+'/catalog?q=82066',user);assert.equal(r.status,200);assert.match(r.headers.get('x-robots-tag'),/noindex/);const html=await r.text();assert(!html.includes('DATABASE_URL'));assert(!html.includes('postgresql://'));const product=html.match(/href="(\/product\/[^"?#]+)"/);assert(product,'Search must return products');const card=await get(base+product[1],user);assert.equal(card.status,200);const cardHtml=await card.text();assert(cardHtml.includes('₽'),'Product sale price must be present');const asset=html.match(/(?:src|href)="(\/_next\/static\/[^\"]+)"/);assert(asset);assert.equal((await get(base+asset[1],user)).status,200);assert.equal((await get(base+'/api/health',user)).status,200);}
 console.log('PASS trusted local HTTPS, owner/developer, full-site 401/noindex, search, product, price, static: '+host);
}})().catch(e=>{console.error('Fixture assertion failed: '+e.message);process.exitCode=1;});
