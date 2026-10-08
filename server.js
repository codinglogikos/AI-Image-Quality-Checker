import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import {REPORT,readJson,stats} from './engine.js';
import {prepare,start,cancel,status,requestStop} from './web-runner.js';

const app=express();
app.use(express.json({limit:'8kb'}));
app.use(express.static(path.resolve('public')));
app.post('/api/check/estimate',async(req,res)=>{try{res.json(await prepare())}catch(e){res.status(409).json({error:e.message})}});
app.post('/api/check/confirm',async(req,res)=>{try{res.json(await start(req.body?.token))}catch(e){res.status(409).json({error:e.message})}});
app.post('/api/check/cancel',(req,res)=>{res.json({cancelled:cancel(req.body?.token)})});
app.post('/api/check/stop',(req,res)=>{res.json({stopping:requestStop()})});
app.get('/api/check/status',(req,res)=>{const s=status();res.json({state:s.state,processed:s.processed,total:s.total,currentFile:s.currentFile,error:s.error})});
const getReport=async()=>await readJson(REPORT,{results:[],updatedAt:null});
app.get('/api/report',async(req,res)=>{
 try{const report=await getReport();res.json({...report,summary:stats(report.results)})}
 catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/thumbnail/:id',async(req,res)=>{
 try{
  const report=await getReport();
  const item=report.results.find(r=>r.id===req.params.id&&['FAIL','REVIEW'].includes(r.status));
  if(!item||!item.outputPath)return res.sendStatus(404);
  const root=path.resolve(item.status==='FAIL'?'Defected':'Review');
  const absolute=path.resolve(item.outputPath);
  if(!absolute.startsWith(root+path.sep))return res.sendStatus(403);
  const thumb=await sharp(absolute).rotate().resize({width:360,height:240,fit:'inside'}).jpeg({quality:76}).toBuffer();
  res.type('jpeg').send(thumb);
 }catch(e){res.status(404).json({error:'Thumbnail unavailable'})}
});
app.get('/api/report.pdf',async(req,res)=>{
 try{
  const report=await getReport(),summary=stats(report.results);
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="Image_Quality_Report.pdf"');
  const doc=new PDFDocument({size:'A4',margin:44,bufferPages:true});
  doc.pipe(res);
  doc.fontSize(20).text('AI Image Quality Report',{continued:false});
  doc.moveDown(.5).fontSize(10).fillColor('#444444').text('Generated: '+new Date().toLocaleString('en-US'));
  doc.text('PASS: '+summary.pass+'   FAIL: '+summary.fail+'   REVIEW: '+summary.review+'   ERROR: '+summary.error);
  doc.text('Total inspected: '+summary.total+'   Estimated API usage: $'+summary.cost.toFixed(4));
  doc.moveDown(1).fillColor('#111111');
  for(const r of report.results){
   if(doc.y>690)doc.addPage();
   doc.fontSize(11).font('Helvetica-Bold').text(r.fileName+' — '+r.status,{width:510});
   doc.font('Helvetica').fontSize(9).text('Original: '+r.relativePath,{width:510});
   doc.text('Score: '+(r.score??'N/A')+' | '+r.width+' x '+r.height+' | '+r.megapixels+' MP');
   doc.text('Issues: '+(r.issues?.join('; ')||'None'),{width:510});
   doc.text('Explanation: '+(r.explanation||'None'),{width:510});
   if(r.suggestions?.length)doc.text('Suggested fixes: '+r.suggestions.join('; '),{width:510});
   if(['FAIL','REVIEW'].includes(r.status)&&r.outputPath){
    try{
     const root=path.resolve(r.status==='FAIL'?'Defected':'Review');
     const p=path.resolve(r.outputPath);
     if(p.startsWith(root+path.sep)){
      const thumbnail=await sharp(p).rotate().resize({width:180,height:110,fit:'inside'}).jpeg({quality:70}).toBuffer();
      if(doc.y>650)doc.addPage();
      doc.image(thumbnail,{fit:[180,110]});
      doc.moveDown(.5);
     }
    }catch{}
   }
   doc.moveDown(.8);
  }
  doc.end();
 }catch(e){if(!res.headersSent)res.status(500).json({error:e.message});else res.end()}
});
app.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Report dashboard: http://127.0.0.1:'+(process.env.PORT||3000)));
