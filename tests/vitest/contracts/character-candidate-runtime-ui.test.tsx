// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CharacterHubPanel from "@/app/app/components/CharacterHubPanel";
import {
  CandidateModifyDialog,
  CharacterCardRuntimeActions,
  ContinueToCharacterCardButton,
} from "@/app/app/components/CharacterCandidateRuntimeControls";
import {
  executeCharacterCandidateEdit,
  submitCharacterCandidateEditJob,
  type EditableCharacterCandidate,
} from "@/lib/client/characterCandidateEditClient";
import { submitCharacterCardJob } from "@/lib/client/characterCardClient";

const sourceCandidate: EditableCharacterCandidate = {
  id: "runtime-candidate",
  label: "Runtime Candidate",
  url: "/characters/runtime-candidate.png",
  serverPath: "/data/characters/runtime-candidate.png",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("active Character candidate runtime controls", () => {
  it("contains no stale disconnected-workflow placeholder copy", () => {
    const activeSources = [
      "app/app/components/CharacterHubPanel.tsx",
      "app/app/components/CharacterCandidateRuntimeControls.tsx",
    ].map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");
    expect(activeSources).not.toContain("Run Modification");
    expect(activeSources).not.toContain("edit workflow not connected");
    expect(activeSources).not.toContain("Continue and Save for Later will be connected");
  });

  it("enables Apply Edit only for a stable candidate plus nonempty request", () => {
    const apply = vi.fn();
    const { rerender } = render(
      <CandidateModifyDialog candidate={sourceCandidate} imageSrc={sourceCandidate.url} requestedChange="" negativePrompt="" advancedOpen={false} status="idle" onRequestedChange={vi.fn()} onNegativePrompt={vi.fn()} onToggleAdvanced={vi.fn()} onExpand={vi.fn()} onApply={apply} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Apply Edit" })).toBeDisabled();
    rerender(
      <CandidateModifyDialog candidate={sourceCandidate} imageSrc={sourceCandidate.url} requestedChange="Change the jacket to blue" negativePrompt="" advancedOpen={false} status="idle" onRequestedChange={vi.fn()} onNegativePrompt={vi.fn()} onToggleAdvanced={vi.fn()} onExpand={vi.fn()} onApply={apply} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply Edit" }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("exposes selected-candidate continuation and guarded card actions", () => {
    const onContinue = vi.fn();
    const { rerender } = render(<ContinueToCharacterCardButton candidate={null} busy={false} onContinue={onContinue} />);
    expect(screen.queryByRole("button", { name: "Continue to Character Card" })).not.toBeInTheDocument();
    rerender(<ContinueToCharacterCardButton candidate={sourceCandidate} busy={false} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Character Card" }));
    expect(onContinue).toHaveBeenCalledTimes(1);

    cleanup();
    const create = vi.fn();
    const back = vi.fn();
    render(<CharacterCardRuntimeActions hasSource hasCard={false} busy={false} gated={false} onCreate={create} onAccept={vi.fn()} onBack={back} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Character Card" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to Candidates" }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("actual Character edit/card clients", () => {
  it("posts the reviewed no-Gallery contracts", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ prompt_id: "prompt-1" }));
    await submitCharacterCandidateEditJob({ sourceServerPath: sourceCandidate.serverPath!, requestedChange: "Blue jacket", negativePrompt: "red", seed: "42", fetchImpl });
    let body = fetchImpl.mock.calls[0][1]?.body as FormData;
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/comfy");
    expect(body.get("workflowId")).toBe("presets/Edit Image");
    expect(body.get("imageAPath")).toBe(sourceCandidate.serverPath);
    expect(body.get("skipGeneralGallery")).toBe("true");

    fetchImpl.mockClear();
    await submitCharacterCardJob({ sourceServerPath: "/data/characters/processed.png", fetchImpl });
    body = fetchImpl.mock.calls[0][1]?.body as FormData;
    expect(body.get("workflowId")).toBe("presets/character_card_8_angles_low_angle");
    expect(body.get("loadImageNodeId")).toBe("25");
    expect(body.get("characterCardOutputNodeId")).toBe("439");
    expect(body.get("skipGeneralGallery")).toBe("true");
  });

  it("resolves and persists an edited output with lineage", async () => {
    const edited = await executeCharacterCandidateEdit({
      source: sourceCandidate,
      requestedChange: "Add a necklace",
      negativePrompt: "",
      seed: "43",
      fetchImpl: vi.fn(async () => jsonResponse({ prompt_id: "prompt-2" })),
      resolveOutput: vi.fn(async () => ({ url: "/output/edited.png" })),
      persistOutput: vi.fn(async () => ({ serverPath: "/data/characters/edited.png" })),
      makeCandidateId: () => "edited-runtime",
    });
    expect(edited).toMatchObject({ id: "edited-runtime", sourceCandidateId: sourceCandidate.id, rootCandidateId: sourceCandidate.id, editDepth: 1 });
  });
});

describe("active port-3003 CharacterHubPanel transitions", () => {
  it("edits, appends, continues to Character Card, and preserves candidates on Back", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === "/api/characters/create-image") return jsonResponse({ ok: true, promptId: "create-1", seed: 7, outputNodeId: "preview", backend: "test", modelLabel: "Ernie Image" });
      if (url.startsWith("/api/comfy/history-image?promptId=create-1")) return jsonResponse({ ok: true, url: "/output/create.png" });
      if (url === "/api/comfy") {
        const workflow = String((init?.body as FormData).get("workflowId"));
        return jsonResponse({ prompt_id: workflow === "presets/Edit Image" ? "edit-1" : "card-1" });
      }
      if (url.startsWith("/api/comfy/history-image?promptId=edit-1")) return jsonResponse({ ok: true, url: "/output/edit.png" });
      if (url.startsWith("/api/comfy/history-image?promptId=card-1")) return jsonResponse({ ok: true, url: "/output/card.png" });
      if (url.startsWith("/output/")) return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), { status: 200 });
      if (url === "/api/characters/upload") {
        const file = (init?.body as FormData).get("image") as File;
        const stem = file.name.includes("character-card") ? "card" : file.name.includes("edited") ? "edit" : "create";
        return jsonResponse({ ok: true, serverPath: `/data/characters/${stem}.png`, fileUrl: `/characters/${stem}.png` });
      }
      if (url === "/api/background-remove") return jsonResponse({ ok: true, imagePath: "/data/characters/edit-bg.png", url: "/characters/edit-bg.png" });
      return jsonResponse({ ok: true, items: [] });
    }));

    render(<CharacterHubPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Character Gallery/ }));
    fireEvent.click(screen.getByRole("button", { name: /Create Character/ }));
    fireEvent.change(screen.getByLabelText("Character Description"), { target: { value: "A full body test character" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Character" }));

    fireEvent.click(await screen.findByRole("button", { name: "Modify" }));
    fireEvent.change(screen.getByLabelText("Requested Change"), { target: { value: "Change the jacket to cobalt blue" } });
    const apply = screen.getByRole("button", { name: "Apply Edit" });
    fireEvent.click(apply);
    fireEvent.click(apply);

    const editedLabel = await screen.findByText("Ernie Image — edited");
    const editedCard = editedLabel.closest("div.overflow-hidden") as HTMLElement;
    fireEvent.click(within(editedCard).getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Character Card" }));
    expect(await screen.findByText("Processed source image")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Character Card" }));
    expect(await screen.findByAltText("Completed eight-view character card")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Candidates" }));
    expect(await screen.findByText("Ernie Image — edited")).toBeInTheDocument();

    const comfyCalls = calls.filter((call) => call.url === "/api/comfy");
    await waitFor(() => expect(comfyCalls).toHaveLength(2));
    expect(comfyCalls.map((call) => String((call.init?.body as FormData).get("workflowId")))).toEqual([
      "presets/Edit Image",
      "presets/character_card_8_angles_low_angle",
    ]);
  });
});
