import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";

const permissions = vi.hoisted(() => ({readable: vi.fn()}));
vi.mock("@/lib/paths", async importActual => {
  const actual = await importActual<typeof import("@/lib/paths")>();
  const dataRoot = await (await import("node:fs/promises")).mkdtemp(
    (await import("node:path")).join((await import("node:os")).tmpdir(), "slr-fine-tune-session-"));
  return {...actual, OTG_DATA_ROOT: dataRoot};
});
vi.mock("@/lib/productionAudioAccess", async importActual => ({
  ...await importActual<typeof import("@/lib/productionAudioAccess")>(), productionAudioMediaReadable: permissions.readable,
}));
import { correctionPath, reopenCorrectionPreview, resolveCorrectionSource, verifiedCorrectionVoice, writeCorrectionRecord } from "@/lib/fixVoicesSession";
import { OTG_DATA_ROOT } from "@/lib/paths";

const request = new NextRequest("http://localhost:3001/api/production/audio/analyze-clip");
afterAll(async () => fs.rm(OTG_DATA_ROOT, {recursive:true,force:true}));

describe("Fix Voices source and target ownership", () => {
  it("rejects traversing record ids and external source links", async () => {
    expect(() => correctionPath("test-owner", "../other-owner/secret", "analysis")).toThrow();
    await expect(resolveCorrectionSource(request, "test-owner", {sourceUrl: "https://external.invalid/api/file?path=%2Fpath"})).rejects.toThrow();
  });

  it("requires the exact verified bytes of the attached same-job target", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "slr-voice-target-"));
    try {
      const file = path.join(work, "sample.wav");
      const data = Buffer.from("stored sample bytes");
      await fs.writeFile(file, data);
      const target = {characterId: "character-a", modelId: "library:one", sample: {path: file, name: "One", description: "Pinned"}, sha256: createHash("sha256").update(data).digest("hex")};
      permissions.readable.mockResolvedValue(false);
      expect(await verifiedCorrectionVoice(request, target)).toBeNull();
      permissions.readable.mockResolvedValue(true);
      expect(await verifiedCorrectionVoice(request, target)).toEqual(target);
      await fs.writeFile(file, "changed bytes under the same path");
      expect(await verifiedCorrectionVoice(request, target)).toBeNull();
    } finally { await fs.rm(work, {recursive: true, force: true}); }
  });

  it("reopens a saved Fine-Tune with its original and unadjusted preview for the same owner", async () => {
    const owner = "test-owner";
    const analysisId = "fixture-analysis";
    const baseId = "base-preview";
    const savedId = "saved-preview";
    const analysisDir = correctionPath(owner,analysisId,"analysis");
    const baseDir = correctionPath(owner,baseId,"preview");
    const previewDir = correctionPath(owner,savedId,"preview");
    await Promise.all([analysisDir,baseDir,previewDir].map(dir => fs.mkdir(dir,{recursive:true})));
    const sourcePath = path.join(analysisDir,"source.mp4");
    const basePath = path.join(baseDir,"converted.mp4");
    const previewPath = path.join(previewDir,"adjusted.mp4");
    const savedFile = path.join(OTG_DATA_ROOT,"saved.mp4");
    await Promise.all([[sourcePath,"A"],[basePath,"B"],[previewPath,"C"],[savedFile,"C"]].map(([file,data])=>fs.writeFile(file,data)));
    await writeCorrectionRecord(owner,analysisId,"analysis",{sourcePath,sourceFileName:"source.mp4",durationSeconds:5,mixReady:true,warnings:[],
      mixSource:null,voices:[{id:"speaker",label:"Darius",segments:[{start:1,end:2}]}]});
    const cue = {cueIndex:0,voiceId:"speaker",targetVoiceId:"library:darius",engine:"seed-vc",usedActedTake:false,start:1,end:2};
    const record = {sourceFileName:"source.mp4",analysisId,renderedSegments:[cue],skippedSegments:[]};
    await writeCorrectionRecord(owner,baseId,"preview",{...record,previewPath:basePath,convertedFiles:["saved-raw.wav"]});
    await writeCorrectionRecord(owner,savedId,"preview",{...record,previewPath,sourcePreviewId:baseId,matchOriginalScene:true,
      renderedSegments:[{...cue,levelDb:-2,fineTune:{distance:2,reflections:1}}]});
    permissions.readable.mockResolvedValue(true);
    const reopened = await reopenCorrectionPreview(request,owner,savedId,savedFile);
    expect(reopened.sourceVideoUrl).toContain(encodeURIComponent(sourcePath));
    expect(reopened.restoredPreview.unadjustedVideoUrl).toContain(encodeURIComponent(basePath));
    expect(reopened.restoredPreview.renderedSegments[0]).toMatchObject({levelDb:-2,fineTune:{distance:2,reflections:1}});
    await expect(reopenCorrectionPreview(request,"another-owner",savedId,savedFile)).rejects.toThrow(/unavailable/);
    await fs.writeFile(savedFile,"changed");
    await expect(reopenCorrectionPreview(request,owner,savedId,savedFile)).rejects.toThrow(/changed/);
  });
});
