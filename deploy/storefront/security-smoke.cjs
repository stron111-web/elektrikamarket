'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const postgres=require('node:module').createRequire('/app/web/server.js')('postgres');
const db=postgres(fs.readFileSync('/run/secrets/storefront_database_url','utf8').trim(),{max:1});
const base='https://caddy:8443';
const auth='Basic '+Buffer.from('tester:'+fs.readFileSync('/checks/auth_password','utf8')).toString('base64');
(async()=>{try{
 for(const route of ['/catalog','/product/not-a-real-product','/api/health','/_next/static/nonexistent.js']){
  const r=await fetch(base+route);assert.equal(r.status,401,route);assert.match(r.headers.get('x-robots-tag'),/noindex/);
 }
 assert.equal((await fetch(base+'/catalog',{headers:{Authorization:'Basic '+Buffer.from('tester:wrong').toString('base64')}})).status,401);
 const catalog=await fetch(base+'/catalog?availability=all',{headers:{Authorization:auth}});
 assert.equal(catalog.status,200);const html=await catalog.text();
 const asset=html.match(/(?:src|href)="(\/_next\/static\/[^"]+)"/)[1];
 assert.equal((await fetch(base+asset,{headers:{Authorization:auth}})).status,200);
 const [rights]=await db.unsafe("SELECT count(*) FILTER(WHERE has_table_privilege(current_user,c.oid,'SELECT'))::int AS readable,count(*) FILTER(WHERE has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))::int AS writable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'");
 assert.equal(rights.readable,14);assert.equal(rights.writable,0);
 await db.unsafe('SET default_transaction_read_only=off');
 await assert.rejects(db.unsafe('UPDATE products SET name=name WHERE false'),e=>e.code==='42501');
 await assert.rejects(db.unsafe('SELECT * FROM _prisma_migrations'),e=>e.code==='42501');
 await assert.rejects(db.unsafe("SELECT nextval('products_id_seq')"),e=>e.code==='42501');
 console.log('PASS trusted local TLS, full-site Basic Auth, noindex, static files, 14 SELECT tables plus public snapshot columns, denied writes/history/sequences');
}finally{await db.end();}})().catch(error=>{console.error('Security assertion failed: '+error.message);process.exitCode=1;});
