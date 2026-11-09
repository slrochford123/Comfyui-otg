import {afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const mocks=vi.hoisted(()=>({create:vi.fn(),start:vi.fn(),get:vi.fn(),cancel:vi.fn(),smart:vi.fn(),sidecar:vi.fn()}));
vi.mock('@/lib/h3DirectJobs',async original=>({...await original<object>(),createH3DirectJob:mocks.create,startH3DirectJob:mocks.start,getH3DirectJob:mocks.get,cancelH3DirectJob:mocks.cancel,ensureH3DirectJobRunner:vi.fn()}));
vi.mock('@/lib/h3SmartReferencesServer',()=>({characterRefSelectionBackend:async()=> 'rtx3090',makeH3SmartReferenceInput:mocks.smart}));
vi.mock('@/lib/productionStudio/clipReferenceBackend',()=>({selectClipReferenceBackend:async()=> 'rtx3090'}));
vi.mock('@/lib/h3SpecialModes/refModCreation',()=>({readH3RefModSidecar:mocks.sidecar}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-graph-'));vi.stubEnv('OTG_DATA_ROOT',root);vi.stubEnv('OTG_DATA_DIR',root);vi.stubEnv('OTG_STUDIO_WORKER_DISABLED','1');
const {createStudioStore}=await import('@/lib/productionStudio/store'),{snapshotFile}=await import('@/lib/productionStudio/media'),{allShots,DEFAULT_SHOT}=await import('@/lib/productionStudio/model'),{startVideo,pollVideo}=await import('@/lib/productionStudio/generation');
const s=createStudioStore(root+'/store');
beforeEach(()=>{vi.clearAllMocks();mocks.create.mockImplementation(async(_owner,input)=>({id:'mock-child',input}));mocks.smart.mockImplementation(async selection=>({...selection,refMods:selection.refMods,images:[]}));});
afterAll(()=>{s.db.close();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
function fixture(kind:'preview'|'regenerate'='preview'){
  const p=s.create('owner','Coffee shop'),shot=allShots(p)[0];shot.description='Maya greets Leo';shot.dialogue=[{id:'line',speaker:'Maya',line:'Hello, Leo.',delivery:'Warm',emotion:'Happy'}];
  p.shots[shot.id]={...DEFAULT_SHOT,seed:4242};
  return{p,shot,job:s.enqueue('owner',p.id,kind,{snapshot:p,shotId:shot.id},'key-'+p.id)};
}
describe('Studio H3 adapter without GPU submission',()=>{
  it.each(['preview','regenerate'] as const)('submits the exact edited video prompt for %s and rejects an explicitly cleared prompt',async kind=>{
    const f=fixture(kind);f.p.shots[f.shot.id].videoPromptOverride='My complete replacement.\nNo old instructions.';await startVideo(s,'owner',f.job);
    expect(mocks.create.mock.calls[0][1].prompt).toBe('My complete replacement.\nNo old instructions.');
    f.p.shots[f.shot.id].videoPromptOverride='';await expect(startVideo(s,'owner',f.job)).rejects.toThrow('empty');expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('keeps T2V planning images out of inputs and makes the R2V first frame explicit, with native duration rounding',async()=>{
    const f=fixture(),file=root+'/storyboard.png';fs.writeFileSync(file,'fixture');const a=await snapshotFile(s,'owner',f.p.id,file,'Storyboard','image');
    f.p.shots[f.shot.id]={...DEFAULT_SHOT,storyboardId:a.id,storyboardApproved:true,referenceIds:[a.id]};f.shot.plannedDurationSeconds=3;f.shot.requestedDurationSeconds=5;f.shot.generationApproach='text-to-video';await startVideo(s,'owner',f.job);
    expect(mocks.create.mock.calls.at(-1)![1]).toMatchObject({firstImage:null,lastImage:null,images:[],durationSeconds:5});
    f.shot.generationApproach='reference-to-video';await startVideo(s,'owner',f.job);expect(mocks.create.mock.calls.at(-1)![1].firstImage).toBeNull();expect(mocks.create.mock.calls.at(-1)![1].images).toHaveLength(1);
    f.p.shots[f.shot.id].useStoryboardFirstFrame=true;f.shot.plannedDurationSeconds=6;f.shot.requestedDurationSeconds=10;await startVideo(s,'owner',f.job);expect(mocks.create.mock.calls.at(-1)![1].firstImage.path).toBe(s.asset('owner',f.p.id,a.id).path);expect(mocks.create.mock.calls.at(-1)![1].durationSeconds).toBe(10);
    f.shot.plannedDurationSeconds=10.1;await expect(startVideo(s,'owner',f.job)).rejects.toThrow();expect(mocks.create).toHaveBeenCalledTimes(3);
  });
  it('uses the qualified shared Scene Hunter input and retains scene/dialogue direction',async()=>{
    const f=fixture();f.p.plan.acts[0].scenes[0].location='Coffee shop';await startVideo(s,'owner',f.job);
    const input=mocks.create.mock.calls[0][1];expect(input.quality).toBe('sh');expect(input.seed).toBe(4242);expect(input.h3Settings.checkpointMode).toBe('standard');expect(input.h3Settings.renderMode).toBe('native');expect(input.prompt).toContain('Hello, Leo.');expect(input.prompt).toContain('Coffee shop');expect(mocks.start).toHaveBeenCalledTimes(1);expect(s.job('owner',f.job.id).backendId).toBe('mock-child');
  });
  it('higher quality creates a separate generation request, not an upscale',async()=>{const f=fixture('regenerate');await startVideo(s,'owner',f.job);expect(mocks.create.mock.calls[0][1].quality).toBe('hq');expect(f.shot.takes).toHaveLength(0);});
  it('passes first and last frames into image-to-video without substituting models',async()=>{const f=fixture();const file=root+'/frame.png';fs.writeFileSync(file,'fixture');const image=await snapshotFile(s,'owner',f.p.id,file,'Frame','image');f.p.shots[f.shot.id].firstImageId=image.id;f.p.shots[f.shot.id].lastImageId=image.id;f.shot.generationApproach='image-to-video';f.p.shots[f.shot.id].model='singularity-v1.3';await startVideo(s,'owner',f.job);const i=mocks.create.mock.calls[0][1];expect(i.mode).toBe('h3-image-to-video');expect(i.firstImage.path).toBe(i.lastImage.path);expect(i.h3Settings.checkpointMode).toBe('singularity-v1.3');});
  it('uses the pinned actual RefMod once with no duplicate ordinary character image',async()=>{
    const f=fixture(),file=root+'/bundle.safetensors',image=root+'/character.png';fs.writeFileSync(file,'bundle version one');fs.writeFileSync(image,'image fixture');
    f.shot.generationApproach='reference-to-video';
    const bundle=await snapshotFile(s,'owner',f.p.id,file,'Identity','refmod',{libraryName:'pinned-maya'}),character=await snapshotFile(s,'owner',f.p.id,image,'Maya','character',{bundleId:bundle.id});f.p.shots[f.shot.id].referenceIds=[character.id];mocks.sidecar.mockReturnValue({savedPath:file,ownerKey:'owner',libraryName:'pinned-maya'});await startVideo(s,'owner',f.job);
    const input=mocks.create.mock.calls[0][1];expect(input.smartReferences.refMods).toHaveLength(1);expect(input.images).toHaveLength(0);expect(input.targetBackend).toBe('rtx3090');expect(input.smartReferences.refMods[0].name).toBe('pinned-maya');
    fs.writeFileSync(file,'replaced original');await expect(startVideo(s,'owner',f.job)).rejects.toThrow('was changed');expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('rejects native square instead of silently changing orientation',async()=>{const f=fixture();f.p.brief.aspect='square';await expect(startVideo(s,'owner',f.job)).rejects.toThrow('not qualified');expect(mocks.create).not.toHaveBeenCalled();});
  it('does not call an uncertain backend cancellation completed',async()=>{const f=fixture();f.job.backendId='original-child';mocks.get.mockResolvedValue({id:'original-child',status:'running'});mocks.cancel.mockRejectedValue(Error('No per-job cancellation'));await expect(pollVideo(s,'owner',f.job,()=>true)).rejects.toThrow('unconfirmed');expect(mocks.create).not.toHaveBeenCalled();});
});
