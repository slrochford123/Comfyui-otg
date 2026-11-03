import fs from "node:fs";
import {it,expect} from "vitest";
const source=fs.readFileSync("app/app/components/H3Panel.tsx","utf8");
const start=source.indexOf("function consume(entry: H3RefModLibraryEntry"),end=source.indexOf("window.addEventListener(H3_REFMOD_USE_IN_H3_EVENT",start);
const consume=source.slice(start,end);
it("opens actual RefMod generation controls instead of leaving a saved card in Auto Studio",()=>{
  for(const action of ['setStudioController("manual")','setManualControlsOpen(false)','setVideoEditOpen(false)','setImageCreateOpen(false)','showNsfw(false)','setStudioMode("h3-refmods")','addRefModSlot(entry)'])expect(consume).toContain(action);
  expect(consume).not.toMatch(/cancel|interrupt|resetH3/);
});
it("consumes pending RefMods only after owner-scoped media/slot restoration",()=>{
  expect(source.slice(start-300,start)).toContain("if(!inputStateHydrated)return");
  expect(source.slice(end,end+300)).toContain("[inputStateHydrated]");
});
it("uses the card GPU for AUTO without changing an explicit manual GPU preference",()=>{
  expect(consume).toContain('entry.backend&&latestMediaGpuPreference.current==="auto"');
  expect(consume).toContain("setH3Backend(entry.backend)");
});
