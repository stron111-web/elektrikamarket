'use strict';
// TLS by default. Owner-approved plaintext is pinned to one exact endpoint;
// failed TLS never falls back to plaintext automatically.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path');
const {Transform}=require('node:stream'),{Client}=require('basic-ftp');
const {GateError,privateJson,hash}=require('./update.cjs');
const SOURCES=[{source:'PRICAT1',code:'2610',directory:'/pricat/',format:'zip'},
 {source:'PRICAT2',code:'2630',directory:'/pricat/TVER/',format:'xml'}];
const guard=(ok,code)=>{if(!ok)throw new GateError(code);};
function configuration(c){
 guard(c&&typeof c.host==='string'&&/^[a-zA-Z0-9.-]+$/.test(c.host)&&Number.isInteger(c.port)&&c.port>0&&c.port<65536,'FTPS_ENDPOINT');
 guard(path.isAbsolute(c.credentialsFile||'')&&/^\d+$/.test(c.customerCode||'')&&Number.isFinite(c.settleSeconds)&&c.settleSeconds>=0,'FTPS_CONFIG');
 guard(c.secure===undefined||typeof c.secure==='boolean','FTPS_REQUIRED');
 if(c.secure===false)guard(c.allowPlaintextForRussvet===true&&c.host==='service.russvet.ru'&&c.port===21021,'FTP_PLAINTEXT_NOT_ALLOWED');
 return c.secure!==false;
}
function choose(entries,s,customerCode){
 const pattern=new RegExp('^PRICAT_'+customerCode+'_'+s.code+'_(\\d{14})\\.'+s.format+'$','i');
 const matches=entries.filter(f=>f.isFile&&pattern.test(f.name)).map(f=>({...f,date:pattern.exec(f.name)[1]}));
 guard(matches.length>0,'FTP_SOURCE_MISSING');matches.sort((a,b)=>b.date.localeCompare(a.date));
 guard(matches.length===1||matches[0].date!==matches[1].date,'FTP_AMBIGUOUS_NEWEST');
 return {source:s.source,format:s.format,name:matches[0].name,date:matches[0].date,directory:s.directory};
}
class FtpsSource {
 constructor(config,policy){this.secure=configuration(config);this.config=config;this.policy=policy;this.client=new Client(Math.min(policy.downloadTimeoutMs,30000));this.client.ftp.verbose=false;}
 async connect(){
  const c=this.config,auth=await privateJson(c.credentialsFile);
  guard(typeof auth.username==='string'&&auth.username.length>0&&typeof auth.password==='string'&&auth.password.length>0&&!/[\r\n\0]/.test(auth.username+auth.password),'FTPS_CREDENTIAL_FORMAT');
  const secureOptions={minVersion:'TLSv1.2',rejectUnauthorized:true,servername:c.host};
  if(this.secure&&c.caFile)secureOptions.ca=await fsp.readFile(c.caFile);
  await this.client.access({host:c.host,port:c.port,user:auth.username,password:auth.password,secure:this.secure,secureOptions:this.secure?secureOptions:undefined});
  if(this.secure){
   guard(this.client.ftp.socket.encrypted&&this.client.ftp.socket.authorized,'FTPS_CERTIFICATE_REQUIRED');
  // basic-ftp default settings ignore negative replies to these two commands.
  // Require affirmative replies ourselves before any listing/download.
   await this.client.send('PBSZ 0');await this.client.send('PROT P');
  }
 }
 async info(entry,now){
  const remote=entry.directory+entry.name,size=await this.client.size(remote),modified=(await this.client.lastMod(remote)).toISOString();
  const age=now-Date.parse(modified);
  guard(Number.isSafeInteger(size)&&size>0&&size<=this.policy.maxFileBytes,'FTP_SOURCE_SIZE');
  guard(age>=this.config.settleSeconds*1000&&age>=-this.policy.maxFutureMinutes*60000,'FTP_FILE_NOT_SETTLED');
  return {...entry,sizeBytes:size,modified};
 }
 async latest(now){const entries=[];for(const s of SOURCES)entries.push(await this.info(choose(await this.client.list(s.directory),s,this.config.customerCode),now));return entries;}
 async download(entry,directory){
  const file=path.join(directory,entry.source+'.'+entry.format),part=file+'.part';let size=0;
  const sink=fs.createWriteStream(part,{flags:'wx',mode:0o600});
  const limit=new Transform({transform:(b,_e,cb)=>{size+=b.length;cb(size>entry.sizeBytes?new GateError('FTP_DOWNLOAD_SIZE'):null,b);}});
  // Both stream errors and FTP failures propagate; never leave an unhandled sink error.
  const {pipeline}=require('node:stream/promises');const writing=pipeline(limit,sink);writing.catch(()=>{});
  const timer=setTimeout(()=>{limit.destroy(new GateError('FTP_TRANSFER_TIMEOUT'));this.client.close();},this.policy.downloadTimeoutMs);
  try{
   await this.client.downloadTo(limit,entry.directory+entry.name);await writing;
   guard(size===entry.sizeBytes,'FTP_DOWNLOAD_SIZE');
   const after=await this.info(entry,Date.now());guard(after.sizeBytes===entry.sizeBytes&&after.modified===entry.modified,'FTP_SOURCE_CHANGED_DURING_DOWNLOAD');
   const h=await fsp.open(part,'r');try{await h.sync();}finally{await h.close();}
   await fsp.rename(part,file);
   return {source:entry.source,format:entry.format,path:file,sizeBytes:size,sha256:await hash(file),documentDate:entry.date,documentNumber:path.parse(entry.name).name.replace(/^PRICAT_/i,''),remote:{name:entry.name,sizeBytes:size,modified:entry.modified}};
  }catch(e){limit.destroy();sink.destroy();await writing.catch(()=>{});throw e;}finally{clearTimeout(timer);}
 }
 close(){this.client.close();}
}
module.exports={FtpsSource,SOURCES,choose,configuration};
