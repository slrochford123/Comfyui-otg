import {getStoryMedia} from "./mediaStore";
import {storyMediaFile} from "./mediaExecution";
import {allShots,DEFAULT_SHOT} from "@/lib/productionStudio/model";
import {type StudioStore,StudioError} from "@/lib/productionStudio/store";
import {probe,snapshotFile} from "@/lib/productionStudio/media";

/** Copy an owned completed clip into a resumable production; never approve or render it. */
export async function sendStoryVideoToProduction(s:StudioStore,owner:string,storyProject:string,id:string) {
  const record=getStoryMedia(owner,storyProject,id);
  if(record.status!=="ready"||record.command.operation!=="video")throw new StudioError("Choose a completed Story video.",400);
  const source=storyMediaFile(record),info=await probe(source);
  const video=info.streams.find(stream=>stream.codec_type==="video");
  const seconds=Number(video?.duration||info.format.duration);
  if(!video?.width||!video.height||!Number.isFinite(seconds)||seconds<1||seconds>10.2)throw new StudioError("Choose a valid Story clip up to ten seconds.",400);
  s.db.exec("CREATE TABLE IF NOT EXISTS story_video_handoffs(owner TEXT NOT NULL,media TEXT NOT NULL,project TEXT NOT NULL,PRIMARY KEY(owner,media))");
  const projectId=s.db.transaction(()=>{
    const existing=s.db.prepare("SELECT project FROM story_video_handoffs WHERE owner=? AND media=?").get(owner,id) as {project:string}|undefined;
    if(existing){s.get(owner,existing.project);return existing.project;}
    const p=s.create(owner,record.command.name||"Story video");
    s.db.prepare("INSERT INTO story_video_handoffs VALUES(?,?,?)").run(owner,id,p.id);return p.id;
  })();
  const present=s.assets(owner,projectId).find(a=>a.metadata.storyMediaId===id);
  const asset=present||await snapshotFile(s,owner,projectId,source,record.command.name||"Story video","video",{storyMediaId:id,storyProjectId:storyProject,width:video.width,height:video.height,duration:seconds,source:"Story Creator"});
  const project=s.internalUpdate(owner,projectId,p=>{
    const shot=allShots(p)[0];
    if(shot.takes.some(t=>t.id===id))return;
    p.storyProjectId=storyProject||null;
    p.brief.description=record.command.prompt;p.brief.targetSeconds=seconds;
    p.brief.aspect=video.width!>video.height!?"landscape":video.width!<video.height!?"portrait":"square";
    shot.description=record.command.prompt;shot.characterActions=record.command.prompt;
    shot.plannedDurationSeconds=Math.min(10,seconds);shot.requestedDurationSeconds=seconds<=5.2?5:10;
    shot.takes.push({id,version:1,status:"complete",assetId:asset.id,generationJobId:null,productionId:p.id,productionSceneId:null,previewUrl:null,createdAt:Date.now()});
    p.shots[shot.id]={...DEFAULT_SHOT,model:"fasth3",orientation:p.brief.aspect==="portrait"?"portrait":"landscape"};
    p.workflow={...p.workflow,version:2,workspace:"Action",clipId:shot.id};
    p.lastChange="Imported Story Creator clip for review; original preserved";
  });
  return {projectId:project.id,assetId:asset.id,url:`/app?tab=production&productionProject=${encodeURIComponent(project.id)}`};
}
