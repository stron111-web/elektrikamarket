'use strict';
const assert = require('node:assert/strict');
const postgres = require('postgres');
require('dotenv').config({path:require('node:path').resolve(__dirname,'../../.env'),quiet:true});
const {connectionUrl}=require('../../scripts/import/prodat-import.cjs');
const {readAvailableStocks}=require('../../scripts/import/pricat-store.cjs');
const {availabilitySql}=require('../lib/availability.cjs');
const db=postgres(connectionUrl(process.env.DATABASE_URL),{max:1,connection:{default_transaction_read_only:true}});
(async()=>{try{await db.begin('isolation level repeatable read read only',async tx=>{
  const rows=await tx`SELECT DISTINCT p."supplierCode" FROM products p WHERE p.id<=48
    OR EXISTS(SELECT 1 FROM import_issues i JOIN import_files f ON f.id=i."fileId"
      WHERE i."supplierCode"=p."supplierCode" AND f.source IN ('PRICAT1','PRICAT2')
      AND i.code IN ('CONFLICTING_DUPLICATE','INVALID_RECORD','STOCK_UOM_CONFLICT','COMMERCIAL_UNIT_CONFLICT')
      AND f.status='SUCCEEDED')`;
  const codes=rows.map(p=>p.supplierCode);
  const expected=await readAvailableStocks(tx,codes);
  const {query}=await availabilitySql(tx,tx`SELECT "supplierCode" FROM products WHERE "supplierCode" IN ${tx(codes)}`);
  const actual=await tx`SELECT * FROM (${query}) available`;
  const ordered=rows=>Array.from(rows).sort((a,b)=>(a.supplierCode+':'+a.warehouse).localeCompare(b.supplierCode+':'+b.warehouse));
  assert.deepEqual(ordered(actual),ordered(expected));
  assert(!actual.some(p=>p.supplierCode==='97320'),'PCE stock cannot sell against NMP price');
  for(const code of ['92784','93749','93531','97384','9597','99599','83738','83992'])assert(!actual.some(p=>p.supplierCode===code));
  const empty=await availabilitySql(tx,tx`SELECT "supplierCode" FROM products WHERE false`);
  assert.equal((await tx`SELECT * FROM (${empty.query}) available`).length,0);
  console.log('PASS exact importer SQL equivalence for '+codes.length+' products including quarantine and incompatible UOM');
});}finally{await db.end({timeout:5})}})().catch(e=>{console.error(e);process.exitCode=1});
