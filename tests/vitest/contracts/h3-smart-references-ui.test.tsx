// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import H3SmartReferences from "@/app/app/components/H3SmartReferences";
import { normalizeH3RefModSlots } from "@/lib/h3SpecialModes/refMods";
vi.mock("@/app/app/components/ExpandedMediaViewer", () => ({ExpandableImage: ({name}: {name: string}) => <span>{name} preview</span>}));
vi.mock("@/app/app/components/H3RefModSlotControls", () => ({default: () => <span>Existing strength controls</span>}));
const slot = normalizeH3RefModSlots([{id: "cat", name: "characters/cat", sourceKind: "image", category: "character"}])[0];
const cap = {backend: "rtx3090", available: true, firstFrame: true, mixedReferences: true, reason: "", maxImages: 9, maxVideos: 3, maxAudios: 3, maxTotalReferenceMedia: 12, maxRefModSlots: 8, firstFrameConsumesReferenceAllowance: false, referenceTokenBudget: null, tokenBudgetExplanation: "No fixed token budget", refMods: [{name: slot.name, kind: "image", tokens: 100}]};
function props() {return {backend: "rtx3090" as const, disabled: false, validateSelection: false, useFirstFrame: false, firstFrame: null, images: [], videos: 0, audios: 0, slots: [], onUseFirstFrame: vi.fn(), onFirstImage: vi.fn(), onFirstGallery: vi.fn(), onRemoveFirst: vi.fn(), onAddImage: vi.fn(), onImageGallery: vi.fn(), onRemoveImage: vi.fn(), onMoveImage: vi.fn(), onImageDescription: vi.fn(), onAddRefMod: vi.fn(), onRemoveRefMod: vi.fn(), onMoveRefMod: vi.fn(), onUpdateRefMod: vi.fn(), onValidation: vi.fn()};}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("smart-references") ? {capabilities: cap} : {entries: [{id: slot.name, name: slot.name, kind: "image", description: "Cat identity"}]}))));
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
describe("shared H3 Smart References controls", () => {
 it("defaults first-frame off and exposes no new generation mode", async () => {
  const p = props();render(<H3SmartReferences {...p} />);
  await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(screen.queryByText("Upload Image")).toBeNull();
  expect(screen.getByText(/Character & Scene References/).closest("details")?.open).toBe(false);
  fireEvent.click(screen.getByRole("checkbox"));expect(p.onUseFirstFrame).toHaveBeenCalledWith(true);
 });
 it("provides upload/gallery/replace/remove for one opening image and keeps it outside the reference rows", async () => {
  const p = {...props(), validateSelection: true, useFirstFrame: true, firstFrame: {id: "frame", name: "Opening", url: "blob:frame", description: ""}};
  render(<H3SmartReferences {...p} />); await waitFor(() => expect(p.onValidation).toHaveBeenLastCalledWith(""));
  fireEvent.click(screen.getByText("Choose from Gallery"));expect(p.onFirstGallery).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Remove Image"));expect(p.onRemoveFirst).toHaveBeenCalledOnce();
  expect(screen.getByText(/0 images • 0 RefMods selected/)).toBeTruthy();
  expect(screen.getByText("Replace Image")).toBeTruthy();
 });
 it("renders mixed rows with independent removal and preserves the RefMod strength control", async () => {
  const image = {id: "girl", name: "Little Girl", url: "blob:girl", description: ""};const p = {...props(), validateSelection: true, images: [image], slots: [slot]};
  render(<H3SmartReferences {...p} />);await waitFor(() => expect(p.onValidation).toHaveBeenLastCalledWith(""));
  expect(screen.getByText(/1 images • 1 RefMods selected/)).toBeTruthy();expect(screen.getByText("Saved RefMod")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "Remove Little Girl"}));expect(p.onRemoveImage).toHaveBeenCalledWith("girl");
  fireEvent.click(screen.getByRole("button", {name: "Remove characters/cat"}));expect(p.onRemoveRefMod).toHaveBeenCalledWith("cat");
  expect(screen.getByText("Existing strength controls")).toBeTruthy();
 });
 it("reports unsupported first-frame capability before generation", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("smart-references") ? {capabilities: {...cap, firstFrame: false}} : {entries: []})));
  const p = {...props(), validateSelection: true, useFirstFrame: true};render(<H3SmartReferences {...p} />);
  await waitFor(() => expect(p.onValidation).toHaveBeenLastCalledWith(expect.stringContaining("timeline-guide")));
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
 });
 it("gates unsupported 5060 mixed input, keeping the selected references removable", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("smart-references") ? {capabilities: {...cap, backend: "rtx5060ti", mixedReferences: false, reason: "Combined encoder not installed on 5060"}} : {entries: []})));
  const p = {...props(), backend: "rtx5060ti" as const, validateSelection: true, images: [{id: "girl", name: "Girl", url: "blob:girl", description: ""}], slots: [slot]};
  render(<H3SmartReferences {...p} />); await waitFor(() => expect(p.onValidation).toHaveBeenLastCalledWith("Combined encoder not installed on 5060"));
  expect((screen.getByRole("button", {name: "+ Add RefMod"}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", {name: "Remove Girl"}) as HTMLButtonElement).disabled).toBe(false);
 });
 it("prevents double conditioning with legacy enhancement controls", async () => {
  const p = {...props(), validateSelection: true, useFirstFrame: true, legacyEnhancementEnabled: true};render(<H3SmartReferences {...p} />);
  await waitFor(() => expect(p.onValidation).toHaveBeenLastCalledWith(expect.stringContaining("not applied twice")));
 });
 it("rejects excessive ordinary references with the new control off", async () => {
  const p = {...props(), videos: 3, audios: 3, images: Array.from({length: 9}, (_, i) => ({id: String(i), name: String(i), url: "blob:i", description: ""}))};
  render(<H3SmartReferences {...p} />);await waitFor(() => expect(p.onValidation).toHaveBeenLastCalledWith(expect.stringContaining("12 reference media")));
 });
});
