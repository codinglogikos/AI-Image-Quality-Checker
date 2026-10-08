import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import OpenAI from 'openai';
export const BASE=process.cwd(), INBOX=path.join(BASE,'images'), DEFECTED=path.join(BASE,'Defected'), REVIEW=path.join(BASE,'Review'), DATA=path.join(BASE,'runtime'), STATE=path.join(DATA,'check-state.json'), REPORT=path.join(DATA,'report.json');
const valid=new Set(['.jpg','.jpeg','.png','.webp','.tif','.tiff']);
const inputRate=Number(process.env.INPUT_USD_PER_MILLION||0.10),outputRate=Number(process.env.OUTPUT_USD_PER_MILLION||0.40);
export const estimatePerImage=Number(process.env.ESTIMATED_INPUT_TOKENS||2200)*inputRate/1e6+Number(process.env.ESTIMATED_OUTPUT_TOKENS||220)*outputRate/1e6;
const client=process.env.OPENAI_API_KEY?new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:60000,maxRetries:1}):null;
export async function writeJson(p,obj){await fs.mkdir(path.dirname(p),{recursive:true});const tmp=p+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(obj,null,2));await fs.rename(tmp,p)}
export async function readJson(p,fallback){try{return JSON.parse(await fs.readFile(p,'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
export async function scan(){await fs.mkdir(INBOX,{recursive:true});const out=[];async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())continue;const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile()&&valid.has(path.extname(e.name).toLowerCase()))out.push(path.relative(INBOX,p))}}await walk(INBOX);return out.sort()}
export async function signature(rel){const s=await fs.stat(path.join(INBOX,rel));return {size:s.size,modified:s.mtimeMs}}
export const sameSignature=(a,b)=>!!a&&!!b&&a.size===b.size&&a.modified===b.modified;
export async function vision(absolute){
 if(!client)throw Error('OPENAI_API_KEY missing in .env');
 const data=await sharp(absolute,{failOn:'error'}).rotate().resize(1536,1536,{fit:'inside',withoutEnlargement:true}).jpeg({quality:78}).toBuffer();
 const response=await client.chat.completions.create({model:process.env.OPENAI_MODEL||'gpt-4.1-nano',temperature:0,max_tokens:280,response_format:{type:'json_object'},messages:[
 {role:'system',content:'You are a cautious stock image quality reviewer. Check for significant visual defects: broken anatomy, impossible geometry, floating objects, wrong shadows, inconsistent reflections, distorted products, garbled text, strange textures and lighting. Respect intentional illustration and stylization. Return JSON with status (PASS, REVIEW, FAIL), score (integer 0-100), issues (array of short English strings), explanation (short English sentence). FAIL only clear major defects; REVIEW uncertain cases. Never guarantee Adobe approval.'},
 {role:'user',content:[{type:'text',text:'Evaluate visible image quality. Return requested JSON.'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+data.toString('base64'),detail:'high'}}]}]});
 const parsed=JSON.parse(response.choices[0]?.message?.content||'{}');
 const inputTokens=response.usage?.prompt_tokens||0,outputTokens=response.usage?.completion_tokens||0;
 return {status:['PASS','REVIEW','FAIL'].includes(parsed.status)?parsed.status:'REVIEW',score:Number.isFinite(Number(parsed.score))?Math.min(100,Math.max(0,Math.round(Number(parsed.score)))):null,issues:Array.isArray(parsed.issues)?parsed.issues.filter(x=>typeof x==='string').slice(0,10):[],explanation:String(parsed.explanation||''),inputTokens,outputTokens,cost:inputTokens*inputRate/1e6+outputTokens*outputRate/1e6};
}
export async function inspect(rel,sig){
 const absolute=path.join(INBOX,rel),result={id:crypto.randomUUID(),relativePath:rel,fileName:path.basename(rel),originalPath:absolute,status:'ERROR',score:null,issues:[],explanation:'',outputPath:'',width:0,height:0,megapixels:0,format:'',sizeBytes:sig.size,inputTokens:0,outputTokens:0,cost:0,signature:sig,checkedAt:new Date().toISOString()};
 try{
 const meta=await sharp(absolute,{failOn:'error',limitInputPixels:200000000}).metadata();
 result.width=meta.width||0;result.height=meta.height||0;result.format=meta.format||'';result.megapixels=Number((result.width*result.height/1e6).toFixed(2));
 const minimum=Number(process.env.MIN_MEGAPIXELS||4);
 if(result.megapixels<minimum){result.status='FAIL';result.score=0;result.issues=['Below '+minimum+' megapixels'];result.explanation='Insufficient resolution for configured screening threshold.'}
 else{let v;for(let attempt=0;attempt<3;attempt++){try{v=await vision(absolute);break}catch(e){if(attempt===2)throw e;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)))}}Object.assign(result,v)}
 }catch(e){result.status='ERROR';result.issues=[String(e.message||e)];result.explanation='Inspection failed. Image remains in the input folder.'}
 return result;
}
export async function moveResult(result){
 if(!['FAIL','REVIEW'].includes(result.status))return result;
 const dest=path.join(result.status==='FAIL'?DEFECTED:REVIEW,result.relativePath);
 await fs.mkdir(path.dirname(dest),{recursive:true});
 let target=dest;try{await fs.access(target);target=path.join(path.dirname(dest),path.parse(dest).name+'-'+crypto.randomUUID().slice(0,8)+path.extname(dest))}catch(e){if(e.code!=='ENOENT')throw e}
 try{await fs.rename(result.originalPath,target)}catch(e){if(e.code!=='EXDEV')throw e;await fs.copyFile(result.originalPath,target,1);await fs.unlink(result.originalPath)}
 result.outputPath=target;return result;
}
export function stats(results){return {total:results.length,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,review:results.filter(r=>r.status==='REVIEW').length,error:results.filter(r=>r.status==='ERROR').length,cost:results.reduce((s,r)=>s+(r.cost||0),0)}}
