'use strict';
// Diagnostic CLI. Never loads .env, database URLs, runtime config or FTP credentials.
const fs=require('node:fs/promises'),path=require('node:path');
const {readIndex,compare}=require('./source-review.cjs');
async function main(){
 process.umask(0o077);
 const args=process.argv.slice(2),o={};
 if(args.length!==8)throw Error('Use --previous FILE --current FILE --source PRICAT1|PRICAT2 --out DIRECTORY');
 for(let i=0;i<args.length;i+=2){const k=args[i];if(!['--previous','--current','--source','--out'].includes(k)||o[k])throw Error('Invalid arguments');o[k]=args[i+1];}
 if(Object.keys(o).length!==4||!['PRICAT1','PRICAT2'].includes(o['--source']))throw Error('Explicit files and source required');
 const previous=await readIndex(path.resolve(o['--previous']),o['--source']);
 const current=await readIndex(path.resolve(o['--current']),o['--source']);
 const result=compare(previous,current),{entries,...counts}=result;
 const out=path.resolve(o['--out']);await fs.mkdir(out,{mode:0o700});
 const handle=await fs.open(path.join(out,'codes.ndjson'),'wx',0o600);
 try{for(const e of entries)await handle.writeFile(JSON.stringify(e)+'\n');}finally{await handle.close();}
 const summary={mode:'OFFLINE_REVIEW_NO_IMPORT',...counts,previousIdentity:{sha256:previous.sha256,document:previous.document},currentIdentity:{sha256:current.sha256,document:current.document},publishAllowed:false,
  limitations:['Historical file integrity and code delta only; no live snapshot or manual/locked/UOM database validation','Semantic completeness is not proved by a valid XML/ZIP','No activation or saleability decision']};
 await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(summary));
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'REVIEW_FAILED',code:e.code||'REVIEW_ERROR'}));process.exitCode=1;});
