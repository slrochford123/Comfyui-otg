import { extractionPlayerSource, type ExtractionPlayerSource } from "@/lib/videoCharacters/playerSource";
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {NextResponse} from 'next/server';
import {characterDevelopmentRoute as labRoute,boundedJson,privateHeaders} from '@/lib/experiments/http';
import {mediaFileResponse,contentTypeForMedia} from '@/lib/mediaResponse';
import {inspectVideoSource,videoSourceChoice} from '@/lib/videoCharacters/videoSources';
import {parseRange} from '@/lib/experiments/range';
import {requireStorageHeadroom} from '@/lib/storageAdmission';
import {OTG_DATA_ROOT} from '@/lib/paths';
import {RequestError} from '@/lib/requestError';
import {getOwnerContext} from '@/lib/ownerKey';
import {MAX_EXTRACTION_VIDEO_BYTES} from '@/lib/videoCharacters/limits';
import {folder,list,read,locked,refresh,act,present,sources,newWorkspace,mediaFile} from '@/lib/videoCharacters/store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=labRoute(async(req,owner)=>{
 const query=req.nextUrl.searchParams;
 if (query.has('playerJob')) {
  await extractionPlayerSource(req,{engine:query.get('engine') as ExtractionPlayerSource['engine'],jobId:query.get('playerJob') || '',fileName:query.get('fileName') || undefined});
  return NextResponse.json({ok:true});
 }
 const wid=query.get('id');
 if (!wid) {
  const catalog = await sources(req, owner);
  const sourceKey = req.nextUrl.searchParams.get('source');
  if (sourceKey) {
   const source = catalog.find(item => item.key === sourceKey);
   if (!source) throw new RequestError('Video not found for this TEST account.', 404);
   if (req.nextUrl.searchParams.get('preview') === '1') {
    const stat = await fsp.lstat(source.file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new RequestError('Video not found.',404);
    return mediaFileResponse(req, source.file, {contentType: source.key.startsWith('lab:') ? 'video/mp4' : contentTypeForMedia(source.file), method: req.method === 'HEAD' ? 'HEAD' : 'GET'});
   }
   const info = await inspectVideoSource(owner, source);
   if (req.nextUrl.searchParams.get('poster') === '1') return mediaFileResponse(req, info.poster, {contentType: 'image/webp', method: req.method === 'HEAD' ? 'HEAD' : 'GET'});
   return NextResponse.json({ok:true,clip:{clipId:info.clipId,duration:info.duration}});
  }
  catalog.sort((a,b) => b.createdAt-a.createdAt || a.key.localeCompare(b.key));
  return NextResponse.json({ok:true,workspaces:await list(owner),sources:catalog.map(videoSourceChoice)});
 }
 return locked(owner,wid,async()=>{
  const w=await refresh(await read(owner,wid)),name=req.nextUrl.searchParams.get('file');
  if(!name)return NextResponse.json({ok:true,workspace:present(w)});
  const {file,stat}=await mediaFile(w,name);let range;try{range=parseRange(req.headers.get('range'),stat.size);}catch{return new Response(null,{status:416,headers:{...privateHeaders,'Content-Range':`bytes */${stat.size}`}});}
  const headers=new Headers({...privateHeaders,'Content-Type':name.endsWith('.png')?'image/png':name.endsWith('.mp4')?'video/mp4':name.endsWith('.safetensors')?'application/octet-stream':name.endsWith('.audio')?'application/octet-stream':'audio/wav','Content-Length':String(range?range.end-range.start+1:stat.size),'Accept-Ranges':'bytes','Content-Security-Policy':"default-src 'none'; sandbox"});
  if(name.endsWith('.safetensors'))headers.set('Content-Disposition',`attachment; filename="${name}"`);
  if(range)headers.set('Content-Range',`bytes ${range.start}-${range.end}/${stat.size}`);
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);if(req.method==='HEAD'){fs.closeSync(fd);return new Response(null,{headers,status:range?206:200});}
  return new Response(Readable.toWeb(fs.createReadStream(file,{fd,autoClose:true,...(range||{})})) as ReadableStream,{headers,status:range?206:200});
 });
});
export const HEAD=GET;
export const POST=labRoute(async(req,owner)=>{
 if(req.nextUrl.searchParams.get('upload')==='1'){
  if(!req.body||!['video/mp4','application/octet-stream'].includes(req.headers.get('content-type')||''))throw new RequestError('Upload an MP4 video.',415);
  requireStorageHeadroom(OTG_DATA_ROOT,512*1024**2);
  const root=folder(owner);await fsp.mkdir(root,{recursive:true,mode:0o700});const temporary=path.join(root,randomUUID()+'.upload');let size=0;
  try{await pipeline(Readable.fromWeb(req.body as import('node:stream/web').ReadableStream),new Transform({transform(chunk,_encoding,done){size+=chunk.length;done(size>MAX_EXTRACTION_VIDEO_BYTES?new RequestError('Maximum upload is 256 MiB.',413):null,chunk);}}),fs.createWriteStream(temporary,{flags:'wx',mode:0o600}),{signal:req.signal});const w=await newWorkspace(owner,req.nextUrl.searchParams.get('name')||'Uploaded MP4',temporary,'');w.libraryOwner=(await getOwnerContext(req)).ownerKey;const {write}=await import('@/lib/videoCharacters/store');await write(w);return NextResponse.json({ok:true,workspace:present(w)});}finally{await fsp.rm(temporary,{force:true});}
 }
 const data=await boundedJson(req);
 if(data.action==='new-player'){
  const source=await extractionPlayerSource(req,data as unknown as ExtractionPlayerSource);
  const receipt='text-result:'+String(data.engine)+':'+String(data.jobId);
  const workspace=await locked(owner,String(data.requestId || ''),async()=>{
    try {
      const existing=await read(owner,String(data.requestId));
      if(existing.productionId!==receipt || existing.libraryOwner!==source.owner) throw new RequestError('Extraction request already belongs to another clip.',409);
      return existing;
    } catch(error) {
      if(!(error instanceof RequestError) || error.status!==404) throw error;
    }
    return newWorkspace(owner,source.name,source.path,receipt,[],String(data.requestId),source.owner);
  });
  return NextResponse.json({ok:true,workspace:present(workspace)});
 }
 if(data.action==='new'){const source=(await sources(req,owner)).find(s=>s.key===data.source);if(!source)throw new RequestError('Select a video owned by this TEST account.',404);const w=await newWorkspace(owner,source.name,source.file,source.productionId,source.refs);w.libraryOwner=(await getOwnerContext(req)).ownerKey;const {write}=await import('@/lib/videoCharacters/store');await write(w);return NextResponse.json({ok:true,workspace:present(w)});}
 const wid=String(data.id||'');return locked(owner,wid,async()=>NextResponse.json({ok:true,workspace:present(await act(await read(owner,wid),data))}));
});
