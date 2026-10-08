import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {INBOX,DEFECTED,REVIEW,STATE,REPORT,scan,signature,sameSignature,inspect,moveResult,readJson,writeJson,estimatePerImage,stats,reviewVersion} from './engine.js';
let current=null,stop=false;
export function status(){return current?{...current}: {state:'idle',processed:0,total:0,currentFile:'',error:''}}
export async function prepare(){
 if(current?.state==='running')throw Error('Checking is already running');
 const files=await scan(),saved=await readJson(STATE,{results:[]});
 const results=Array.isArray(saved.results)?saved.results:[];
 const known=new Map(results.map(r=>[r.relativePath,r]));
 const pending=[];
 for(const relativePath of files){const sig=await signature(relativePath),old=known.get(relativePath);if(!old||old.status==='ERROR'||old.reviewVersion!==reviewVersion||!sameSignature(sig,old.signature))pending.push({relativePath,sig})}
 const token=crypto.randomUUID();
 const plan={token,createdAt:Date.now(),fileNames:files,totalImages:files.length,alreadyChecked:files.length-pending.length,pendingImages:pending.length,perImage:estimatePerImage,per2000:estimatePerImage*2000,totalCost:estimatePerImage*pending.length,pending};
 current={state:'awaiting_confirmation',processed:0,total:pending.length,currentFile:'',error:'',plan};
 return {token,totalImages:plan.totalImages,alreadyChecked:plan.alreadyChecked,pendingImages:plan.pendingImages,perImage:plan.perImage,per2000:plan.per2000,model:process.env.OPENAI_MODEL||'gpt-4.1-nano',totalCost:plan.totalCost};
}
export async function start(token){
 if(current?.state!=='awaiting_confirmation'||current.plan.token!==token)throw Error('Cost estimate expired. Click Start Checking again.');
 if(Date.now()-current.plan.createdAt>5*60*1000)throw Error('Estimate expired. Click Start Checking again.');
 const plan=current.plan;
 // Check files are still present and unchanged before honoring this estimate.
 for(const p of plan.pending){let now;try{now=await signature(p.relativePath)}catch{throw Error('Input folder changed. Please estimate again.')}if(!sameSignature(now,p.sig))throw Error('Input folder changed. Please estimate again.')}
 const nowFiles=await scan();if(nowFiles.length!==plan.totalImages||nowFiles.some((name,i)=>name!== (await Promise.resolve(plan.fileNames))[i]))throw Error('Input folder changed. Please estimate again.');
 current={state:'running',processed:0,total:plan.pending.length,currentFile:'',error:''};stop=false;
 void run(plan).catch(e=>{current={...current,state:'error',error:e.message}});
 return {started:true};
}
export function cancel(token){if(current?.state==='awaiting_confirmation'&&current.plan.token===token){current={state:'idle',processed:0,total:0,currentFile:'',error:''};return true}return false}
export function requestStop(){if(current?.state!=='running')return false;stop=true;return true}
async function run(plan){
 const saved=await readJson(STATE,{results:[]}),results=Array.isArray(saved.results)?saved.results:[];
 await fs.mkdir(DEFECTED,{recursive:true});await fs.mkdir(REVIEW,{recursive:true});
 for(const p of plan.pending){
  if(stop){current.state='stopped';break}
  current.currentFile=p.relativePath;
  const r=await inspect(p.relativePath,p.sig);
  if(['FAIL','REVIEW'].includes(r.status)){try{await moveResult(r)}catch(e){r.status='ERROR';r.issues.push('Move failed: '+e.message);r.explanation='Move failed; verify files.'}}
  const index=results.findIndex(x=>x.relativePath===p.relativePath);
  if(index>=0)results[index]=r;else results.push(r);
  await writeJson(STATE,{results,updatedAt:new Date().toISOString()});
  await writeJson(REPORT,{results,updatedAt:new Date().toISOString(),summary:stats(results)});
  current.processed++;
 }
 if(current.state==='running')current.state='completed';
 current.currentFile='';
}
