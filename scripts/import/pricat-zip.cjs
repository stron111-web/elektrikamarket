'use strict';
// Bounded native ZIP-entry stream. Avoid unzipper's custom PullStream on the
// slow SAX -> asynchronous spool writer path. Keep its central-directory reader.
const fs=require('node:fs'),fsp=fs.promises,{Transform}=require('node:stream'),{pipeline}=require('node:stream/promises'),{createInflateRaw,crc32}=require('node:zlib');
const zipError=code=>Object.assign(new Error(code),{code});
async function* streamZipEntry(file,entry,{maxXmlBytes=1073741824,signal}={}){
 signal?.throwIfAborted();
 const {compressedSize,uncompressedSize,offsetToLocalFileHeader,compressionMethod,flags}=entry;
 for(const n of [compressedSize,uncompressedSize,offsetToLocalFileHeader,maxXmlBytes])if(!Number.isSafeInteger(n)||n<0)throw zipError('ZIP_INVALID_SIZE');
 if(!compressedSize||!uncompressedSize||uncompressedSize>maxXmlBytes)throw zipError('ZIP_EXPANSION_LIMIT');
 if(flags&1||![0,8].includes(compressionMethod))throw zipError('ZIP_UNSUPPORTED_COMPRESSION_OR_ENCRYPTION');
 const h=await fsp.open(file,'r');let start;
 try{const b=Buffer.alloc(30),r=await h.read(b,0,30,offsetToLocalFileHeader),stat=await h.stat();
  if(r.bytesRead!==30||b.readUInt32LE(0)!==0x04034b50||b.readUInt16LE(8)!==compressionMethod||b.readUInt16LE(6)!==flags)throw zipError('ZIP_LOCAL_HEADER_MISMATCH');
  start=offsetToLocalFileHeader+30+b.readUInt16LE(26)+b.readUInt16LE(28);
  if(!Number.isSafeInteger(start)||start+compressedSize>stat.size)throw zipError('ZIP_TRUNCATED_ENTRY');
 }finally{await h.close();}
 let bytes=0,crc=0;
 const check=new Transform({transform(chunk,encoding,cb){bytes+=chunk.length;if(bytes>maxXmlBytes||bytes>uncompressedSize)return cb(zipError('ZIP_EXPANSION_LIMIT'));crc=crc32(chunk,crc);cb(null,chunk);},flush(cb){cb(bytes!==uncompressedSize||crc!==entry.crc32?zipError('ZIP_CRC_OR_SIZE'):null);}});
 const raw=fs.createReadStream(file,{start,end:start+compressedSize-1,highWaterMark:65536,signal}),inflate=compressionMethod===8?createInflateRaw():null;
 const completed=pipeline(...[raw,inflate,check].filter(Boolean),{signal});completed.catch(()=>{});
 let consumed=false;
 try{for await(const chunk of check)yield chunk;await completed;consumed=true;}
 finally{if(!consumed){raw.destroy();inflate?.destroy();check.destroy();await completed.catch(()=>{});}}
}
module.exports={streamZipEntry};
