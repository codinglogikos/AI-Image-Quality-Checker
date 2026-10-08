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
export const reviewVersion='strict-stock-v2';
export const sameSignature=(a,b)=>!!a&&!!b&&a.size===b.size&&a.modified===b.modified;
const REVIEW_VERSION=reviewVersion;
export async function vision(absolute){
 if(!client)throw Error('OPENAI_API_KEY missing in .env');
 const base=sharp(absolute,{failOn:'error',limitInputPixels:200000000}).rotate();
 const meta=await base.metadata();
 const swapped=[5,6,7,8].includes(meta.orientation);const width=swapped?(meta.height||0):(meta.width||0),height=swapped?(meta.width||0):(meta.height||0);
 if(!width||!height)throw Error('Unable to read image dimensions');
 const overview=await sharp(absolute,{failOn:'error'}).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();
 const imageParts=[{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+overview.toString('base64'),detail:'high'}}];
 // Four overlapping crops preserve local details that disappear in a whole-image preview.
 const cropWidth=Math.min(width,Math.max(1,Math.round(width*.58)));
 const cropHeight=Math.min(height,Math.max(1,Math.round(height*.58)));
 const boxes=[{left:0,top:0},{left:width-cropWidth,top:0},{left:0,top:height-cropHeight},{left:width-cropWidth,top:height-cropHeight}];
 for(const box of boxes){
  const crop=await sharp(absolute,{failOn:'error',limitInputPixels:200000000}).rotate().extract({...box,width:cropWidth,height:cropHeight}).resize(1200,1200,{fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();
  imageParts.push({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+crop.toString('base64'),detail:'high'}});
 }
 const response=await client.chat.completions.create({
  model:process.env.OPENAI_MODEL||'gpt-4.1-nano',temperature:0,max_tokens:750,response_format:{type:'json_object'},
  messages:[
   {role:'system',content:`You are a strict, skeptical stock-photo technical quality inspector. This is an independent rejection-risk screening, NOT an Adobe reviewer or an approval predictor. Examine the full image AND each of four overlapping detail crops. Identify specific visible evidence, not imagined defects. Pay particular attention to:
- AI generation artifacts: malformed fingers/hands/teeth/eyes/ears, merged limbs, strange faces, warped clothing, inconsistent people, floating objects.
- Medical/technical scenes: visibly impossible patient or staff positioning, implausible device geometry or physical connections, incorrect-looking anatomical models, nonsensical displays; do not invent specialist diagnoses from an image.
- Unreadable or gibberish text on screens, signage, labels, charts and equipment, especially where text is central to the scene.
- Focus, motion blur, compression, noise, overprocessing, banding, artifacts, clipped highlights/shadows, unnatural lighting and reflections, awkward composites.
- Inconsistencies across the scene, background, hands interacting with props, perspective and contact points.
Classify based on OBSERVABLE issues only. FAIL for clearly visible serious quality defects likely unacceptable for commercial stock; REVIEW for one or more plausible, subtle, ambiguous or moderate issues or when detail cannot be judged; PASS only when no meaningful issue is detected across all views. A high score is rare and requires excellent execution. Scores: FAIL 0-59, REVIEW 60-84, PASS 85-100. Return JSON with status, integer score, issues (short actionable English strings with locations), explanation (specific English rationale), suggestions (array of concrete English fixes). Never promise stock-platform acceptance. Do not treat ordinary medical subject matter as a defect.`},
   {role:'user',content:[{type:'text',text:'Review these five views of the SAME image: full overview followed by top-left, top-right, bottom-left and bottom-right crops. Be critical but evidence-based. Return only the requested JSON.'},...imageParts]}
  ]
 });
 const parsed=JSON.parse(response.choices[0]?.message?.content||'{}');
 const inputTokens=response.usage?.prompt_tokens||0,outputTokens=response.usage?.completion_tokens||0;
 const issues=Array.isArray(parsed.issues)?parsed.issues.filter(x=>typeof x==='string').slice(0,12):[];
 const suggestions=Array.isArray(parsed.suggestions)?parsed.suggestions.filter(x=>typeof x==='string').slice(0,8):[];
 let status=['PASS','REVIEW','FAIL'].includes(parsed.status)?parsed.status:'REVIEW';
 let score=Number.isFinite(Number(parsed.score))?Math.min(100,Math.max(0,Math.round(Number(parsed.score)))):null;
 // Enforce consistent status bands, without inventing a quality score.
 if(score!==null){if(status==='FAIL')score=Math.min(score,59);else if(status==='REVIEW')score=Math.max(60,Math.min(score,84));else score=Math.max(85,score)}
 if(status==='PASS'&&issues.length){status='REVIEW';score=score===null?null:Math.min(score,84)}
 return {status,score,issues,suggestions,explanation:String(parsed.explanation||''),inputTokens,outputTokens,cost:inputTokens*inputRate/1e6+outputTokens*outputRate/1e6,reviewVersion:REVIEW_VERSION};
}
export async function inspect(rel,sig){
 const absolute=path.join(INBOX,rel),result={id:crypto.randomUUID(),relativePath:rel,fileName:path.basename(rel),originalPath:absolute,status:'ERROR',score:null,issues:[],explanation:'',outputPath:'',width:0,height:0,megapixels:0,format:'',sizeBytes:sig.size,inputTokens:0,outputTokens:0,cost:0,signature:sig,reviewVersion:REVIEW_VERSION,checkedAt:new Date().toISOString()};
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
