'use strict';
// Explicit bootstrap/rebuild only: never imports supplier files or runs migrations.
const postgres=require('postgres');
const {connectionUrl}=require('../import/prodat-import.cjs');
const {buildAssortmentSnapshot}=require('./assortment.cjs');
async function rebuildAssortment(databaseUrl) {
  const db=postgres(connectionUrl(databaseUrl),{max:1,connect_timeout:10,onnotice:()=>{},
    connection:{application_name:'assortment-bootstrap',statement_timeout:'60s',lock_timeout:'2s'}});
  try{return await db.begin(tx=>buildAssortmentSnapshot(tx));}
  finally{await db.end({timeout:5});}
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--database-url-env' || !process.env[args[1]])
    throw new Error('Explicit --database-url-env VARIABLE required; no implicit .env loading');
  console.log(JSON.stringify(await rebuildAssortment(process.env[args[1]])));
}
if(require.main===module)main().catch(()=>{console.error('Assortment rebuild failed; previous snapshot preserved. No automatic repair.');process.exitCode=1;});
module.exports={rebuildAssortment};
