// Uses only the Compose service created by dev.cjs; no URL from .env or VPS.
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),assert=require('assert/strict'),net=require('net');
const dir=__dirname,project=process.env.EM_LOCAL_PROJECT||'elektrikamarket-local-dev';if(!/^elektrikamarket-local-dev(?:-[a-f0-9]{6,16})?$/.test(project))throw Error('project');
const run=(args,input,env={})=>{const r=spawnSync('docker',args,{input,encoding:'utf8',env:{...process.env,...env},maxBuffer:5e6});if(r.status!==0)throw Error('Local check failed; no secret output');return r.stdout.trim();};
const endpoint=process.env.DOCKER_HOST||run(['context','inspect','--format','{{.Endpoints.docker.Host}}']); if(!/^(?:npipe:\/\/|unix:\/\/|tcp:\/\/(?:127\.0\.0\.1|localhost):)/.test(endpoint))throw Error('Local Docker only');
const id=run(['compose','--project-name',project,'-f',path.join(dir,'compose.yaml'),'ps','-q','postgres']);assert(id);assert.equal(run(['inspect','--format','{{ index .Config.Labels "com.docker.compose.project" }}',id]),project);
const query=sql=>run(['exec','-i',id,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','local_admin','-d','elektrikamarket_preview_shop'],sql);
query(`BEGIN;
SET LOCAL ROLE storefront_preview_shop_migrator;
CREATE TABLE shop.em_development_probe(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,value text);
CREATE TABLE shop._em_migration_probe(id int);
RESET ROLE;
GRANT SELECT,INSERT,UPDATE,DELETE ON shop.em_development_probe TO storefront_preview_shop_app;
GRANT USAGE ON SEQUENCE shop.em_development_probe_id_seq TO storefront_preview_shop_app;
SET LOCAL ROLE storefront_preview_shop_app;
INSERT INTO shop.em_development_probe(value) VALUES('synthetic');
UPDATE shop.em_development_probe SET value='synthetic-updated';
DO $check$ BEGIN
 IF (SELECT count(*) FROM shop.em_development_probe)<>1 THEN RAISE EXCEPTION 'CRUD check'; END IF;
 BEGIN EXECUTE 'CREATE TABLE shop.em_forbidden_probe(id int)'; RAISE EXCEPTION 'DDL was allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN EXECUTE 'ALTER TABLE shop.em_development_probe ADD COLUMN forbidden int'; RAISE EXCEPTION 'ALTER was allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN EXECUTE 'TRUNCATE shop.em_development_probe'; RAISE EXCEPTION 'TRUNCATE was allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN EXECUTE 'SELECT * FROM shop._em_migration_probe'; RAISE EXCEPTION 'metadata was readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $check$;
DELETE FROM shop.em_development_probe;
ROLLBACK;`);
assert.equal(query("SELECT count(*) FROM pg_tables WHERE schemaname='shop';"),'0');
for(const [file,role]of [['app_database_url','storefront_preview_shop_app'],['migration_database_url','storefront_preview_shop_migrator']]){const u=new URL(fs.readFileSync(path.join(dir,'.local',file),'utf8').trim());assert.equal(u.hostname,'127.0.0.1');const user=run(['exec','-i','--env','PGPASSWORD',id,'psql','-X','-t','-A','-U',role,'-h','127.0.0.1','-d','elektrikamarket_preview_shop'], 'SELECT current_user;', {PGPASSWORD:decodeURIComponent(u.password)});assert.equal(user,role);}
const server=net.connect({host:'127.0.0.1',port:Number(process.env.LOCAL_PG_PORT||55432)});server.setTimeout(3000);server.on('connect',()=>{console.log('LOCAL_TESTS_PASS CRUD+sequence DDL/ALTER/TRUNCATE/metadata-denied SCRAM-auth empty-shop localhost-port');server.end();});server.on('error',()=>{console.error('Local host port failed');process.exitCode=1;});server.on('timeout',()=>{server.destroy();process.exitCode=1;});
