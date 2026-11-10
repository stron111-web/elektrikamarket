'use strict';
const fs=require('node:fs');
function loadDadata(env=process.env){
 if(!env.DADATA_CREDENTIALS_FILE)return;
 // An image rollback must fail closed before either provider's credentials load.
 const marker=JSON.parse(fs.readFileSync('/app/preview-security.json','utf8'));
 if(marker.policy!=='preview-no-browser-secret-export-v1')throw Error('Unsafe image');
 const file=env.DADATA_CREDENTIALS_FILE;
 if(file!=='/run/secrets/preview_dadata_credentials')throw Error('Unexpected secret path');
 const s=fs.lstatSync(file);
 if(!s.isFile()||s.uid!==1000||(s.mode&0o777)!==0o400)throw Error('Unsafe secret');
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!value||Object.keys(value).sort().join(',')!=='DADATA_API_KEY,DADATA_SECRET_KEY')throw Error('Unexpected variables');
 for(const key of ['DADATA_API_KEY','DADATA_SECRET_KEY']){
  if(typeof value[key]!=='string'||!/^[\x21-\x7e]{1,512}$/.test(value[key]))throw Error('Invalid secret');
 }
 env.DADATA_API_KEY=value.DADATA_API_KEY;env.DADATA_SECRET_KEY=value.DADATA_SECRET_KEY;
}
module.exports={loadDadata};
if(process.env.DADATA_CREDENTIALS_FILE){try{loadDadata();}catch{console.error('Preview DaData secret loading failed. Values not logged.');process.exit(1);}}
