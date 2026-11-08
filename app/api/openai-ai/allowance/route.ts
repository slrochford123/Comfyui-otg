import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { conversationPolicyEnabled, conversationalFeatures, getConversationAccount } from "@/lib/openai/conversationAccount";
import { conversationCreditStatus, requestConversationCredit } from "@/lib/openai/usageLedger";
import { openAIEnabled } from "@/lib/openai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const send=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
  if(!conversationPolicyEnabled())return send({enabled:false});
  let user;
  try{user=await requireSessionUser(req);}catch{return send({error:"Sign in to see your OpenAI allowance."},401);}
  if(!user.accountId)return send({error:"An account is required."},401);
  const account=getConversationAccount(user.accountId);
  if(req.method==="POST"){
    const origin=req.headers.get("origin");
    let sameOrigin=false;
    try{sameOrigin=Boolean(origin)&&new URL(origin!).host===req.headers.get("host");}catch{}
    if(!sameOrigin||req.headers.get("sec-fetch-site")==="cross-site")return send({error:"Same-origin request required."},403);
    requestConversationCredit(account);
  }
  const requestedFeature=req.nextUrl.searchParams.get("feature")||"";
  return send({enabled:true,openAIAvailable:openAIEnabled(),...conversationCreditStatus(account,conversationalFeatures.some(f=>f===requestedFeature)?requestedFeature:undefined)});
}

export const GET=handle;
export const POST=handle;
