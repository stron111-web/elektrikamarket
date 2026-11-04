'use strict';
const {privateJson,GateError}=require('../pricat-update/update.cjs');
const {checkSource,sourceStatus}=require('./source.cjs');const {publishVerified}=require('./publish.cjs');
(async()=>{process.umask(0o077);const a=process.argv.slice(2);if(a.length!==4||a[0]!=='--config'||a[2]!=='--mode'||!['check','status','publish'].includes(a[3]))throw new GateError('USAGE_CONFIG_MODE');
 const config=await privateJson(a[1]);
 if(a[3]==='status'){console.log(JSON.stringify(await sourceStatus(config),null,2));return;}
 if(a[3]==='publish'&&config.publicationEnabled!==true)throw new GateError('PUBLICATION_DISABLED');
 const checked=await checkSource({config,event:x=>console.log(JSON.stringify(x))});
 if(a[3]==='check')return;
 if(!checked.state.currentCandidate?.verified)throw new GateError('VERIFIED_CANDIDATE_REQUIRED');
 const result=await publishVerified({config,files:checked.state.currentCandidate.files,verification:checked.state.currentCandidate.verification,event:x=>console.log(JSON.stringify(x))});console.log(JSON.stringify({status:result.status,createdProducts:result.createdProducts,updatedProducts:result.updatedProducts,newSaleOffers:result.newSaleOffers}));
})().catch(e=>{console.error(JSON.stringify({status:'STOPPED',code:e instanceof GateError?e.code:'PRODAT_UPDATE_FAILED'}));process.exitCode=1;});
