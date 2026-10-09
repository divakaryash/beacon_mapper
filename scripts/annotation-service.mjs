import {spawn} from 'node:child_process';
import path from 'node:path';
export function annotationService(){return {name:'professional-annotation',configureServer(server){install(server.middlewares);},configurePreviewServer(server){install(server.middlewares);}};}
function install(middlewares){middlewares.use('/api/professional-annotation',async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.method!=='POST'){res.statusCode=405;return res.end(JSON.stringify({error:'POST required'}));}
  let originHost;try{originHost=req.headers.origin?new URL(req.headers.origin).host:null;}catch{originHost='invalid';}
  if(originHost&&originHost!==req.headers.host){res.statusCode=403;return res.end(JSON.stringify({error:'Same-origin requests required'}));}
  let body='';try{for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>15000000)throw new Error('Annotation input exceeds 15 MB');}JSON.parse(body);}catch(e){res.statusCode=400;return res.end(JSON.stringify({error:e.message}));}
  const child=spawn(path.resolve('.venv-annotation/bin/python'),[path.resolve('scripts/export_annotation.py'),'--stdin'],{stdio:['pipe','pipe','pipe']});let output='',errors='';
  const timer=setTimeout(()=>child.kill(),120000);let ended=false;
  function finish(code){if(ended)return;ended=true;clearTimeout(timer);res.statusCode=code===0?200:422;res.end(code===0?output:JSON.stringify({error:errors||'Annotation validation failed or timed out. Install requirements-annotation.txt in .venv-annotation.'}));}
  child.on('error',e=>{errors=e.message;finish(1);});child.on('close',finish);child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>errors+=c);child.stdin.on('error',()=>{});child.stdin.end(body);
});}
