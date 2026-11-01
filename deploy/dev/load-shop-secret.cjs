'use strict';
const fs=require('node:fs');
function loadShopSecret(env=process.env){
 if(!env.SHOP_DATABASE_URL_FILE)return;
 const file=env.SHOP_DATABASE_URL_FILE,s=fs.lstatSync(file);
 if(!s.isFile()||(process.platform!=='win32'&&(s.mode&0o077)))throw Error('Invalid shop runtime secret');
 let u;try{u=new URL(fs.readFileSync(file,'utf8').trim());}catch{throw Error('Invalid shop runtime secret');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='postgres'||u.port!=='5432'||decodeURIComponent(u.username)!=='storefront_preview_shop_app'||u.pathname!=='/elektrikamarket_preview_shop'||u.searchParams.get('schema')!=='shop'||!u.password)throw Error('Invalid shop runtime secret');
 env.SHOP_DATABASE_URL=u.toString();
}
module.exports={loadShopSecret};
if(process.env.SHOP_DATABASE_URL_FILE){try{loadShopSecret();}catch{console.error('Preview shop secret loading failed. No credential values logged.');process.exit(1);}}
