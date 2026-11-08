import {explicitMediaRequest,type StoryMediaCommand} from "./mediaContract";

export const STORY_VOICE_LINE_PROMPT = "Please provide the exact line the character should speak.";

const titleName = /\b(?:Dr|Mr|Mrs|Ms)\.\s+[A-Z][\p{L}’'-]*(?:\s+[A-Z][\p{L}’'-]*)?/u;
const referenceToDialogue = /^(?:(?:that|this|the previous|the same)\s+(?:phrase|line|dialogue)|what (?:you|she|he|they) just said)[.!]?$/i;

function literal(text: string) {
  const line=text.trim();
  const quotes:Record<string,string>={'"':'"',"“":"”","‘":"’"};
  return line.length>1&&quotes[line[0]]===line.at(-1)?line.slice(1,-1).trim():line;
}

export function storyVoiceDraft(request: string) {
  const raw=request.trim();
  const line=raw.replace(/^(?:please\s+|i (?:want|would like) you to\s+)+/i,"");
  const cue=/\b(?:say(?:ing)?\b\s*[:.,–-]?|(?:speak|read)(?:ing)?\b\s*[:.,–-])\s*(.*)$/i.exec(line);
  const instruction=(cue?line.slice(0,cue.index):line).replace(/\s+and\s+(?:make|have)\s+(?:her|him|them)$/i,"").replace(/[,\s]+$/,"");
  if(!explicitMediaRequest(instruction,true))return;
  const voiceTarget=instruction.match(/^(?:create|generate|design|make)\b([^!?\n]{0,160}?)\bvoice\b/i);
  const design=voiceTarget&&!/\b(?:image|picture|video|music|script|story|soundtrack|prompt|outline)\b/i.test(voiceTarget[1]) ||
    /^(?:give|use)\b[^!?\n]{0,140}\baccent\b/i.test(instruction);
  if(!design || /\b(?:same|saved|approved|existing)\s+voice\b/i.test(instruction))return;
  return {instruction,dialogue:literal(cue?.[1]||"")};
}

export function storyVoiceLineReply(request:string) {
  const line=request.trim();
  const supplied=/^(?:(?:the\s+)?exact\s+(?:line|dialogue)(?:\s+is)?|(?:the\s+)?(?:line|dialogue)\s+is)(?:\s*[:.,–-]\s*|\s+)([\s\S]+)$/i.exec(line);
  return supplied?literal(supplied[1]):/^(?:"[^"]+"|“[^”]+”|‘[^’]+’)$/.test(line)?literal(line):"";
}

export function storyVoiceQuotedLine(reply: string) {
  const quotes=[...reply.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g)].map(m=>(m[1]||m[2]).trim());
  return quotes.length===1?quotes[0]:"";
}

export function buildStoryVoiceAudition(draft:NonNullable<ReturnType<typeof storyVoiceDraft>>, dialogue?:string, previousReply?:string) {
  const wantsReference=referenceToDialogue.test(draft.dialogue);
  const text=dialogue||(wantsReference?storyVoiceQuotedLine(previousReply||""):draft.dialogue);
  if(!text||text.length>1200||referenceToDialogue.test(text))return;
  const name=draft.instruction.match(titleName)?.[0]||text.match(titleName)?.[0]||"";
  const command:StoryMediaCommand={operation:"voice",subject:name?"character":"scene",name,prompt:draft.instruction,
    sourceId:"",text,evidence:draft.instruction,voiceMode:"design"};
  return {instruction:draft.instruction,command};
}
