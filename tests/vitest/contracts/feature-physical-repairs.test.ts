import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { newClientRequestId } from "@/lib/client/requestId";
import { mossOutputShape } from "@/lib/images/mossImage";
import { mossSourceTarget } from "@/lib/images/mossSourceTarget";
afterEach(() => vi.unstubAllGlobals());
describe("Android physical feature regressions", () => {
  it("does not silently mislabel a restored MOSS candidate as a different GPU", () => {
    expect(mossSourceTarget("RTX 3090", "/api/file?path=qa.png")).toBe("3090");
    expect(mossSourceTarget("RTX 5060 Ti", "/api/file?path=qa.png")).toBe("5060ti");
    expect(mossSourceTarget("image-primary", "/api/file?path=qa.png")).toBe("5060ti");
    expect(mossSourceTarget("", "/api/view?comfyBaseUrl=http%3A%2F%2F100.75.162.64%3A8188")).toBe("3090");
    expect(() => mossSourceTarget("", "/api/file?path=qa.png")).toThrow("no recorded GPU source");
  });
  it("creates independent UUIDs without the secure-context randomUUID API", () => {
    let counter = 0;
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => { bytes.fill(++counter); return bytes; } });
    const a = newClientRequestId(), b = newClientRequestId();
    expect(a).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(b).not.toBe(a);
  });
  it("uses native secure-context UUIDs where available", () => { vi.stubGlobal("crypto", { randomUUID: () => "native-uuid" }); expect(newClientRequestId()).toBe("native-uuid"); });
  it("fails clearly rather than using weak random identifiers", () => { vi.stubGlobal("crypto", {}); expect(() => newClientRequestId()).toThrow("safe request identity"); });
  it.each([[1024, 1024, "square", "1:1"], [1344, 768, "landscape", "7:4"], [768, 1344, "portrait", "4:7"]])("reports the actual MOSS %sx%s shape", (w, h, orientation, aspectRatio) => { expect(mossOutputShape(Number(w), Number(h))).toEqual({ orientation, aspectRatio }); });
  it("keeps MOSS result polling on the selected worker beyond the measured cold time", () => {
    const source = fs.readFileSync("app/app/components/CharactersPanel.tsx", "utf8");
    expect(source).toContain("comfyBaseUrl: json.comfyBaseUrl");
    expect(source).toContain("reportFailure: true");
    expect(source).toContain("while (Date.now() < deadline && !candidate)");
    expect(source).toContain('provider === "moss-image-sft" ? mossSettings.negativePrompt');
  });
  it("offers explicit MOSS Gallery save without changing other providers' candidate policy", () => {
    for (const file of ["CharacterHubPanel", "CharactersPanel", "AssetGalleryPanel"]) {
      expect(fs.readFileSync(`app/app/components/${file}.tsx`, "utf8")).toContain("<MossGallerySaveButton");
    }
    expect(fs.readFileSync("app/app/components/H3VideoEditPanel.tsx", "utf8")).not.toContain("crypto.randomUUID()");
  });
  it("uses theme tokens in Admin tiles and the H3 important-layer mode buttons", () => {
    expect(fs.readFileSync("app/app/components/AdminQuickPanel.tsx", "utf8")).not.toContain("rgba(25,22,44");
    expect(fs.readFileSync("app/app/components/H3Panel.tsx", "utf8")).not.toContain("!bg-[#11172a]");
    const css = fs.readFileSync("app/light-theme.css", "utf8");
    expect(css).toContain(".otg-authCard2"); expect(css).toContain(".otg-help, .otg-authSub");
  });
  it("preserves candidate provenance when saving after the form changes or reloads", () => {
    const source = fs.readFileSync("app/app/components/CharacterHubPanel.tsx", "utf8");
    expect(source).toContain("generationDescription: cleanDescription");
    expect(source).toContain("generationDescription: running.requestBody.description");
    expect(source).toContain("generationDescription: item.description");
    expect(source).toContain('prompt={candidate.generationDescription || ""}');
  });
  it("does not leave MOSS Ready stale while its generation is running", () => {
    const source = fs.readFileSync("app/app/components/MossImageControls.tsx", "utf8");
    expect(source).toContain("Busy — this MOSS operation is in progress.");
    expect(source).toContain("[value.gpuTarget, disabled]");
    expect(source).toContain("window.clearInterval(timer)");
  });
});
