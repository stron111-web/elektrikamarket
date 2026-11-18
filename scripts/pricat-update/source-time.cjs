'use strict';
// Supplier document stamps have no timezone. FTP MDTM is UTC (RFC 3659).
class SourceTimeError extends Error { constructor(code) { super(code); this.code=code; } }
function documentStamp(raw) {
  if(typeof raw!=='string'||!/^\d{14}$/.test(raw))throw new SourceTimeError('FTP_SOURCE_DATE');
  const iso=`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}.000Z`;
  const ms=Date.parse(iso);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==iso)throw new SourceTimeError('FTP_SOURCE_DATE');
  return ms; // Calendar validity/order only; not a claim about the supplier's timezone.
}
function sourceTimestamp(entry,p,now,accepted=false) {
  documentStamp(entry.date??entry.documentDate);
  const modified=entry.modified??entry.remoteModified;
  let ms;
  if(modified!==undefined) {
    ms=Date.parse(modified);
    if(typeof modified!=='string'||!Number.isFinite(ms)||new Date(ms).toISOString()!==modified)
      throw new SourceTimeError('FTP_MODIFIED_DATE');
  } else ms=documentStamp(entry.date??entry.documentDate); // Explicit legacy/local manifests.
  if(ms>now+p.maxFutureMinutes*60000||!accepted&&ms<now-p.maxAgeHours*3600000)
    throw new SourceTimeError(modified===undefined?'FTP_SOURCE_DATE':'FTP_MODIFIED_DATE');
  return ms;
}
module.exports={documentStamp,sourceTimestamp,SourceTimeError};
