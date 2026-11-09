import fs from "node:fs";
import path from "node:path";
import {safeSegment} from "@/lib/paths";
import {getVoiceById,resolveVoicesFile,voicesRoot} from "@/lib/voicesStudio";
import {loadCharacter,updateCharacterVoiceSelection} from "./store";

/** Select an existing owned library reference. This never generates or replaces speech. */
export function attachSavedCharacterVoice(ownerKey:string,characterId:string,voiceId:string) {
  const character=loadCharacter(ownerKey,characterId),voice=getVoiceById(ownerKey,voiceId);
  if(!character)throw Error("Character not found for this account.");
  if(!voice||!voice.voiceId.startsWith(safeSegment(ownerKey)+"__"))throw Error("Voice not found for this account.");
  let file:string;
  try {
    file=fs.realpathSync(resolveVoicesFile(voice.refAudioRel));
    const expected=path.join(fs.realpathSync(path.join(voicesRoot(),"samples")),safeSegment(voice.voiceId));
    const root=fs.realpathSync(expected),relative=path.relative(root,file);
    if(root!==expected||!relative||relative.startsWith("..")||path.isAbsolute(relative)||!fs.statSync(file).isFile())throw Error();
  } catch {throw Error("The saved voice reference is unavailable.");}
  const sameVoice=character.metadata?.storyVoiceId===voice.voiceId;
  const engine=voice.tags.find(t=>["elevenlabs","ltx25","qwen3","cosy"].includes(t))||"Saved Voice";
  return updateCharacterVoiceSelection(ownerKey,characterId,{
    referenceAudioPath:file,voiceEngineUsed:engine,voiceStyleDefinition:sameVoice?character.voiceStyleDefinition:"",
    voiceSettings:{...character.voiceSettings,voiceId:voice.voiceId,refText:voice.refText,audioUrl:`/api/file?path=${encodeURIComponent(file)}`},
    metadata:{storyVoiceId:voice.voiceId,storyVoiceText:voice.refText,storyVoiceMediaId:sameVoice?character.metadata?.storyVoiceMediaId||null:null,storyVoiceDirection:sameVoice?character.metadata?.storyVoiceDirection||"":""},
  });
}
