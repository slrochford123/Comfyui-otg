import {describe,expect,it} from "vitest";
import {resolveTrainingView} from "@/app/app/components/VoiceCharactersPanel";
import type {VoiceCharacterPipelineJob,VoiceCharacterRecord} from "@/lib/characters/voiceCharactersClient";
const character={id:"qa",name:"Synthetic QA"} as VoiceCharacterRecord;
const job=(stage:string,progress:number,action="generate_training_dataset")=>({jobId:"qa-job",action,characterId:"qa",status:"running",progress,message:"",input:{},result:{currentStage:stage},createdAt:"",updatedAt:""}) as VoiceCharacterPipelineJob;
describe("Voice progress uses actual worker stage",()=>{
  it("shows real generating speech even at five percent",()=>expect(resolveTrainingView(character,[job("generating",5)]).stageIndex).toBe(1));
  it("does not falsely declare validation before generation finishes",()=>expect(resolveTrainingView(character,[job("generating",90)]).stageIndex).toBe(1));
  it("keeps preparation accurately labeled before generation",()=>expect(resolveTrainingView(character,[job("claimed",5)]).stageIndex).toBe(0));
  it("shows dataset validation rather than generation",()=>expect(resolveTrainingView(character,[job("validating",90)]).stageIndex).toBe(2));
  it("keeps actual feature extraction distinct from training",()=>expect(resolveTrainingView(character,[job("extract",30,"start_applio_training")]).stageIndex).toBe(3));
  const trained={...character,characterVoiceProfile:{status:"trained",trainingAdapter:"applio_real_training",modelPath:"qa/model.pth",indexPath:"qa/model.index",trainingCompletedAt:"2026-10-22T09:36:57Z"}} as VoiceCharacterRecord;
  it("does not resurrect an old dataset failure after a new model succeeds",()=>{
    const failed={...job("waiting_for_vram",12),status:"failed",updatedAt:"2026-10-21T18:00:00Z",error:"Old VRAM shortage"};
    expect(resolveTrainingView(trained,[failed])).toMatchObject({status:"completed",progress:100});
  });
  it("does not resurrect an old training failure after a new model succeeds",()=>{
    const failed={...job("train",70,"start_applio_training"),status:"failed",updatedAt:"2026-10-21T18:00:00Z",error:"Old failure"};
    expect(resolveTrainingView(trained,[failed])).toMatchObject({status:"completed",progress:100});
  });
  it("still reports a later failed retraining attempt without losing the old artifact",()=>{
    const failed={...job("train",70,"start_applio_training"),status:"failed",updatedAt:"2026-10-22T10:00:00Z",error:"New retry failed"};
    expect(resolveTrainingView(trained,[failed])).toMatchObject({status:"failed",message:"New retry failed"});
  });
});
