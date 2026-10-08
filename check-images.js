import 'dotenv/config';
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {INBOX,DEFECTED,REVIEW,STATE,REPORT,scan,signature,sameSignature,inspect,moveResult,readJson,writeJson,estimatePerImage,stats,reviewVersion} from './engine.js';

const rl=readline.createInterface({input:stdin,output:stdout});
let cancelled=false;process.on('SIGINT',()=>{cancelled=true;console.log('\nStopping safely after current image...')});
try{
 const files=await scan();
 const saved=await readJson(STATE,{results:[]});
 const results=Array.isArray(saved.results)?saved.results:[];
 const known=new Map(results.map(r=>[r.relativePath,r]));
 const pending=[];
 for(const relativePath of files){
  const sig=await signature(relativePath),old=known.get(relativePath);
  if(!old||old.status==='ERROR'||old.reviewVersion!==reviewVersion||!sameSignature(sig,old.signature))pending.push({relativePath,sig});
 }
 const resumed=files.length-pending.length;
 const estimated=estimatePerImage*pending.length;
 console.log('\nAI Image Quality Checker');
 console.log('Input folder: '+INBOX);
 console.log('Total images currently in input: '+files.length);
 console.log('Previously checked and unchanged: '+resumed);
 console.log('Images requiring inspection: '+pending.length);
 console.log('Estimated cost per image: $'+estimatePerImage.toFixed(6));
 console.log('Estimated additional API cost: $'+estimated.toFixed(4));
 console.log('This is an approximate estimate based on configured token assumptions, not a spending cap.');
 if(!pending.length){console.log('Nothing new to inspect. Open the report dashboard with npm run report.');process.exitCode=0}
 else{
  const answer=(await rl.question('Continue and authorize API charges? (Y/N): ')).trim().toLowerCase();
  if(answer!=='y'&&answer!=='yes'){console.log('Cancelled. No new image requests were sent.')}
  else{
   await fs.mkdir(DEFECTED,{recursive:true});await fs.mkdir(REVIEW,{recursive:true});
   for(let i=0;i<pending.length;i++){
    if(cancelled)break;
    const {relativePath,sig}=pending[i];
    console.log('['+(i+1)+'/'+pending.length+'] Checking: '+relativePath);
    const r=await inspect(relativePath,sig);
    if(r.status==='FAIL'||r.status==='REVIEW'){
     try{await moveResult(r)}catch(e){r.status='ERROR';r.issues.push('Move failed: '+e.message);r.explanation='Image not reliably moved; verify source and destination.'}
    }
    const index=results.findIndex(x=>x.relativePath===relativePath);
    if(index>=0)results[index]=r;else results.push(r);
    await writeJson(STATE,{results,updatedAt:new Date().toISOString()});
    await writeJson(REPORT,{results,updatedAt:new Date().toISOString(),summary:stats(results)});
    console.log('  '+r.status+' | '+(r.score??'N/A')+'/100 | Estimated actual usage $'+stats(results).cost.toFixed(4));
   }
   const summary=stats(results);
   console.log('\nFinished or paused. PASS: '+summary.pass+' | FAIL: '+summary.fail+' | REVIEW: '+summary.review+' | ERROR: '+summary.error);
   console.log('Total estimated API usage for recorded results: $'+summary.cost.toFixed(4));
   console.log('Run npm run report to open the report dashboard and download a PDF.');
  }
 }
}catch(e){console.error('Error:',e.message);process.exitCode=1}finally{rl.close()}
