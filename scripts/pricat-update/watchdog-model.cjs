'use strict';
// Standalone watchdog draft. Pure functions: no locks, Docker control, SMTP, secrets or DB.
const time=v=>{const n=Date.parse(v);return Number.isFinite(n)?n:null;};
function observeProgress(old,{phase,records,bytes},now){
 if(!phase||!Number.isSafeInteger(records)||records<0||!Number.isSafeInteger(bytes)||bytes<0)throw Error('INVALID_PROGRESS');
 const progress=!old||phase!==old.phase||records>old.records||bytes>old.bytes;
 return {phase,records,bytes,lastHeartbeatAt:now,lastProgressAt:progress?now:old.lastProgressAt};
}
function diagnose(s,now,p){
 for(const k of ['intervalMs','graceMs','stallMs','maxRunMs'])if(!Number.isFinite(p[k])||p[k]<=0)throw Error('EXPLICIT_LIMIT_REQUIRED');
 if(s.needsReview)return {healthy:false,code:'PUBLICATION_NEEDS_REVIEW'};
 const started=time(s.startedAt),success=time(s.lastSuccessfulCheckAt),error=time(s.lastErrorAt);
 if(error!==null&&(success===null||error>success))return {healthy:false,code:'IMPORT_ERROR'};
 if(s.running){
  if(started===null)return {healthy:false,code:'MISSING_RUNNING_TIMESTAMP'};
  if(now-started>p.maxRunMs)return {healthy:false,code:'JOB_DEADLINE'};
  const progress=time(s.lastProgressAt)??started;
  if(now-progress>p.stallMs)return {healthy:false,code:'NO_PROGRESS'};
 }
 const first=time(s.firstExpectedCheckAt);
 const due=success===null?first:success+p.intervalMs;
 if(due===null)return {healthy:false,code:'MISSING_CHECK_TIMESTAMP'};
 if(now>due+p.graceMs)return {healthy:false,code:'CHECK_OVERDUE'};
 return {healthy:true,code:'OK'}; // A successful unchanged FTP check is success.
}
function planNotice(previous,health,{source,now}){
 if(!['PRICAT1','PRICAT2','PRODAT'].includes(source))throw Error('EXPLICIT_SOURCE_REQUIRED');
 if(health.healthy){
  if(previous?.active)return {state:{...previous,active:false},notice:{kind:'RECOVERED',source,incidentId:previous.id,at:now}};
  return {state:previous||null,notice:null};
 }
 const state=previous?.active?{...previous,code:health.code}:{id:source+':'+now,active:true,delivered:false,code:health.code};
 return {state,notice:state.delivered?null:{kind:'INCIDENT',source,incidentId:state.id,code:health.code,at:now}};
}
function acknowledgeIncident(state,{smtpAccepted}){return smtpAccepted?{...state,delivered:true}:state;}
module.exports={observeProgress,diagnose,planNotice,acknowledgeIncident};
