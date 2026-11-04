'use strict';
const fs=require('node:fs/promises');
const {publishVerified}=require('./publish.cjs');
(async()=>{
 const verification=JSON.parse(await fs.readFile('/source/preflight-tver-full.json','utf8'));
 const config={publicationEnabled:true,environment:'rehearsal',databaseName:process.env.PRODAT_REHEARSAL_DATABASE||'prodat_rehearsal',databaseUrlFile:'/run/config/database_url',stateDirectory:'/prodat-state',pricatStateDirectory:'/state',policy:{maxNewFraction:.35,maxUpdatedFraction:1}};
 // Rehearsal measures the first actual delta on a restored copy. Production
 // remains disabled and requires an explicit reviewed first-publication delta.
 const result=await publishVerified({config,verification,files:verification.parts.map(p=>({path:'/source/'+p.name})),event:x=>console.log(JSON.stringify(x))});
 console.log(JSON.stringify({status:result.status,createdProducts:result.createdProducts,updatedProducts:result.updatedProducts,newSaleOffers:result.newSaleOffers,beforeProducts:result.beforeProducts,afterProducts:result.afterProducts,beforeSaleOffers:result.beforeSaleOffers,afterSaleOffers:result.afterSaleOffers,existingSaleOffersChanged:result.existingSaleOffersChanged,protectedDataUnchanged:result.protectedDataUnchanged}));
})().catch(e=>{console.error(JSON.stringify({status:'REHEARSAL_FAILED',code:e.code??'REHEARSAL_FAILED',result:e.result??null}));process.exitCode=1;});
