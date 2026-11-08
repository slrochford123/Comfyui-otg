import {AsyncLocalStorage} from "node:async_hooks";
import {createOpenAIText,createOpenAITextStream,openAIEnabled,type OpenAITextStreamEvent,type RoutedTextStream} from "@/lib/openai/provider";
import {conversationalAccount,conversationFeature,conversationPolicyEnabled,isConversationalUseCase,recordConversationRoute} from "@/lib/openai/conversationAccount";
import {noteConversationProvider} from "@/lib/openai/usageLedger";
import {execute3060} from "./qwenClusterRouter";
import {local3060Enabled,LOCAL_MODEL} from "./local3060";

export type AssistantProvider = "openai" | "local3060";
type Request = Parameters<typeof createOpenAITextStream>[0];
const scope=new AsyncLocalStorage<AssistantProvider>();

export function resolveAssistantProvider(value:unknown):AssistantProvider {
  if(value===undefined||value===null||value==="")return !conversationPolicyEnabled()&&local3060Enabled()?"local3060":"openai";
  if(value!=="openai"&&value!=="local3060")throw Error("Choose a supported AI provider.");
  if(value==="local3060"&&!local3060Enabled())throw Error("The local RTX 3060 provider is not enabled. No cloud request was made.");
  return value;
}
export const assistantProvider=()=>scope.getStore()||"openai";
export const withAssistantProvider=<T>(provider:AssistantProvider,run:()=>T)=>scope.run(provider,run);
export const assistantAvailable=(provider=assistantProvider())=>provider==="local3060"?local3060Enabled():openAIEnabled()||conversationPolicyEnabled()&&local3060Enabled();

export function localChatPayload(req:Request){
  const messages:Array<{role:string;content:string;images?:string[]}>= [{role:"system",content:req.instructions}];
  const input=typeof req.input==="string"?[{role:"user",content:req.input}]:req.input;
  if(!Array.isArray(input)||!input.length)throw Error("This local assistant requires text or a supported attached image.");
  for(const m of input){
    if(!["user","assistant","system","developer"].includes(m.role))throw Error("This conversation input is not supported by the local provider.");
    const role=m.role==="developer"?"system":m.role;
    if(typeof m.content==="string"){messages.push({role,content:m.content});continue;}
    if(!Array.isArray(m.content))throw Error("Unsupported local assistant content.");
    const text:string[]=[],images:string[]=[];
    for(const part of m.content){
      if(["text","input_text","output_text"].includes(part.type)&&typeof part.text==="string")text.push(part.text);
      else if(part.type==="input_image"&&typeof part.image_url==="string"&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(part.image_url)&&part.image_url.length<12_000_000)images.push(part.image_url.split(",")[1]);
      else throw Error("This attachment type is not supported by local AI; nothing was sent to another provider.");
    }
    messages.push({role,content:text.join("\n"),...(images.length?{images}:{})});
  }
  const tools=req.tools?.map(t=>{
    if(t.type!=="function"||typeof t.name!=="string"||!t.parameters)throw Error("This tool is not supported by local AI.");
    return {type:"function",function:{name:t.name,description:t.description,parameters:t.parameters}};
  });
  return {messages,...(req.responseSchema?{format:req.responseSchema.schema}:{}),...(tools?.length?{tools}:{}),options:{num_predict:Math.min(req.maxOutputTokens||1200,1400)}};
}

export async function createAssistantStream(req:Request,provider=assistantProvider()):Promise<RoutedTextStream>{
  if(provider==="openai")return createOpenAITextStream(req);
  if(conversationPolicyEnabled()&&isConversationalUseCase(req.useCase)){
    noteConversationProvider(await conversationalAccount(req.ownerKey,req.accountId),conversationFeature(req.feature)||req.useCase,"local3060","selected");
    recordConversationRoute("local3060",LOCAL_MODEL);
  }
  return createLocalAssistantStream({...req,...req.localVariant});
}

export async function createLocalAssistantStream(req:Request):Promise<RoutedTextStream>{
  if(!local3060Enabled())throw Error("The local RTX 3060 provider is unavailable.");
  const payload=localChatPayload(req);
  async function* stream():AsyncGenerator<OpenAITextStreamEvent>{
    const waiting:OpenAITextStreamEvent[]=[];
    let text="",wake:(()=>void)|undefined,ended=false,failure:unknown;
    let tools:NonNullable<Extract<OpenAITextStreamEvent,{type:"done"}>["toolCalls"]>=[];
    const notify=()=>{wake?.();wake=undefined;};
    const request=execute3060("/api/chat",payload,{signal:req.signal,timeoutMs:req.timeoutMs,admissionWaitMs:120_000,
      onPhase:phase=>{waiting.push({type:"status",phase});notify();},onChunk:chunk=>{
      const message=chunk.message as {content?:unknown;tool_calls?:Array<{function?:{name?:unknown;arguments?:unknown}}>}|undefined;
      if(typeof message?.content==="string"&&message.content){text+=message.content;waiting.push({type:"delta",delta:message.content});notify();}
      for(const call of message?.tool_calls||[]){
        const name=call.function?.name;
        if(typeof name!=="string"||!payload.tools?.some(t=>t.function.name===name))throw Error("The local model requested an unapproved tool.");
        tools.push({name,arguments:typeof call.function?.arguments==="string"?call.function.arguments:JSON.stringify(call.function?.arguments||{}),call_id:"local-"+tools.length});
      }
    }}).then(async r=>{
      if(!r.ok)throw Error("Local AI could not finish. No cloud fallback was used.");
      const done=await r.json();
      if(done.done_reason==="length")throw Error("The local response reached its output limit. Try a smaller section; no proposal was applied.");
      const inputTokens=Number(done.prompt_eval_count)||0,outputTokens=Number(done.eval_count)||0;
      waiting.push({type:"done",text,...(tools.length?{toolCalls:tools}:{}),usage:{inputTokens,outputTokens,totalTokens:inputTokens+outputTokens}});
    }).catch(error=>{failure=error;}).finally(()=>{ended=true;notify();});
    try{
      while(!ended||waiting.length){
        req.signal?.throwIfAborted();
        if(waiting.length)yield waiting.shift()!;
        else await new Promise<void>(resolve=>{wake=resolve;});
      }
      if(failure)throw failure;
    }finally{
      // The caller may stop consuming on cancellation. The in-flight
      // transport still drains and releases its own lease safely.
      void request;
      tools=[];
    }
  }
  return Object.assign(stream(),{routing:{provider:"local3060" as const,model:LOCAL_MODEL}});
}

export async function createAssistantText(req:Request){
  if(assistantProvider()==="openai")return createOpenAIText(req);
  const stream=await createAssistantStream(req);
  for await(const event of stream)if(event.type==="done")return {...event,...stream.routing!};
  throw Error("Local AI ended without a complete response.");
}
