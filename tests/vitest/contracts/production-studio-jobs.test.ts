import {afterAll,describe,it,expect,vi} from 'vitest';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {normalizeStoryProductionPlan} from '@/lib/storyCreator/productionPlan';
vi.mock('@/lib/storyCreator/mediaExecution',()=>({executeStoryMedia:vi.fn(),refreshStoryMedia:async(record:unknown)=>record,storyMediaFile:vi.fn(),cancelStoryMedia:vi.fn()}));
vi.mock('@/lib/storyCreator/mediaStore',()=>({getStoryMedia:()=>({status:'unknown',error:'Connection ended'}),createStoryMedia:vi.fn(),updateStoryMedia:vi.fn(),claimStoryMedia:vi.fn()}));
vi.mock('@/lib/storyCreator/mediaVoice',()=>({generateStoryVoice:vi.fn(),storyVoiceActive:()=>false}));
vi.mock('@/lib/productionStudio/planning',()=>({runAssistant:vi.fn(),ensureStoryLink:vi.fn()}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-jobs-'));vi.stubEnv('OTG_DATA_ROOT',root);vi.stubEnv('OTG_DATA_DIR',root);vi.stubEnv('OTG_STUDIO_WORKER_DISABLED','1');
const {createStudioStore}=await import('@/lib/productionStudio/store'),{enqueueStudioJob,executeStudioJob}=await import('@/lib/productionStudio/jobs');
const s=createStudioStore(root+'/store');afterAll(()=>{s.db.close();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
describe('Production studio approval and ambiguous submissions',()=>{
  it('requires explicit action approval before scheduling AI',async()=>{const p=s.create('alice','AI budget');await expect(enqueueStudioJob(s,'alice',p.id,{revision:p.revision,kind:'assistant',message:'Plan',requestKey:'0123456789abcdef'},'')).rejects.toThrow('Confirm');expect(s.jobs('alice',p.id)).toHaveLength(0);});
  it('does not turn an unknown image submission into a safely retryable failure',async()=>{
    let p=s.create('alice','Uncertain image');
    expect(()=>s.enqueue('alice',p.id,'storyboard',{snapshot:p,storyId:'fixture'},'invalid-shot-key')).toThrow('shot is missing');
    p=s.internalUpdate('alice',p.id,p=>{p.plan=normalizeStoryProductionPlan({status:'approved',acts:[{scenes:[{shots:[{id:'shot',requestedDurationSeconds:5}]}]}]},p.id);});
    let j=s.enqueue('alice',p.id,'storyboard',{snapshot:p,shotId:'shot',storyId:'fixture'},'uncertain-image-key');
    j=s.updateJob('alice',j.id,{status:'running',backendId:'story:original'});await executeStudioJob(s,'alice',j);
    expect(s.job('alice',j.id).status).toBe('attention');expect(s.job('alice',j.id).message).toContain('unconfirmed');
  });
  it('rejects a stale approved action without scheduling a new job',async()=>{const p=s.create('alice','Stale approval');s.mutate('alice',p.id,p.revision,{type:'brief',patch:{style:'Anime'}});await expect(enqueueStudioJob(s,'alice',p.id,{revision:p.revision,approved:true,kind:'assistant',message:'Plan',requestKey:'0123456789abcdef'},'')).rejects.toThrow('latest production');expect(s.jobs('alice',p.id)).toHaveLength(0);});
});
