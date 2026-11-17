const test=require('node:test'),assert=require('node:assert/strict');
const {observeProgress,diagnose,planNotice,acknowledgeIncident}=require('./watchdog-model.cjs');
const now=Date.parse('2026-11-17T15:00:00Z'),iso=n=>new Date(n).toISOString();
// Fixture values only; production timing budgets must come from measured runtimes.
const p={intervalMs:10800000,graceMs:600000,stallMs:600000,maxRunMs:3600000};
test('successful unchanged FTP check is healthy without a new publication',()=>{
 assert.equal(diagnose({lastSuccessfulCheckAt:iso(now-1000),lastPublicationAt:'2026-11-05T00:00:00Z',lastCheckStatus:'NO_REMOTE_CHANGE'},now,p).healthy,true);
});
test('a heartbeat without increasing counters does not conceal a stalled importer',()=>{
 const a=observeProgress(null,{phase:'parse',records:121540,bytes:474669509},iso(now-700000));
 const b=observeProgress(a,{phase:'parse',records:121540,bytes:474669509},iso(now));
 assert.equal(a.lastProgressAt,b.lastProgressAt);
 assert.equal(diagnose({running:true,startedAt:iso(now-800000),lastProgressAt:b.lastProgressAt,lastSuccessfulCheckAt:iso(now-1000)},now,p).code,'NO_PROGRESS');
});
test('deadline and overdue check are independent of the shared update lock',()=>{
 assert.equal(diagnose({running:true,startedAt:iso(now-4000000),lastProgressAt:iso(now)},now,p).code,'JOB_DEADLINE');
 assert.equal(diagnose({lastSuccessfulCheckAt:iso(now-12000000)},now,p).code,'CHECK_OVERDUE');
});
test('one incident notice until recovery even when its cause changes',()=>{
 const a=planNotice(null,{healthy:false,code:'NO_PROGRESS'},{source:'PRICAT1',now:iso(now)});
 const sent=acknowledgeIncident(a.state,{smtpAccepted:true});
 const b=planNotice(sent,{healthy:false,code:'CHECK_OVERDUE'},{source:'PRICAT1',now:iso(now+1)});assert.equal(b.notice,null);
 const c=planNotice(b.state,{healthy:true},{source:'PRICAT1',now:iso(now+2)});assert.equal(c.notice.kind,'RECOVERED');
 assert.equal(planNotice(c.state,{healthy:true},{source:'PRICAT1',now:iso(now+3)}).notice,null);
});
test('failed SMTP must not be marked delivered; retries retain the same incident identity',()=>{
 const a=planNotice(null,{healthy:false,code:'IMPORT_ERROR'},{source:'PRODAT',now:iso(now)});
 const failed=acknowledgeIncident(a.state,{smtpAccepted:false});
 const b=planNotice(failed,{healthy:false,code:'IMPORT_ERROR'},{source:'PRODAT',now:iso(now+1)});assert.equal(a.notice.incidentId,b.notice.incidentId);assert.equal(b.state.delivered,false);
});
test('no implicit production timeout values or missing timestamp success',()=>{
 assert.throws(()=>diagnose({},now,{}),/EXPLICIT_LIMIT_REQUIRED/);
 assert.equal(diagnose({},now,p).code,'MISSING_CHECK_TIMESTAMP');
});
