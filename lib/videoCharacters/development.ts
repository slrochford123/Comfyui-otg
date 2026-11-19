import fs from 'node:fs/promises';
import sync from 'node:fs';
import path from 'node:path';
import {randomUUID,randomInt,createHash} from 'node:crypto';
import sharp from 'sharp';
import {RequestError} from '@/lib/requestError';
import {OTG_DATA_ROOT,safeSegment} from '@/lib/paths';
import {createCharacter,listCharacters,loadCharacter,updateExtractedCharacterVisuals} from '@/lib/characters/store';
import {mediaQueueEnabled,getMediaQueueJob} from '@/lib/workers/mediaGpuQueue';
import {queueExtractionView,queueExtractionBundle,queueExtractionMaster} from './routing';
import {approvedDefaultModel,characterReferenceIds,completeDevelopmentCard,developmentCardViews,DEVELOPMENT_VIEWS} from './contract';
import type {Workspace,Candidate,View,ApprovedView,CharacterReference} from './contract';

export const DEVELOPMENT_ACTIONS = ['rename-character','save-basic','create-model','retry-model','edit-model','approve-model','save-model','create-character-card','retry-card-view','edit-card-view','approve-card-view','approve-character-card','create-visual-refmod','upscale-development-view'] as const;
type Services={directory:string;persist:()=>Promise<unknown>;media:(file:string)=>Promise<{file:string}>};
function fail(message:string):never{throw new RequestError(message,409);}
function development(c:Candidate){return c.development||= {version:1};}
function ready(v:View|undefined):v is View & {file:string}{return !!v&&v.state==='ready'&&!!v.file;}
function currentModel(c:Candidate){return c.views.find(v=>v.id===c.development?.modelId);}
function editable(v:View|undefined){if(!v)fail('Choose an existing candidate first.');const job=v.job?getMediaQueueJob(v.job):null;if(job&&!['completed','failed','canceled'].includes(job.status)||!job&&v.job&&!['ready','attention','failed','canceled'].includes(v.state))fail('Wait for the original request to finish before retrying.');return v;}
function sourceRefs(w:Workspace,c:Candidate):CharacterReference[]{const ids=characterReferenceIds(c,w.candidates);if(ids.length<1||ids.length>4)fail('Choose one to four source images of the same character.');return ids.map(id=>{const item=w.candidates.find(x=>x.id===id);if(!item)fail('A selected source image is unavailable.');return {file:item.extractedFile||item.file,frame:item.extractedFrame||item.frame,role:c.referenceRoles?.[id]};});}
const identity='Preserve the exact apparent age, facial identity, hairstyle, skin tone, species, body proportions, clothing, distinguishing details and artistic style. A child must remain a child: do not invent adult facial or body proportions. Primary Face establishes facial identity and age; Clothing / Full Body establishes wardrobe and proportions. Blur is not evidence of new detail. Missing or unseen details are proposals requiring user approval. One character, one image, no collage, text, props or other people.';
function modelPrompt(c:Candidate,refs:CharacterReference[],correction='',edit=false){return `${refs.map((r,i)=>`<image${i+1}> is ${r.role||'complementary source evidence'} of the SAME character.`).join(' ')} Use ALL supplied source evidence together. Reconstruct a front-facing full-body default character, upright neutral standing pose, complete head and hair to feet visible, uncropped with comfortable margins, consistent outfit, plain light gray background. ${identity} ${c.description} ${edit?`<image${refs.length+1}> is the previous candidate to correct; the original source evidence remains authoritative.`:''} ${correction?'Requested corrections take precedence for the requested changes only. Keep all other identity and outfit details unchanged. '+correction:''}`;}
async function dispatch(w:Workspace,c:Candidate,v:View,s:Services){if(!mediaQueueEnabled())fail('The qualified GPU scheduler is unavailable.');c.views.push(v);await s.persist();try{await queueExtractionView(w,c,v,s.directory,s.persist);}catch(error){v.state='attention';v.error=(error as Error).message;}}
function archiveSheet(c:Candidate){if(c.bundle){c.priorBundles=[...(c.priorBundles||[]),c.bundle];delete c.bundle;}const d=development(c);if(d.sheet){d.priorSheets=[...(d.priorSheets||[]),d.sheet];delete d.sheet;}}
async function digest(file:string){const h=createHash('sha256');for await(const chunk of sync.createReadStream(file))h.update(chunk);return h.digest('hex');}
async function durable(w:Workspace,c:Candidate,view:ApprovedView,s:Services){const original=await s.media(view.file),dir=path.join(OTG_DATA_ROOT,'uploads','characters',safeSegment(w.libraryOwner!),c.id,'extracted');await fs.mkdir(dir,{recursive:true,mode:0o700});const file=path.join(dir,view.id+'-original.png');try{await fs.copyFile(original.file,file,sync.constants.COPYFILE_EXCL);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||await digest(original.file)!==await digest(file))throw error;}const size=await sharp(file).metadata();return {...view,path:file,width:size.width!,height:size.height!,sha256:await digest(file),sourceTime:w.frames.find(f=>f.id===view.frame)?.time};}
export async function saveDevelopmentCharacter(w:Workspace,c:Candidate,mode:'basic'|'model'|'card',s:Services){
 if(!w.libraryOwner)fail('This extraction needs an authenticated Characters library association.');
 const refs=sourceRefs(w,c),ids=characterReferenceIds(c,w.candidates),model=approvedDefaultModel(c);
 if(mode==='basic'&&ids.length!==1)fail('Save Character requires exactly one original image. Use Create Model for two to four source images.');
 if(mode!=='basic'&&!model)fail('Generate and approve the default model first.');
 if(mode==='card'&&!completeDevelopmentCard(c))fail('Approve all five views and the Character Card first.');
 const primary:ApprovedView=mode==='basic'?{id:ids[0],file:refs[0].file,frame:refs[0].frame,label:c.referenceRoles?.[ids[0]]||'Original extracted image',origin:'captured'}:{id:model!.id,file:model!.file!,label:'Front full body · approved default',origin:model!.master?'upscaled':'reconstructed'};
 const chosen:ApprovedView[]=mode==='card'?developmentCardViews(c).map(v=>({id:v!.id,file:v!.file!,label:v!.developmentRole==='model'?'Front full body':DEVELOPMENT_VIEWS.find(r=>r.id===v!.developmentRole)!.label,origin:v!.master?'upscaled':'reconstructed'})):[primary];
 const existing=loadCharacter(w.libraryOwner,c.globalId||c.id);if(existing&&existing.metadata?.extractionCandidateId!==c.id)fail('The saved Character identity does not match this extraction.');
 // A basic save never demotes an already approved model or removes its views.
 if(mode==='basic'&&existing){c.globalId=existing.id;development(c);return existing;}
 const description=mode==='basic'?c.description:`Approved character model for ${c.name}. Follow the approved default image for facial identity, apparent age, hairstyle, outfit, proportions and artistic style.${c.look?' Approved look: '+c.look+'.':''}`;
 const version=primary.id+':'+(mode==='card'?development(c).sheet!.id:'');
 if(existing?.metadata?.extractionVisualVersion===version&&existing.name===c.name&&existing.description===description&&existing.metadata.approvedLook===(c.look||'')){c.globalId=existing.id;return existing;}
 const images=await Promise.all(chosen.map(v=>durable(w,c,{...v,look:c.look},s)));
 const sources=await Promise.all([...new Set([c.id,...(c.mergedFrom||[])])].map(id=>{const item=w.candidates.find(x=>x.id===id)!;return durable(w,c,{id,file:item.extractedFile||item.file,frame:item.extractedFrame||item.frame,label:c.referenceRoles?.[id]||'Original source evidence',origin:'captured'},s);}));
 const sheet=mode==='card'?await durable(w,c,{id:development(c).sheet!.id,file:development(c).sheet!.file,label:'Five-view Character Card',origin:'reconstructed'},s):undefined;
 const metadata={...existing?.metadata,extractionCandidateId:c.id,extractionSourceDescription:c.description,extractionVisualVersion:version,sourceVideo:{workspace:w.id,name:w.sourceName,sha256:w.sourceSha256,job:w.productionId},extractionSources:sources,extractedViews:images,approvedLook:c.look||'',extractionDevelopment:{version:1,workspaceId:w.id,candidateId:c.id,modelId:model?.id,sheetId:sheet?.id},extractionSheet:sheet};
 const input={...(mode!=='card'?{characterCardPath:undefined,characterCardWorkflowImagePath:undefined}:{}),name:c.name,description,imagePath:images[0].path,originalSourceImagePath:existing?.originalSourceImagePath||sources[0].path,metadata,...(mode!=='basic'?{defaultCharacterImagePath:images[0].path,fullBodyImagePath:images[0].path}:{}),...(sheet?{characterCardPath:sheet.path,characterCardWorkflowImagePath:sheet.path}: {})};
 let record;try{record=existing?updateExtractedCharacterVisuals(w.libraryOwner,existing.id,c.id,input):createCharacter(w.libraryOwner,{id:c.id,...input,source:'video-character-extraction'});}catch(error){throw new RequestError((error as Error).message,409);}
 c.globalId=record.id;development(c);return record;
}

export async function actDevelopment(w:Workspace,data:Record<string,unknown>,s:Services){
 const action=String(data.action),c=w.candidates.find(c=>c.id===data.character);if(!c||(!c.selected&&action!=='rename-character'))fail('Select the character to develop.');
 if(action==='rename-character'){
  const name=String(data.name??'').replace(/\s+/g,' ').trim();
  if(!name||name.length>96)throw new RequestError('Enter a name up to 96 characters.',400);
  const owner=w.libraryOwner||w.owner,existing=loadCharacter(owner,c.globalId||c.id);
  if((c.globalId&&!existing)||(existing&&existing.metadata?.extractionCandidateId!==c.id))fail('The saved character does not match this extraction. Reopen the character before renaming.');
  const duplicate=listCharacters(owner).find(item=>item.id!==existing?.id&&item.name.replace(/\s+/g,' ').trim().toLocaleLowerCase()===name.toLocaleLowerCase());
  if(duplicate)throw new RequestError(`A character named "${name}" already exists. Choose another name, such as "${name} – Young".`,409);
  if(existing&&existing.name!==name)updateExtractedCharacterVisuals(owner,existing.id,c.id,{name,imagePath:existing.imagePath,metadata:existing.metadata});
  c.name=name;c.nameSavedAt||=new Date().toISOString();if(existing)c.globalId=existing.id;
  w.message='Character name saved.';return;
 }
 const d=development(c),correction=String(data.correction||'').trim();if(correction.length>1000)fail('Use a correction up to 1000 characters.');
 if(data.look!==undefined)c.look=String(data.look).trim().slice(0,96);
 if(action==='save-basic'){await saveDevelopmentCharacter(w,c,'basic',s);w.message='Original image saved to Characters. You can create a default model whenever you choose.';}
 else if(['create-model','retry-model','edit-model'].includes(action)){
  if(!mediaQueueEnabled())fail('The qualified GPU scheduler is unavailable.');
  const old=action==='create-model'?undefined:editable(currentModel(c));
  const refs=old?.references?.filter(r=>!r.role?.toString().includes('Previous candidate'))||sourceRefs(w,c);
  // Store the original evidence separately from the edit candidate for a future Retry.
  const original=old?.originalReferences||refs;
  if(action==='edit-model'&&(!ready(old)||!correction))fail('Choose a ready model and describe the correction.');
  const requestedCorrection=action==='retry-model'?(old?.correction||''):correction;
  const references=action==='edit-model'?[...original,{file:old!.file!,frame:old!.id}]:original;
  archiveSheet(c);d.approvedModelId=undefined;
  const view:View={id:randomUUID(),developmentRole:'model',angle:'Default front full body',state:'preparing',seed:randomInt(0,2**48-1),references,originalReferences:original,correction:requestedCorrection,prompt:modelPrompt(c,original,requestedCorrection,action==='edit-model')};
  d.modelId=view.id;await dispatch(w,c,view,s);w.message='Review the proposed default model against the original source images before approving.';
 }else if(action==='approve-model'){
  const v=currentModel(c);if(!ready(v))fail('Wait for a complete default model, then review it.');v.approvedAt=new Date().toISOString();d.approvedModelId=v.id;w.message='Default model approved. Save or update the character, then create its Character Card.';
 }else if(action==='save-model'){await saveDevelopmentCharacter(w,c,'model',s);w.message='Approved default model saved to the same Characters record.';}
 else if(action==='create-character-card'){
  const model=approvedDefaultModel(c);if(!model)fail('Generate and approve the default model before creating a Character Card.');
  if(c.views.some(v=>v.modelId===model.id&&v.developmentRole!=='model'))fail('This model already has card views. Retry or edit an individual view instead.');
  if(!mediaQueueEnabled())fail('The qualified GPU scheduler is unavailable.');
  await saveDevelopmentCharacter(w,c,'model',s);archiveSheet(c);
  for(const role of DEVELOPMENT_VIEWS){const v:View={id:randomUUID(),developmentRole:role.id,modelId:model.id,angle:role.label,state:'preparing',seed:randomInt(0,2**48-1),references:[{file:model.file!,frame:model.id}],prompt:`<image1> is the approved default model. ${role.instruction} ${identity} Use a plain light gray backdrop. The approved default image is authoritative for the current outfit; do not use historical source descriptions to change it.`};await dispatch(w,c,v,s);}
  w.message='Four additional views requested. Review and approve each view; the approved default supplies the front.';
 }else if(action==='retry-card-view'||action==='edit-card-view'){
  const model=approvedDefaultModel(c),old=editable(c.views.find(v=>v.id===data.view));
  if(!model||old.modelId!==model.id||!DEVELOPMENT_VIEWS.some(r=>r.id===old.developmentRole))fail('Choose a view belonging to the approved default model.');
  if(action==='edit-card-view'&&(!ready(old)||!correction))fail('Choose a ready view and describe its correction.');
  if(!mediaQueueEnabled())fail('The qualified GPU scheduler is unavailable.');archiveSheet(c);
  const role=DEVELOPMENT_VIEWS.find(r=>r.id===old.developmentRole)!;
  const references=action==='edit-card-view'?[{file:model.file!,frame:model.id},{file:old.file!,frame:old.id}]:[{file:model.file!,frame:model.id}];
  const v:View={id:randomUUID(),developmentRole:role.id,modelId:model.id,angle:role.label,state:'preparing',seed:randomInt(0,2**48-1),references,prompt:`<image1> is the approved default character. ${role.instruction} ${identity} ${action==='edit-card-view'?'<image2> is the previous view to correct.':''} ${correction}`};
  // Prior versions stay on disk and in history, but only the newest view can be approved for this card.
  c.priorViews=[...(c.priorViews||[]),old];c.views=c.views.filter(v=>v.id!==old.id);await dispatch(w,c,v,s);
 }else if(action==='approve-card-view'){
  const model=approvedDefaultModel(c),v=c.views.find(v=>v.id===data.view);if(!model||!ready(v)||v.modelId!==model.id||!DEVELOPMENT_VIEWS.some(r=>r.id===v.developmentRole))fail('Review a ready view of the approved model first.');v.approvedAt=new Date().toISOString();
 }else if(action==='approve-character-card'){
  const views=developmentCardViews(c);if(views.length!==5||views.some(v=>!ready(v)||!v.approvedAt))fail('Approve the default model and all four additional views first.');
  if(!completeDevelopmentCard(c)){
   archiveSheet(c);const id=randomUUID(),file=id+'.png',labels=['Front full body','Face close-up','Left view','Right view','Back view'];
   const tiles=await Promise.all(views.map(async(v,index)=>({input:await sharp((await s.media(v!.file!)).file).resize(480,840,{fit:'contain',background:'#ededf0'}).png().toBuffer(),left:index*480,top:0})));
   const captions=Buffer.from(`<svg width="2400" height="64">${labels.map((label,i)=>`<text x="${i*480+240}" y="40" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#16161a">${label}</text>`).join('')}</svg>`);
   await sharp({create:{width:2400,height:904,channels:3,background:'#ededf0'}}).composite([...tiles,{input:captions,left:0,top:840}]).png().toFile(path.join(s.directory,file));
   d.sheet={id,file,modelId:views[0]!.id,viewIds:views.map(v=>v!.id),approvedAt:new Date().toISOString()};
  }
  c.approvedViews=views.map(v=>({id:v!.id,file:v!.file!,label:v!.angle,origin:v!.master?'upscaled':'reconstructed'}));c.approved=true;
  await saveDevelopmentCharacter(w,c,'card',s);w.message='Approved five-view Character Card saved. The separate images remain available; visual RefMod creation is optional.';
 }else if(action==='create-visual-refmod'){
  if(!completeDevelopmentCard(c)||!c.globalId)fail('Complete and approve the five-view Character Card before creating a RefMod.');
  if(!mediaQueueEnabled())fail('The qualified GPU scheduler is unavailable.');
  if(c.bundle?.state==='ready')return;
  if(c.bundle&&!['failed','canceled','attention'].includes(c.bundle.state))fail('Wait for the existing RefMod request.');
  if(c.bundle)c.priorBundles=[...(c.priorBundles||[]),c.bundle];
  c.approvedViews=developmentCardViews(c).map(v=>({id:v!.id,file:v!.file!,label:v!.angle,origin:v!.master?'upscaled':'reconstructed'}));
  await queueExtractionBundle(w,c,s.directory,s.persist,undefined,true);w.message='Visual-only RefMod requested from all five approved individual images.';
 }else if(action==='upscale-development-view'){
  const old=editable(c.views.find(v=>v.id===data.view));if(!ready(old)||!old.developmentRole||old.master)fail('Choose a ready model or card view to prepare at 1080p.');
  if(!mediaQueueEnabled())fail('The qualified GPU scheduler is unavailable.');archiveSheet(c);
  const v:View={...old,id:randomUUID(),job:undefined,file:undefined,master:true,sourceViewId:old.id,state:'preparing',approvedAt:undefined};
  if(old.developmentRole==='model'){d.modelId=v.id;d.approvedModelId=undefined;}else{c.priorViews=[...(c.priorViews||[]),old];c.views=c.views.filter(v=>v.id!==old.id);}
  c.views.push(v);await s.persist();try{await queueExtractionMaster(w,v,(await s.media(old.file!)).file,s.directory,s.persist);}catch(error){v.state='attention';v.error=(error as Error).message;}
  w.message='1080p derivative requested. Review and approve it before replacing the current model or view.';
 }
}
