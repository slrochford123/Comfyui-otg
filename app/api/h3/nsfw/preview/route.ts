import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { nsfwRoute } from "@/lib/experiments/nsfwHttp";
import { exportLabJob } from "@/lib/experiments/generation";
import { labRoot } from "@/lib/experiments/store";
import { labExperiment } from "@/lib/experiments/catalog";
import { RequestError } from "@/lib/requestError";
import { parseRange } from "@/lib/experiments/range";
import { privateHeaders } from "@/lib/experiments/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const serve=nsfwRoute(async(request,owner)=>{
  const id=request.nextUrl.searchParams.get("jobId")||"",receipt=exportLabJob(owner,id);
  if(labExperiment(receipt.status.model)?.kind!=="h3-admin")throw new RequestError("Preview not found.",404);
  const file=path.join(labRoot(),"jobs",id,"preview.mp4");
  if(!fs.existsSync(file))return new Response(null,{status:204,headers:privateHeaders});
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let streamOwns=false;
  try {
    const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>8*1024**2)throw new RequestError("Invalid preview.",409);
    let range;try{range=parseRange(request.headers.get("range"),stat.size);}catch{return new Response(null,{status:416,headers:{...privateHeaders,"Content-Range":`bytes */${stat.size}`}});}
    const headers={...privateHeaders,"Content-Type":"video/mp4","Accept-Ranges":"bytes","Content-Length":String(range?range.end-range.start+1:stat.size),...(range?{"Content-Range":`bytes ${range.start}-${range.end}/${stat.size}`}:{})};
    if(request.method==="HEAD")return new Response(null,{status:range?206:200,headers});
    const stream=fs.createReadStream(file,{fd,autoClose:true,...(range||{})});streamOwns=true;
    return new Response(Readable.toWeb(stream) as ReadableStream,{status:range?206:200,headers});
  }finally{if(!streamOwns)fs.closeSync(fd);}
});
export const GET=serve;export const HEAD=serve;
