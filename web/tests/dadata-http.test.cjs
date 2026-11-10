// Run after `npm run build`. Uses synthetic canaries, no database or provider requests.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),path=require('node:path');
test('production HTTP blocks HTML, RSC and old server actions before any database access', {timeout:60000},async()=>{
 const web=path.resolve(__dirname,'..'),port=18091;
 const env={...process.env,NODE_ENV:'production',DADATA_API_KEY:'synthetic-api-canary',DADATA_SECRET_KEY:'synthetic-secret-canary',CDEK_SECURE_PASSWORD:'synthetic-cdek-canary'};
 delete env.DATABASE_URL;delete env.SHOP_DATABASE_URL;
 const child=spawn(process.execPath,[path.join(web,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:web,env,stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
 const exited=new Promise(resolve=>child.once('exit',resolve));
 try{
  let ready=false;
  for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error('local server stopped');
   try{const r=await fetch(`http://127.0.0.1:${port}/admin/keys`,{signal:AbortSignal.timeout(500)});if(r.status===404){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,150));
  }
  assert(ready,'local production server readiness');
  for(const route of ['/admin/keys','/admin/keys/','/admin/keys/anything']){
   for(const options of [{method:'GET'},{method:'HEAD'},{method:'GET',headers:{RSC:'1'}},{method:'POST',headers:{'Next-Action':'legacy-export-action',RSC:'1'},body:'[]'}]){
    const r=await fetch(`http://127.0.0.1:${port}${route}`,{...options,redirect:'follow'});
    assert.equal(r.status,404);assert.equal(r.headers.get('cache-control'),'no-store');
    const body=await r.text();for(const key of ['DADATA_API_KEY','DADATA_SECRET_KEY','CDEK_SECURE_PASSWORD'])assert(!body.includes(env[key]));
   }
  }
  assert(!logs.includes('DATABASE_URL is required'));
  for(const key of ['DADATA_API_KEY','DADATA_SECRET_KEY','CDEK_SECURE_PASSWORD'])assert(!logs.includes(env[key]));
 }finally{child.kill();await exited;}
});
