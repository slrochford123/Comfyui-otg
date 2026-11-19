import {NextResponse} from 'next/server';
import {characterDevelopmentRoute as labRoute,boundedJson} from '@/lib/experiments/http';
import {RequestError} from '@/lib/requestError';
import {requireSessionUser} from '@/lib/sessionUser';
import {enforceRequestLimit} from '@/lib/auth/requestLimits';
import {mediaFileResponse,contentTypeForMedia} from '@/lib/mediaResponse';
import {folder,read,write,locked,present} from '@/lib/videoCharacters/store';
import {characterVoiceOptions,currentCharacterVoice,generateInlineCharacterVoice,inlineVoiceAudio,useInlineCharacterVoice} from '@/lib/videoCharacters/voice';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=labRoute(async(req,owner)=>{
 const q=req.nextUrl.searchParams,wid=q.get('id')||'',cid=q.get('character')||'';
 return locked(owner,wid,async()=>{
  const w=await read(owner,wid),dir=folder(owner,wid);
  if(q.has('audio')){const file=inlineVoiceAudio(w,dir,cid,q.get('audition')||'',q.get('audio')||'');return mediaFileResponse(req,file,{contentType:contentTypeForMedia(file),method:req.method==='HEAD'?'HEAD':'GET'});}
  const audition=currentCharacterVoice(w,dir,cid);
  const options=q.get('options')==='1'?await characterVoiceOptions((await requireSessionUser(req)).accountId,q.get('provider')==='qwen3'?'qwen3':'elevenlabs'):undefined;
  return NextResponse.json({ok:true,audition,options});
 });
});
export const HEAD=GET;
export const POST=labRoute(async(req,owner)=>{
 enforceRequestLimit('ai-utility',owner,30,60_000);
 const body=await boundedJson(req),wid=String(body.id||''),cid=String(body.character||'');
 return locked(owner,wid,async()=>{
  const w=await read(owner,wid),dir=folder(owner,wid);
  if(w.revision!==body.revision)throw new RequestError('Character workspace changed. Your description is kept. Refresh and try again.',409);
  if(w.state==='analyzing'||w.candidates.some(c=>c.views.some(v=>['queued','dispatching','running','preparing'].includes(v.state))||c.bundle&&['queued','dispatching','running','preparing'].includes(c.bundle.state)))throw new RequestError('Wait for current character processing. Your saved work is preserved.',409);
  if(body.action==='generate')return NextResponse.json({ok:true,audition:await generateInlineCharacterVoice(w,dir,cid,body,(await requireSessionUser(req)).accountId)});
  if(body.action==='use'){const audition=await useInlineCharacterVoice(w,dir,cid,body);await write(w);return NextResponse.json({ok:true,audition,workspace:present(w)});}
  throw new RequestError('Unknown voice action.',400);
 });
});
