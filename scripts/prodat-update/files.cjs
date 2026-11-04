'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),{createHash}=require('node:crypto'),{crc32}=require('node:zlib');
const {Transform}=require('node:stream'),{pipeline}=require('node:stream/promises'),unzipper=require('unzipper');
const {GateError}=require('../pricat-update/update.cjs');
const guard=(ok,code)=>{if(!ok)throw new GateError(code);};
async function verifyZip(file,max=2*1024**3){
 const entries=(await unzipper.Open.file(file)).files.filter(e=>e.type!=='Directory');guard(entries.length===1&&/\.xml$/i.test(entries[0].path),'ONE_XML_REQUIRED');
 const entry=entries[0];guard(entry.uncompressedSize<=max,'ZIP_LIMIT');let bytes=0,crc=0;
 for await(const b of entry.stream()){bytes+=b.length;guard(bytes<=max,'ZIP_LIMIT');crc=crc32(b,crc);}
 guard(bytes===entry.uncompressedSize&&crc===entry.crc32,'ZIP_CRC_OR_SIZE');return {xmlName:entry.path,xmlBytes:bytes,crcVerified:true};
}
async function download(client,entry,directory,policy){
 const file=path.join(directory,entry.name),part=file+'.part',hash=createHash('sha256');let size=0;
 const sink=fs.createWriteStream(part,{flags:'wx',mode:0o600});
 const bounded=new Transform({transform(b,_e,cb){size+=b.length;if(size>entry.sizeBytes||size>policy.maxFileBytes)return cb(new GateError('DOWNLOAD_LIMIT'));hash.update(b);cb(null,b);}});
 const writing=pipeline(bounded,sink);writing.catch(()=>{});const timer=setTimeout(()=>{bounded.destroy(new GateError('DOWNLOAD_TIMEOUT'));client.close();},policy.downloadTimeoutMs);
 try{await client.downloadTo(bounded,entry.path);await writing;guard(size===entry.sizeBytes,'DOWNLOAD_SIZE');const h=await fsp.open(part,'r');try{await h.sync();}finally{await h.close();}await fsp.rename(part,file);return {path:file,name:entry.name,sha256:hash.digest('hex')};}
 catch(e){bounded.destroy();sink.destroy();await writing.catch(()=>{});throw e;}finally{clearTimeout(timer);}
}
module.exports={verifyZip,download,guard};
