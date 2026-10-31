'use strict';
// Local test protocol fixture only; not included in the runtime image.
const net=require('node:net'),tls=require('node:tls'),path=require('node:path');
async function fixture({key,cert,plain=false,allowPlainLogin=false,port=0,files=new Map()}){
 const sockets=new Set(),servers=new Set(),stats={commands:[],downloads:[],protectedTransfers:0,plainTransfers:0};
 const options={key,cert},secureContext=tls.createSecureContext(options);
 const server=net.createServer(initial=>{
  sockets.add(initial);initial.on('close',()=>sockets.delete(initial));initial.on('error',()=>{});
  let control=initial,cwd='/',dataServer,dataPromise,protectedData=false;
  const send=s=>control.write(s+'\r\n');
  const remote=s=>path.posix.resolve(cwd,s||'.');
  function attach(socket){let buffer='';socket.on('error',()=>{});socket.on('data',b=>{buffer+=b.toString();let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);handle(line).catch(()=>socket.destroy());}});}
  async function passive(){
   const track=s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});};
   dataServer=allowPlainLogin?net.createServer(track):tls.createServer(options,track);servers.add(dataServer);
   dataServer.on('tlsClientError',()=>{});
   dataPromise=new Promise(resolve=>dataServer.once(allowPlainLogin?'connection':'secureConnection',resolve));
   await new Promise(resolve=>dataServer.listen(0,'127.0.0.1',resolve));
   send('229 Entering Extended Passive Mode (|||'+dataServer.address().port+'|)');
  }
  async function transfer(body){
   if(!protectedData&&!allowPlainLogin){send('534 PROT P required');return;}
   send('150 Opening data');const s=await dataPromise;if(s.encrypted)stats.protectedTransfers++;else stats.plainTransfers++;
   s.end(body,()=>send('226 Complete'));dataServer.close();servers.delete(dataServer);
  }
  async function handle(line){
   const cut=line.indexOf(' '),verb=(cut<0?line:line.slice(0,cut)).toUpperCase(),arg=cut<0?'':line.slice(cut+1);stats.commands.push(verb);
   if(verb==='AUTH'){
    if(plain){send('500 TLS unavailable');return;}
    send('234 Begin TLS');initial.removeAllListeners('data');control=new tls.TLSSocket(initial,{isServer:true,secureContext});attach(control);return;
   }
   if(verb==='QUIT'){send('221 Bye');control.end();return;}
   if(!control.encrypted&&!allowPlainLogin){send('534 TLS required');return;}
   if(verb==='USER'){send('331 Password required');return;}
   if(verb==='PASS'){send(server.rejectLogin?'530 Login rejected':'230 Fixture login');return;}
   if(verb==='FEAT'){send('211-Features\r\n MLST type*;size*;modify*;\r\n UTF8\r\n211 End');return;}
   if(verb==='PROT'){if(server.rejectProtection){send('534 Protection rejected');return;}protectedData=arg==='P';send('200 Protection set');return;}
   if(['TYPE','STRU','PBSZ','OPTS'].includes(verb)){send('200 OK');return;}
   if(verb==='PWD'){send('257 "'+cwd+'"');return;}
   if(verb==='CWD'){if(server.failListing){send('550 Unavailable');return;}cwd=remote(arg);send('250 Changed');return;}
   if(verb==='EPSV'){await passive();return;}
   if(verb==='SIZE'||verb==='MDTM'){
    const f=files.get(remote(arg));if(!f){send('550 Missing');return;}
    send('213 '+(verb==='SIZE'?f.body.length:f.modified));return;
   }
   if(verb==='MLSD'||verb==='LIST'){
    if(server.failListing){send('550 Unavailable');return;}
    const dir=remote(arg),rows=[];
    for(const [name,f]of files)if(path.posix.dirname(name)===dir)rows.push('type=file;size='+f.body.length+';modify='+f.modified+'; '+path.posix.basename(name));
    await transfer(rows.join('\r\n')+'\r\n');return;
   }
   if(verb==='RETR'){
    const p=remote(arg),f=files.get(p);if(!f){send('550 Missing');return;}
    stats.downloads.push(p);if(server.onRetrieve)server.onRetrieve(p,f);await transfer(f.body);return;
   }
   send('502 Unsupported');
  }
  send('220 Local isolated FTPS fixture');attach(initial);
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {server,files,stats,port:server.address().port,async close(){for(const s of sockets)s.destroy();for(const s of servers)s.close();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={fixture};
