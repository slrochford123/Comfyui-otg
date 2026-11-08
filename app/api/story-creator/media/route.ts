import {after,NextRequest,NextResponse} from "next/server";
import {requireSessionUser} from "@/lib/sessionUser";
import {SessionInvalidError} from "@/lib/ownerKey";
import {listCharacters} from "@/lib/characters/store";
import {getStoryMedia,listStoryChatMedia,publicStoryMedia} from "@/lib/storyCreator/mediaStore";
import {limitedJson} from "@/lib/limitedRequestBody";
import {storyOpenAIImagesEnabled} from "@/lib/storyCreator/mediaOpenAI";
import {storyChatMediaEnabled,storyMediaEnabled} from "@/lib/storyCreator/mediaAvailability";
import {story3060ImageEnabled,story3060EditEnabled} from "@/lib/storyCreator/media3060";
import {requireStoryMediaTest,refreshStoryMedia,executeStoryMedia,nameStoryMedia,retryStoryMedia,requestStoryMediaFromCard,saveStoryCharacter,saveStoryVoice,cancelStoryMedia} from "@/lib/storyCreator/mediaExecution";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=900;
const headers={"Cache-Control":"no-store"};
function failure(error:unknown) {
  return NextResponse.json({ok:false,error:error instanceof SessionInvalidError?"Sign in to use Story media.":error instanceof Error?error.message:"Story media request failed."},
    {status:error instanceof SessionInvalidError?401:400,headers});
}
export async function GET(request:NextRequest) {
  try {
    const {ownerKey,accountId}=await requireSessionUser(request);
    if(!storyMediaEnabled())return NextResponse.json({ok:true,enabled:false,media:[],characters:[]},{headers});
    const lightweightImage=story3060ImageEnabled();
    const lightweightEdit=story3060EditEnabled();
    const openAIImage=storyOpenAIImagesEnabled(accountId);
    if(request.nextUrl.searchParams.get("capabilities")==="1")return NextResponse.json({ok:true,enabled:true,chatMedia:storyChatMediaEnabled(),lightweightImage,lightweightEdit,openAIImage},{headers});
    const projectId=request.nextUrl.searchParams.get("projectId")||"";
    const {visible:records,background}=listStoryChatMedia(ownerKey,projectId);
    if (background.length) after(() => Promise.allSettled(background.map(refreshStoryMedia)).then(() => {}));
    const media=await Promise.all(records.map(async record=>publicStoryMedia(await refreshStoryMedia(record).catch(()=>record))));
    return NextResponse.json({ok:true,enabled:true,chatMedia:storyChatMediaEnabled(),lightweightImage,lightweightEdit,openAIImage,media,characters:listCharacters(ownerKey).map(c=>({id:c.id,name:c.name,hasVoice:!!c.referenceAudioPath}))},{headers});
  } catch(error) {return failure(error);}
}
export async function POST(request:NextRequest) {
  try {
    const {ownerKey,accountId}=await requireSessionUser(request);requireStoryMediaTest();
    const origin=request.headers.get("origin");
    if(origin&&new URL(origin).host!==request.headers.get("host"))throw Error("Cross-origin media actions are not allowed.");
    if(Number(request.headers.get("content-length")||0)>32_000)throw Error("Request is too large.");
    const body=await limitedJson(request,32_000),projectId=String(body.projectId||"");
    let record;
    if(body.action==="create")record=requestStoryMediaFromCard(ownerKey,projectId,body,accountId).record;
    else {
      record=getStoryMedia(ownerKey,projectId,String(body.id||""));
      if(body.action==="retry" && storyChatMediaEnabled())record=retryStoryMedia(record,String(body.requestKey||""),accountId);
      else if(body.action==="name")record=nameStoryMedia(record,String(body.name||""));
      else if(body.action==="save-character")record=saveStoryCharacter(record);
      else if(body.action==="save-voice")record=saveStoryVoice(record,body.characterId?String(body.characterId):undefined);
      else if(body.action==="cancel")record=await cancelStoryMedia(record);
      else throw Error("Unsupported media action.");
    }
    const queued=record;
    if(queued.status==="queued") {
      const cookie=request.headers.get("cookie")||"";
      after(()=>executeStoryMedia(queued,cookie));
    }
    return NextResponse.json({ok:true,media:publicStoryMedia(record)},{headers});
  } catch(error) {return failure(error);}
}
