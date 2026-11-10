const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');
const {lookupParty,validatePair}=require('../lib/dadata-core.cjs');
const pair={apiKey:'fixture-api-key-never-real',secretKey:'fixture-secret-key-never-real'};
const data={name:{short_with_opf:'АО Тест',full_with_opf:'Полное название'},address:{unrestricted_value:'Москва, тестовый адрес'},kpp:'770701001',ogrn:'1027700132195',private_field:'must-not-escape'};
const payload=()=>({suggestions:[{data}]});
const reply=(body,url)=>({ok:true,url,json:async()=>body});
async function mockedFetch(fn,action){const old=global.fetch;global.fetch=fn;try{return await action();}finally{global.fetch=old;}}
function tsModule(file,imports,append=''){
 const output=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8')+append,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const module={exports:{}};vm.runInNewContext(output,{module,exports:module.exports,require:n=>{if(n in imports)return imports[n];throw Error('unexpected import '+n);},process:{env:{NODE_ENV:'production'}},console,Buffer});return module.exports;
}
test('secret exporter, browser component and hardcoded-password module are removed',()=>{
 for(const file of ['lib/key-store.ts','lib/key-actions.ts','components/admin-keys.tsx'])assert(!fs.existsSync(path.join(__dirname,'..',file)));
 const page=tsModule('app/admin/keys/page.tsx',{'next/navigation':{notFound(){throw Error('EXPECTED_404')}}});
 assert.throws(()=>page.default(),/EXPECTED_404/);
 assert(!fs.readFileSync(path.join(__dirname,'../components/admin-shell.tsx'),'utf8').includes('/admin/keys'));
});
test('lookup uses HTTPS headers, no redirects/cache and returns exactly four public fields',async()=>{
 let calls=0;
 const result=await mockedFetch(async(url,options)=>{calls++;assert.equal(url,'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party');
  assert.equal(options.headers.Authorization,'Token '+pair.apiKey);assert.equal(options.headers['X-Secret'],pair.secretKey);
  assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(JSON.parse(options.body).branch_type,'MAIN');return reply(payload(),url);
 },()=>lookupParty('7707083893',pair));
 assert.equal(calls,1);assert.deepEqual(result,{ok:true,party:{company:'АО Тест',address:'Москва, тестовый адрес',kpp:'770701001',ogrn:'1027700132195'}});
 for(const secret of Object.values(pair))assert(!JSON.stringify(result).includes(secret));
});
test('invalid INN, missing secret and header injection cause no request',async()=>{
 await mockedFetch(()=>{throw Error('unexpected request');},async()=>{
  for(const [inn,keys] of [['bad',pair],['7707083893',{apiKey:pair.apiKey}],['7707083893',{...pair,secretKey:'x\ny'}]])assert.equal((await lookupParty(inn,keys)).ok,false);
 });
});
test('HTTP/JSON/network failures never return credentials or provider errors',async()=>{
 for(const fetcher of [async()=>({ok:false}),async()=>({ok:true,json:async()=>{throw Error(pair.secretKey);}}),async()=>{throw Error(pair.apiKey);}]){
  const result=await mockedFetch(fetcher,()=>lookupParty('7707083893',pair));assert.equal(result.ok,false);
  for(const secret of Object.values(pair))assert(!JSON.stringify(result).includes(secret));
 }
});
test('upstream credential echo in a public field is rejected',async()=>{
 const result=await mockedFetch(async()=>reply({suggestions:[{data:{...data,name:{short_with_opf:pair.apiKey}}}]}),()=>lookupParty('7707083893',pair));assert.equal(result.ok,false);
});
test('both credentials validated through balance, result only contains field booleans',async()=>{
 const urls=[];const result=await mockedFetch(async(url)=>{urls.push(url);return reply(url.includes('/balance')?{balance:0}:payload(),url);},()=>validatePair(pair));
 assert.equal(urls.length,2);assert.equal(urls[0],'https://dadata.ru/api/v2/profile/balance');
 assert.deepEqual(result,{accepted:true,fields:{company:true,address:true,kpp:true,ogrn:true}});
});
test('autofill updates actual form code for name, address, KPP and OGRN without submitting registration',async()=>{
 let updated;let requests=0;
 const component=tsModule('components/account-gate.tsx',{'next/link':{},react:{},'react/jsx-runtime':{},'next/navigation':{},'../lib/account-actions':{},'../lib/dadata-actions':{findCompanyByInn:async()=>{requests++;return{ok:true,company:'АО Тест',address:'Москва',kpp:'770701001',ogrn:'1027700132195'};}}},'\nexport { requestInnLookup };');
 const props={values:{inn:'7707083893',contact:'Сохранённый контакт',email:'fixture@example.invalid'},onChange:v=>updated=v};
 assert.equal(await component.requestInnLookup('7707083893',props,()=>{}),true);
 assert.equal(requests,1);assert.equal(updated.company,'АО Тест');assert.equal(updated.address,'Москва');assert.equal(updated.kpp,'770701001');assert.equal(updated.ogrn,'1027700132195');assert.equal(updated.contact,props.values.contact);assert.equal(updated.email,props.values.email);
});
