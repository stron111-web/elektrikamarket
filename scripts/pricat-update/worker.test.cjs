'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {supervise}=require('./worker.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('worker deadline aborts an awaited source; heartbeat alone is not progress',async()=>{
  const events=[];
  await assert.rejects(supervise(({signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason))),
    {maxRunMs:80,stallMs:1000,terminateGraceMs:100},{tickMs:5,emit:v=>events.push(v)}),{code:'JOB_DEADLINE'});
  assert.equal(events.filter(e=>e.status==='ABORTING').length,1);
});
test('repeating identical progress does not extend stall deadline',async()=>{
  await assert.rejects(supervise(async({signal,onProgress})=>{
    for(let i=0;i<30;i++){onProgress({phase:'parse',source:'PRICAT1',records:121540});await delay(5);signal.throwIfAborted();}
  },{maxRunMs:1000,stallMs:40,terminateGraceMs:100},{tickMs:5,emit:()=>{}}),{code:'NO_PROGRESS'});
});
test('increasing counters allow a healthy long-running operation and release signal handlers',async()=>{
  const before=process.listenerCount('SIGTERM');
  const r=await supervise(async({onProgress})=>{for(let records=0;records<12;records++){onProgress({phase:'parse',records});await delay(10);}return 7;},
    {maxRunMs:1000,stallMs:50,terminateGraceMs:100},{tickMs:5,emit:()=>{}});
  assert.equal(r,7);assert.equal(process.listenerCount('SIGTERM'),before);
});
