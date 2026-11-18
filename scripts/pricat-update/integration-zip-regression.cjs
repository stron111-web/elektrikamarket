'use strict';
const fs=require('node:fs'),fsp=fs.promises,{createHash}=require('node:crypto'),{readPricat}=require('../import/pricat.cjs'),{normalizePricat}=require('../import/pricat-normalize.cjs'),{fingerprint}=require('../import/prodat-import.cjs');
async function main(){
 const file='/inputs/nov6-PRICAT1.zip',expected='7f4895afb4a60d182ef4454621636cbcb1760625e46e31771eba0548063fc3cb';
 if((await fingerprint(file)).sha256!==expected)throw Error('SOURCE_CHANGED');
 const out=await fsp.open('/results/native-zip-regression.ndjson','wx',0o600);let n=0,last=Date.now(),header={},documents=[];const hash=createHash('sha256');
 const timer=setInterval(()=>{if(Date.now()-last>120000){console.error('REGRESSION_STALLED');process.exit(124);}},10000);
 try{for await(const {record,index,xmlName} of readPricat(file,{onHeader:h=>header=h,onMetadata:m=>documents.push(m)})){
  const line=JSON.stringify({index,xmlName,record,normalized:normalizePricat(record,'PRICAT1','30.000',header.Currency)})+'\n';await out.write(line);hash.update(line);n++;
  if(n%10000===0){last=Date.now();console.log(JSON.stringify({kind:'slow-consumer-progress',rows:n}));}
 }if(n!==142965||documents.length!==1)throw Error('SOURCE_RECORD_MISMATCH');if((await fingerprint(file)).sha256!==expected)throw Error('SOURCE_CHANGED');const result={status:'PASS',rows:n,sourceSha256:expected,spoolSha256:hash.digest('hex'),document:documents[0],asynchronousSpoolWriter:true};await fsp.writeFile('/results/native-zip-regression.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
 finally{clearInterval(timer);await out.close();}
}
main().catch(e=>{console.error(JSON.stringify({status:'FAILED',error:e.message}));process.exitCode=1;});
