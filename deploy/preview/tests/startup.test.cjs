'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../storefront/start.cjs'),'utf8');
function startup(user,role,db='elektrikamarket_test_20261029t010219z_2761a73c'){
 let started=false;const process={env:role?{STOREFRONT_DATABASE_ROLE:role}:{}};
 vm.runInNewContext(source,{URL,process,console:{error(){}},require(name){if(name==='node:fs')return{readFileSync:()=>`postgresql://${user}:fixture@localhost/${db}`};assert.equal(name,'/app/web/server.js');started=true;}});
 return {started,exit:process.exitCode};
}
test('existing test startup default stays compatible',()=>assert.deepEqual(startup('storefront_test_ro'),{started:true,exit:undefined}));
test('preview accepts only its dedicated credential',()=>assert.equal(startup('storefront_preview_ro','storefront_preview_ro').started,true));
test('preview refuses the test-site credential',()=>assert.deepEqual(startup('storefront_test_ro','storefront_preview_ro'),{started:false,exit:1}));
test('test default refuses preview credential',()=>assert.equal(startup('storefront_preview_ro').started,false));
test('administrator role cannot be configured',()=>assert.equal(startup('postgres','postgres').started,false));
test('other databases are refused',()=>assert.equal(startup('storefront_preview_ro','storefront_preview_ro','elektrikamarket').started,false));
