import { afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStudioStore } from "@/lib/productionStudio/store";
import { allShots, EMPTY_TIMELINE } from "@/lib/productionStudio/model";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-contract-"));
const s = createStudioStore(root);
afterAll(() => {
  s.db.close();
  fs.rmSync(root, { recursive: true, force: true });
});
describe("Production studio persistence", () => {
  it("starts with one camera draft and has no eight-shot limit", () => {
    let p = s.create("alice", "Coffee shop");
    expect(allShots(p)).toHaveLength(1);
    for (let i = 0; i < 10; i++)
      p = s.mutate("alice", p.id, p.revision, { type: "shot.add" });
    expect(allShots(p)).toHaveLength(11);
  });
  it("prevents cross-owner project, asset and job access", () => {
    const p = s.create("alice", "Owned");
    expect(() => s.get("bob", p.id)).toThrow("not found");
    expect(() => s.assets("bob", p.id)).toThrow("not found");
    const j = s.enqueue("alice", p.id, "export", {}, "owner-test");
    expect(() => s.job("bob", j.id)).toThrow("not found");
  });
  it("rejects stale revisions without dropping either edit", () => {
    const p = s.create("alice", "Conflict");
    s.mutate("alice", p.id, p.revision, {
      type: "brief",
      patch: { style: "Anime" },
    });
    expect(() =>
      s.mutate("alice", p.id, p.revision, {
        type: "brief",
        patch: { description: "Coffee shop" },
      }),
    ).toThrow("changed elsewhere");
    const current = s.get("alice", p.id);
    expect(current.brief.style).toBe("Anime");
    const merged = s.mutate("alice", p.id, current.revision, {
      type: "brief",
      patch: { description: "Coffee shop" },
    });
    expect(merged.brief.style).toBe("Anime");
  });
  it("preserves a completed and approved take across story updates", () => {
    let p = s.create("alice", "Takes");
    const shot = allShots(p)[0];
    p = s.internalUpdate("alice", p.id, (p) => {
      allShots(p)[0].takes.push({
        id: "take-one",
        version: 1,
        status: "complete",
        assetId: "asset-one",
        generationJobId: "job-one",
        productionId: p.id,
        productionSceneId: null,
        previewUrl: null,
        createdAt: Date.now(),
      });
    });
    p = s.mutate("alice", p.id, p.revision, {
      type: "take.approve",
      shotId: shot.id,
      takeId: "take-one",
    });
    const revised = structuredClone(p.plan);
    revised.acts[0].scenes[0].shots[0].takes = [];
    p = s.mutate("alice", p.id, p.revision, {
      type: "plan.replace",
      plan: revised,
    });
    expect(allShots(p)[0].takes[0].status).toBe("accepted");
    expect(allShots(p)[0].acceptedTakeId).toBe("take-one");
  });
  it("supports non-destructive undo/redo", () => {
    let p = s.create("alice", "Timeline");
    p = s.mutate("alice", p.id, p.revision, {
      type: "timeline.set",
      timeline: {
        ...EMPTY_TIMELINE,
        titles: [
          { id: "title", text: "Coffee", start: 0, end: 1, position: "bottom" },
        ],
      },
    });
    p = s.mutate("alice", p.id, p.revision, { type: "timeline.undo" });
    expect(p.timeline.titles).toHaveLength(0);
    p = s.mutate("alice", p.id, p.revision, { type: "timeline.redo" });
    expect(p.timeline.titles[0].text).toBe("Coffee");
  });
  it("rejects unknown asset IDs and invalid trims", () => {
    const p = s.create("alice", "Timeline ownership");
    expect(() =>
      s.mutate("alice", p.id, p.revision, {
        type: "timeline.set",
        timeline: {
          ...EMPTY_TIMELINE,
          clips: [
            {
              id: "c",
              assetId: "foreign",
              in: 0,
              out: 2,
              volume: 1,
              transition: "cut",
              transitionSeconds: 0,
            },
          ],
        },
      }),
    ).toThrow("does not belong");
  });
  it("deduplicates queue requests and rejects cross-project replay", () => {
    const p = s.create("alice", "Jobs"),
      j = s.enqueue("alice", p.id, "export", {}, "stable-key");
    expect(s.enqueue("alice", p.id, "export", {}, "stable-key").id).toBe(j.id);
    const q = s.create("alice", "Other");
    expect(() => s.enqueue("alice", q.id, "export", {}, "stable-key")).toThrow(
      "reused",
    );
  });
  it("recovers expired CPU jobs without automatically repeating uncertain paid calls", () => {
    const local = createStudioStore(path.join(root, "recovery")),
      p = local.create("owner", "Recovery");
    const ai = local.enqueue("owner", p.id, "assistant", {}, "ai-key"),
      cpu = local.enqueue("owner", p.id, "export", {}, "cpu-key");
    local.updateJob("owner", ai.id, { status: "running" }, Date.now() - 1);
    local.updateJob("owner", cpu.id, { status: "running" }, Date.now() - 1);
    expect(local.claim()).toBeNull();
    expect(local.job("owner", ai.id).status).toBe("attention");
    expect(local.claim()?.job.id).toBe(cpu.id);
    local.db.close();
  });
  it("persists across process connections", () => {
    const p = s.create("alice", "Reload"),
      other = createStudioStore(root);
    expect(other.get("alice", p.id).name).toBe("Reload");
    other.db.close();
  });
  it("restores an earlier revision without deleting later revision history",()=>{
    let p=s.create('alice','Revision recovery');const first=p.revision;
    p=s.mutate('alice',p.id,p.revision,{type:'brief',patch:{style:'Anime'}});
    p=s.mutate('alice',p.id,p.revision,{type:'revision.restore',revision:first});
    expect(p.brief.style).toBe('');expect(p.revision).toBe(3);expect(s.revisions('alice',p.id).length).toBe(2);
  });
  it("assigns only explicitly approved pinned voices to characters",()=>{
    let p=s.create('alice','Maya voice');const date=new Date().toISOString();
    for(const [id,kind]of [['maya','character'],['voice-v1','audio']] as const)s.addAsset('alice',p.id,{id,kind,projectId:p.id,name:id,sha256:'fixture',mime:kind==='audio'?'audio/wav':'image/png',bytes:1,createdAt:date,metadata:{}},root+'/'+id);
    expect(()=>s.mutate('alice',p.id,p.revision,{type:'character.voice',characterId:'maya',voiceId:'voice-v1'})).toThrow('Approve');
    p=s.mutate('alice',p.id,p.revision,{type:'asset.bind',assetId:'voice-v1',approved:true,role:'voice'});
    p=s.mutate('alice',p.id,p.revision,{type:'character.voice',characterId:'maya',voiceId:'voice-v1'});
    expect(p.characterVoices?.maya).toBe('voice-v1');
  });
});
