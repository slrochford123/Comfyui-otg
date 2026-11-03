import {createHash} from "node:crypto";
import {CHARACTER_REF_PREFIX} from "./characterRefCardContract";
export const characterRefOwnerHash=(owner:string)=>createHash("sha256").update(owner).digest("hex").slice(0,24);
export function canUseCharacterRefMod(owner:string,name:string){
  const canonical=name.replaceAll("\\","/");
  return !canonical.startsWith(CHARACTER_REF_PREFIX)||!!owner&&canonical.startsWith(CHARACTER_REF_PREFIX+characterRefOwnerHash(owner)+"/");
}
export function assertOwnedCharacterRefMods(owner:string,slots:Array<{name:string}>){
  if(slots.some(slot=>!canUseCharacterRefMod(owner,slot.name)))throw Error("This character RefMod is not available to this account.");
}
