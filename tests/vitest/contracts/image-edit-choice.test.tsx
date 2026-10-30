// @vitest-environment jsdom
import React from "react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import ImageEditEngineSelect from "@/app/app/components/ImageEditEngineSelect";
import {runImageEdit} from "@/lib/client/imageEditing";
import {submitNativeImageEdit, runNativeImageEdit, saveNativeImageToGallery} from "@/lib/client/nativeImages";
import {executeCharacterUploadCompletion} from "@/lib/client/characterUploadCompletionClient";
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
describe("One explicit Qwen / Fibo image edit choice", () => {
  it("shows two compact model families, with Fibo Turbo as the default variant", () => {
    const change = vi.fn(); render(<ImageEditEngineSelect value="qwen" onChange={change} />);
    expect(screen.getByRole("combobox", {name: "Edit model"}).querySelectorAll("option")).toHaveLength(2);
    fireEvent.change(screen.getByRole("combobox", {name: "Edit model"}), {target: {value: "fibo"}});
    expect(change).toHaveBeenCalledWith("fibo2-edit-turbo");
  });
  it("retains a dedicated Dev option rather than silently substituting Turbo", () => {
    const change = vi.fn(); render(<ImageEditEngineSelect value="fibo2-dev" onChange={change} />);
    expect((screen.getByRole("combobox", {name: "Fibo variant"}) as HTMLSelectElement).value).toBe("fibo2-dev");
    fireEvent.change(screen.getByRole("combobox", {name: "Edit model"}), {target: {value: "qwen"}});
    expect(change).toHaveBeenCalledWith("qwen");
  });
  it("does not discard additional references to enable Fibo", () => {
    render(<ImageEditEngineSelect value="qwen" onChange={() => {}} referenceCount={2} />);
    expect(screen.getByRole("option", {name: "Fibo · single source only"}).hasAttribute("disabled")).toBe(true);
  });
  it("locks both family and variant while editing", () => {
    render(<ImageEditEngineSelect value="fibo2-edit-turbo" onChange={() => {}} disabled />);
    for (const field of screen.getAllByRole("combobox")) expect(field.hasAttribute("disabled")).toBe(true);
  });
  it.each(["fibo2-edit-turbo", "fibo2-dev"] as const)("submits exact %s instructions and the actual source without Qwen parameters", async model => {
    const fetcher = vi.fn(async () => Response.json({jobId: "id", promptId: "pid"}));
    const image = new File(["source"], "source.png", {type: "image/png"});
    await submitNativeImageEdit({model, image, prompt: "Change only the jacket", negativePrompt: "distortion", seed: "0", fetchImpl: fetcher});
    expect(fetcher.mock.calls[0][0]).toBe("/api/images/native");
    const form = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1].body as FormData;
    expect(form.get("model")).toBe(model); expect(form.get("image")).toBe(image);
    expect(form.get("prompt")).toBe("Change only the jacket"); expect(form.get("negativePrompt")).toBe("distortion");
    expect(form.get("seed")).toBe("0"); expect(form.has("workflowId")).toBe(false); expect(form.has("loras")).toBe(false);
  });
  it("refuses edit calls without a source before any network request", async () => {
    const fetcher = vi.fn();
    await expect(submitNativeImageEdit({model: "fibo2-dev", prompt: "Edit", seed: "0", fetchImpl: fetcher})).rejects.toThrow(/source/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("resolves a Fibo result using its durable job, not a Qwen output resolver", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({jobId: "id", promptId: "pid"})).mockResolvedValueOnce(Response.json({status: "completed", imageUrl: "/native.png", serverPath: "/owned/native.png"}));
    const result = await runImageEdit({engine: "fibo2-edit-turbo", image: new File(["a"], "a.png"), prompt: "Blue jacket", seed: "0", fetchImpl: fetcher});
    expect(result).toMatchObject({model: "fibo2-edit-turbo", serverPath: "/owned/native.png"});
    expect(fetcher.mock.calls[1][0]).toBe("/api/images/native?jobId=id");
  });
  it("never substitutes Qwen following a native model failure", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({error: "Model unavailable"}, {status: 503}));
    await expect(runNativeImageEdit({model: "fibo2-dev", imageAPath: "/owned/a.png", prompt: "Edit", seed: "0", fetchImpl: fetcher})).rejects.toThrow("Model unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains the existing exact-prompt Qwen workflow and persists its new output", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({prompt_id: "pid"}))
      .mockResolvedValueOnce(Response.json({ok: true, imageUrl: "/history.png"}))
      .mockResolvedValueOnce(new Response(new Blob(["png"], {type: "image/png"})))
      .mockResolvedValueOnce(Response.json({serverPath: "/owned/result.png", fileUrl: "/result.png"}));
    const result = await runImageEdit({engine: "qwen", image: new File(["a"], "a.png"), prompt: "  change only color  ", seed: "0", fetchImpl: fetcher});
    const form = fetcher.mock.calls[0][1].body as FormData;
    expect(form.get("workflowId")).toBe("presets/image_qwen_image_2_1_image_edit");
    expect(form.get("prompt")).toBe("  change only color  "); expect(form.get("positivePrompt")).toBe(form.get("prompt"));
    expect(result).toMatchObject({model: "qwen", imageUrl: "/result.png", serverPath: "/owned/result.png"});
  });
  it("preserves native result on Gallery failure and permits a save-only retry", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({error: "Disk full"}, {status: 503})).mockResolvedValueOnce(Response.json({name: "result.png", url: "/gallery.png"}));
    await expect(saveNativeImageToGallery("id", fetcher)).rejects.toThrow("Disk full");
    await expect(saveNativeImageToGallery("id", fetcher)).resolves.toMatchObject({name: "result.png"});
    expect(fetcher.mock.calls.every(call => call[1].method === "PATCH")).toBe(true);
  });
  it("character completion uses Fibo without invoking Qwen's output selector", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({jobId: "id", promptId: "pid"}))
      .mockResolvedValueOnce(Response.json({status: "completed", imageUrl: "/native.png", serverPath: "/owned/native.png", promptId: "pid"}));
    const resolveOutput = vi.fn(), persistOutput = vi.fn(async () => ({serverPath: "/owned/character.png"}));
    await executeCharacterUploadCompletion({engine: "fibo2-dev", sourceServerPath: "/owned/head.png", kind: "standard", framing: "head", completionPrompt: "Ivory sweater, full body", seed: "0", resolveOutput, persistOutput, fetchImpl: fetcher});
    expect(resolveOutput).not.toHaveBeenCalled(); expect(persistOutput).toHaveBeenCalledWith("/native.png", "character-completed-pid.png");
  });
});
