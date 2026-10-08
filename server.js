
import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const app=express(),root=path.resolve('runtime'),active=new Set(),stopping=new Set();
const ai=process.env.OPENAI_API_KEY?new OpenAI({apiKey:process.env.OPENAI_API_KEY}):null;
const allowed=new Set(['.jpg','.jpeg','.png','.webp','.tif','.tiff']);
const file=id=>path.join(root,id,'job.json');
const quote=s=>'"'+String(s??'').replaceAll('"','""').replaceAll('\n',' ')+'"';
async function write(p,v){await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,v)}
async function load(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid ID');return JSON.parse(await fs.readFile(file(id),'utf8'))}
async function save(j){
 await write(file(j.id),JSON.stringify(j,null,2));
 const keys=['fileName','originalPath','relativePath','width','height','megapixels','format','sizeBytes','status','qualityScore','issues','explanation','outputCopy','inputTokens','outputTokens','estimatedCost'];
 const rows=j.results.map(r=>keys.map(k=>quote(Array.isArray(r[k])?r[k].join('; '):r[k])).join(','));
 await write(path.join(root,j.id,'Quality_Report.csv'),[keys.map(quote).join(','),...rows].join('\r\n')+'\r\n');
}
async function scan(dir,base=dir,found=[]){
 for(const e of await fs.readdir(dir,{withFileTypes:true})){
  if(e.isSymbolicLink())continue;
  const p=path.join(dir,e.name);
  if(e.isDirectory())await scan(p,base,found);
  else if(e.isFile()&&allowed.has(path.extname(e.name).toLowerCase()))found.push(path.relative(base,p));
 }
 return found;
}
async function inspect(p){
 if(!ai)throw Error('OPENAI_API_KEY is not configured');
 const bytes=await sharp(p).rotate().resize(2048,2048,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();
 const response=await ai.chat.completions.create({
  model:process.env.OPENAI_MODEL||'gpt-4.1-nano',max_tokens:250,response_format:{type:'json_object'},
  messages:[
   {role:'system',content:'You inspect stock images for clear visual defects. Look for broken anatomy, malformed objects, unrealistic shadows, reflections, illegible generated text, blur, artifacts, and geometry errors. Do not reject intentional stylization. Return JSON: status PASS, REVIEW or FAIL; score 0-100; issues array of short strings; explanation short English sentence. Use FAIL only for clear major defects.'},
   {role:'user',content:[{type:'text',text:'Inspect this image for visible quality issues. Return JSON only.'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+bytes.toString('base64'),detail:'high'}}]}
  ]
 });
 const raw=JSON.parse(response.choices[0].message.content);
 const inputTokens=response.usage?.prompt_tokens||0,outputTokens=response.usage?.completion_tokens||0;
 const estimatedCost=inputTokens*Number(process.env.INPUT_USD_PER_MILLION||.10)/1e6+outputTokens*Number(process.env.OUTPUT_USD_PER_MILLION||.40)/1e6;
 return {status:['PASS','REVIEW','FAIL'].includes(raw.status)?raw.status:'REVIEW',qualityScore:Number(raw.score)||0,issues:Array.isArray(raw.issues)?raw.issues:[],explanation:String(raw.explanation||''),inputTokens,outputTokens,estimatedCost};
}
async function run(id){
 if(active.has(id))return;
 active.add(id);stopping.delete(id);
 const j=await load(id);j.state='running';await save(j);
 try{
  const completed=new Set(j.results.map(r=>r.relativePath));
  for(const relativePath of j.files){
   if(completed.has(relativePath))continue;
   if(stopping.has(id)){j.state='stopped';break}
   if(j.estimatedCost>=j.budget){j.state='budget_exceeded';break}
   const originalPath=path.join(j.folder,relativePath);
   j.currentFile=relativePath;await save(j);
   const r={fileName:path.basename(relativePath),relativePath,originalPath,status:'ERROR',issues:[],explanation:'',outputCopy:'',qualityScore:null,inputTokens:0,outputTokens:0,estimatedCost:0};
   try{
    const stat=await fs.stat(originalPath);
    r.sizeBytes=stat.size;
    const m=await sharp(originalPath,{failOn:'error'}).metadata();
    r.width=m.width;r.height=m.height;r.format=m.format;r.megapixels=Number((m.width*m.height/1e6).toFixed(2));
    if(r.megapixels<j.minMp){r.status='FAIL';r.qualityScore=0;r.issues=['Resolution below minimum'];r.explanation='Technical validation failed';}
    else Object.assign(r,await inspect(originalPath));
    j.estimatedCost+=r.estimatedCost;
    if(r.status==='FAIL'||r.status==='REVIEW'){
     const dest=path.join(root,id,r.status==='FAIL'?'Defected':'Review',relativePath);
     await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(originalPath,dest);r.outputCopy=dest;
    }
   }catch(e){r.status='ERROR';r.issues=[String(e.message||e)];r.explanation='Inspection failed'}
   j.results.push(r);await save(j);
  }
  if(j.state==='running')j.state='completed';
 }catch(e){j.state='interrupted';j.error=String(e.message||e)}
 finally{j.currentFile='';await save(j);active.delete(id);stopping.delete(id)}
}
app.use(express.json({limit:'16kb'}));
app.use(express.static(path.resolve('public')));
app.post('/api/jobs',async(req,res)=>{
 try{
  if(active.size)throw Error('A job is already running');
  const folder=String(req.body.folder||'');
  if(!path.isAbsolute(folder))throw Error('Enter an absolute local folder path');
  if(!(await fs.stat(folder)).isDirectory())throw Error('Not a directory');
  if(path.resolve(folder)===root||path.resolve(folder).startsWith(root+path.sep))throw Error('Cannot scan output directory');
  const budget=Number(req.body.budget),minMp=Number(req.body.minMp);
  if(!(budget>0&&budget<=1000&&minMp>=1&&minMp<=100))throw Error('Invalid budget or minimum megapixels');
  const files=await scan(folder);if(!files.length)throw Error('No supported images found');
  const id=crypto.randomUUID(),j={id,folder,files,budget,minMp,results:[],state:'queued',currentFile:'',estimatedCost:0,reportPath:path.join(root,id,'Quality_Report.csv')};
  await save(j);await write(path.join(root,'latest.txt'),id);res.status(201).json({id});void run(id);
 }catch(e){res.status(400).json({error:String(e.message||e)})}
});
app.get('/api/jobs/latest',async(req,res)=>{try{res.json({id:(await fs.readFile(path.join(root,'latest.txt'),'utf8')).trim()})}catch{res.json({id:null})}});
app.get('/api/jobs/:id',async(req,res)=>{try{const job=await load(req.params.id);if(job.state==='running'&&!active.has(job.id)){job.state='interrupted';await save(job)}res.json({job})}catch{res.status(404).json({error:'Job not found'})}});
app.post('/api/jobs/:id/stop',(req,res)=>{stopping.add(req.params.id);res.json({ok:true})});
app.post('/api/jobs/:id/resume',async(req,res)=>{try{if(active.size)throw Error('Another job is running');const j=await load(req.params.id);if(!['stopped','interrupted'].includes(j.state))throw Error('Job cannot be resumed');res.json({ok:true});void run(j.id)}catch(e){res.status(409).json({error:String(e.message||e)})}});
await fs.mkdir(root,{recursive:true});
app.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Dashboard: http://127.0.0.1:'+(process.env.PORT||3000)));
