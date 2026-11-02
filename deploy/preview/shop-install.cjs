'use strict';
// Owner-run one-time initial schema only. Never invoked by Actions or startup.
const fs=require('node:fs'),path=require('node:path');
const tables=['buyers','individual_profiles','organizations','sessions','favorites','comparisons','orders','order_items','cart_items','payments','staff','staff_sessions','pages'];
function migrationSql(root=path.resolve(__dirname,'../dev/migrations')) {
 const names=['001_shop_cabinet.sql','002_shop_cart.sql','003_shop_price_status.sql','004_shop_admin.sql'];
 const parts=names.map(n=>fs.readFileSync(path.join(root,n),'utf8'));
 // Preserve Andronik's schema DDL; never copy local staff password hashes.
 if((parts[3].match(/INSERT INTO shop\.staff/g)||[]).length!==1)throw Error('Staff seed changed: review required');
 parts[3]=parts[3].replace(/\nINSERT INTO shop\.staff[\s\S]*;\s*$/,'\n');
 if(/INSERT INTO shop\.staff/.test(parts[3])||parts.some(s=>/scrypt\$/.test(s)))throw Error('Unsafe staff seed');
 return parts.join('\n');
}
function grantsSql(app='storefront_preview_shop_app') {
 if(!/^[a-z_][a-z0-9_]*$/.test(app))throw Error('Invalid application role');
 return tables.filter(t=>!['staff','staff_sessions'].includes(t)).map(t=>`GRANT SELECT,INSERT,UPDATE,DELETE ON shop.${t} TO ${app};`).join('\n')+
 `\nGRANT SELECT ON shop.staff,shop.staff_sessions TO ${app};\n`+
 tables.filter(t=>!['staff','staff_sessions'].includes(t)).map(t=>`DO $$ DECLARE s text; BEGIN SELECT pg_get_serial_sequence('shop.${t}','id') INTO s FROM information_schema.columns WHERE table_schema='shop' AND table_name='${t}' AND column_name='id'; IF s IS NOT NULL THEN EXECUTE 'GRANT USAGE ON SEQUENCE '||s||' TO ${app}'; END IF; END $$;`).join('\n');
}
const staffSql=`INSERT INTO shop.staff(email,name,password_hash) VALUES ('owner@preview.invalid','Владелец','external-basic-auth-only'),('developer@preview.invalid','Андроник','external-basic-auth-only');`;
module.exports={migrationSql,grantsSql,staffSql,tables};
if(require.main===module)(async()=>{
 if(process.argv[2]!=='--apply-preview-shop')throw Error('Explicit initial install command required');
 const postgres=require('postgres');const file='/run/shop-migration/database_url',raw=fs.readFileSync(file,'utf8').trim(),u=new URL(raw);
 if(u.hostname!=='postgres'||u.port!=='5432'||u.pathname!=='/elektrikamarket_preview_shop'||u.username!=='storefront_preview_shop_migrator'||u.searchParams.get('schema')!=='shop')throw Error('Wrong migration target');
 u.searchParams.delete('schema');const sql=postgres(u.toString(),{max:1,onnotice:()=>{},connection:{application_name:'preview-shop-initial-schema',search_path:'shop',statement_timeout:60000}});
 try{await sql.begin(async tx=>{
  const [before]=await tx`SELECT current_user AS role,current_database() AS database,(SELECT count(*)::int FROM pg_tables WHERE schemaname='shop') AS tables`;
  if(before.role!=='storefront_preview_shop_migrator'||before.database!=='elektrikamarket_preview_shop'||before.tables!==0)throw Error('Initial shop must be empty; refusing existing data');
  await tx`SELECT pg_advisory_xact_lock(1707312410)`;
  const ddl=fs.readFileSync(path.join(__dirname,'shop-schema-reviewed.sql'),'utf8');
  if(/INSERT INTO shop\.staff|scrypt\$/.test(ddl))throw Error('Unreviewed staff seed');
  await tx.unsafe(ddl);await tx.unsafe(staffSql);await tx.unsafe(grantsSql());
  const [after]=await tx`SELECT count(*)::int AS tables FROM pg_tables WHERE schemaname='shop'`;
  if(after.tables!==tables.length)throw Error('Schema validation failed');
 });console.log('SHOP_INITIAL_SCHEMA_COMMITTED: 13 tables, separate migrator, app CRUD without DDL or staff writes; no local password hashes copied');}
 finally{await sql.end();}
})().catch(()=>{console.error('Shop initial schema failed. Transaction rolled back; no credentials logged.');process.exitCode=1});
