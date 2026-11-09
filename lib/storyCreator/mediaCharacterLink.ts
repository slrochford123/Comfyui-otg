import type {StoryMediaRecord} from "./mediaStore";
import type {CharacterRecord} from "@/lib/characters/store";

/** Follow explicit provenance only. A shared display name is never an assignment. */
export function storyCharacterSource(record:StoryMediaRecord, readers:{
  media:(id:string)=>StoryMediaRecord|null;
  character:(id:string)=>CharacterRecord|null;
}) {
  let current:StoryMediaRecord|null=record;
  let image:StoryMediaRecord|null=null;
  let character:CharacterRecord|null=null;
  const seen=new Set<string>();
  for(let depth=0;current&&depth<16;depth++) {
    if(seen.has(current.id)||current.ownerKey!==record.ownerKey||current.projectId!==record.projectId)break;
    seen.add(current.id);
    if(!image&&current.command.subject==="character"&&["image","edit"].includes(current.command.operation))image=current;
    if(current.characterId&&!character)character=readers.character(current.characterId);
    const source=current.command.sourceId;
    if(!source)break;
    const saved=readers.character(source);
    if(saved){character=character||saved;break;}
    current=readers.media(source);
  }
  return {image,character};
}
