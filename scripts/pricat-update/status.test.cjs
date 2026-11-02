'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {status}=require('./status.cjs');
test('status is filesystem-only, preserves last publication and never reads connection secrets',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pricat-status-'));
 try{
  const root=path.join(dir,'ftp');await fs.mkdir(root,{mode:0o700});
  const config={stateDirectory:dir,databaseName:'fixture_catalog',databaseUrlFile:'/must/not/be/read'};
  assert.equal((await status(config)).sources.PRICAT1,null);
  await fs.writeFile(path.join(root,'state.json'),JSON.stringify({version:1,snapshotId:'2',lastPublication:{status:'SUCCEEDED',count:123,zeroedStocks:4},versions:{PRICAT1:[{documentDate:'20261102010000',acceptedAt:'2026-11-02T02:00:00Z',remote:{name:'fixture.zip'},sha256:'0'.repeat(64)}],PRICAT2:[]}}),{mode:0o600});
  await fs.writeFile(path.join(root,'events.ndjson'),JSON.stringify({at:'2026-11-02',status:'NO_REMOTE_CHANGE'})+'\n');
  const s=await status(config);assert.equal(s.lastPublication.count,123);assert.equal(s.lastCheck.status,'NO_REMOTE_CHANGE');assert.equal(s.sources.PRICAT1.documentDate,'20261102010000');assert.equal(s.sources.PRICAT1.acceptedAt,'2026-11-02T02:00:00Z');
  await fs.writeFile(path.join(root,'needs-review.json'),'{}');assert.equal((await status(config)).needsReview,true);
  assert.ok(!JSON.stringify(s).includes('must/not/be/read'));
 }finally{await fs.rm(dir,{recursive:true});}
});
