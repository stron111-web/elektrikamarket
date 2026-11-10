const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/load-dadata-secret.cjs','utf8');
function load(options={}){const env={DADATA_CREDENTIALS_FILE:'/run/secrets/preview_dadata_credentials',CDEK_ACCOUNT:'unchanged',CDEK_SECURE_PASSWORD:'unchanged'};
 const context={module:{exports:{}},process:{env,exit(){throw Error('closed')}},console:{error(){}},require(){return{lstatSync:()=>({isFile:()=>true,uid:1000,mode:options.mode??0o100400}),readFileSync:p=>JSON.stringify(p==='/app/preview-security.json'?{policy:options.policy??'preview-no-browser-secret-export-v1'}:options.pair??{DADATA_API_KEY:'fixture-api',DADATA_SECRET_KEY:'fixture-secret'})}}};
 vm.runInNewContext(source,context);return env;
}
test('only DaData variables added and CDEK preserved',()=>{const env=load();assert.equal(env.DADATA_API_KEY,'fixture-api');assert.equal(env.DADATA_SECRET_KEY,'fixture-secret');assert.equal(env.CDEK_ACCOUNT,'unchanged');assert.equal(env.CDEK_SECURE_PASSWORD,'unchanged');});
test('old images fail closed before secrets load',()=>assert.throws(()=>load({policy:'old-image'})));
test('wrong permissions and extra provider variables rejected',()=>{for(const mode of [0o100600,0o100444])assert.throws(()=>load({mode}));assert.throws(()=>load({pair:{DADATA_API_KEY:'x',DADATA_SECRET_KEY:'y',CDEK_ACCOUNT:'no'}}));});
