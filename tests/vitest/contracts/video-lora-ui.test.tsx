// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import fs from "node:fs";
import path from "node:path";
import React, { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VideoLoraPanel, {
  appendUniqueVideoLoraTriggerWords,
  shouldShowVideoLoraPanel,
  type VideoLoraSelectionValue,
} from "@/app/app/components/VideoLoraPanel";
import { VIDEO_GENERATE_WORKFLOWS } from "@/lib/videoGenerateWorkflows";

type EntryOptions = {
  id?: string;
  family?: "wan" | "ltx";
  displayName?: string;
  triggerWords?: string[];
  selectable?: boolean;
  installed?: boolean;
  compatibilityReason?: string | null;
};

function entry(options: EntryOptions = {}) {
  return {
    id: options.id || "omnicine",
    displayName: options.displayName || "Singularity LTX 2.3 OmniCine V1",
    family: options.family || "ltx",
    baseModelVariant: options.family === "wan" ? "Wan 2.2" : "LTX 2.3",
    supportedModes: ["text_to_video", "image_to_video", "first_last_frame"],
    description: "Cinematic consistency and motion.",
    triggerWords: options.triggerWords ?? ["No Subtitles"],
    recommendedStrength: 0.8,
    defaultStrength: 0.8,
    allowedRange: { minimum: 0, maximum: 2 },
    promptExample: "A cinematic example prompt.",
    dependencies: ["Compatible base model."],
    limitations: ["Use only with supported modes."],
    license: "Verify creator terms before commercial use.",
    commercialUse: "unverified",
    installedState: { rtx3090: { installed: options.installed ?? true, inventoryAvailable: true } },
    selectable: options.selectable ?? true,
    compatibilityReason: options.compatibilityReason ?? null,
  };
}

function mockCatalog(entries: ReturnType<typeof entry>[], compatibleEntries = entries.filter((item) => item.selectable)) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    ok: true,
    selectedBackend: { id: "rtx3090", label: "RTX 3090", gpu: "RTX 3090" },
    entries,
    compatibleEntries,
  }), { status: 200 })));
}

function Harness({
  entries,
  initialSelections = [],
  initialPrompt = "",
  family = "ltx",
  workflowId = "presets/Create a Video",
}: {
  entries: ReturnType<typeof entry>[];
  initialSelections?: VideoLoraSelectionValue[];
  initialPrompt?: string;
  family?: "wan" | "ltx";
  workflowId?: string;
}) {
  const [selections, setSelections] = useState(initialSelections);
  const [prompt, setPrompt] = useState(initialPrompt);
  mockCatalog(entries);
  return <>
    <output data-testid="prompt">{prompt}</output>
    <VideoLoraPanel workflowId={workflowId} family={family} value={selections} onChange={setSelections} prompt={prompt} onPromptChange={setPrompt} />
  </>;
}

afterEach(() => vi.unstubAllGlobals());

describe("Video LoRA trigger-word behavior", () => {
  it("adds trigger words for one selected LoRA and preserves existing prompt text", async () => {
    const first = entry();
    render(<Harness entries={[first]} initialSelections={[{ id: first.id, strength: 0.8 }]} initialPrompt="A detective walks through rain" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add trigger words" }));
    expect(screen.getByTestId("prompt")).toHaveTextContent("A detective walks through rain, No Subtitles");
    expect(screen.getByText("Trigger words added")).toBeInTheDocument();
  });

  it("collects unique trigger words from two selected LoRAs", async () => {
    const first = entry({ id: "one", triggerWords: ["No Subtitles"] });
    const second = entry({ id: "two", displayName: "Hard Cut", triggerWords: ["cinematic hard cut to", "No Subtitles"] });
    render(<Harness entries={[first, second]} initialSelections={[{ id: "one", strength: 0.8 }, { id: "two", strength: 0.2 }]} initialPrompt="Opening shot" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add trigger words" }));
    expect(screen.getByTestId("prompt")).toHaveTextContent("Opening shot, No Subtitles, cinematic hard cut to");
  });

  it("does not add duplicate trigger words and compares case-insensitively", () => {
    expect(appendUniqueVideoLoraTriggerWords("Scene, No Subtitles", ["No Subtitles"]).status).toBe("already_present");
    const result = appendUniqueVideoLoraTriggerWords("Scene, NO SUBTITLES", ["no subtitles", "cinematic hard cut to"]);
    expect(result.prompt).toBe("Scene, NO SUBTITLES, cinematic hard cut to");
    expect(result.prompt.match(/no subtitles/gi)).toHaveLength(1);
  });

  it("reports when every trigger word is already present", async () => {
    const first = entry();
    render(<Harness entries={[first]} initialSelections={[{ id: first.id, strength: 0.8 }]} initialPrompt="Scene, NO SUBTITLES" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add trigger words" }));
    expect(screen.getByTestId("prompt")).toHaveTextContent("Scene, NO SUBTITLES");
    expect(screen.getByText("Trigger words already present")).toBeInTheDocument();
  });

  it("disables aggregate trigger action for an empty trigger list", async () => {
    const first = entry({ triggerWords: [] });
    render(<Harness entries={[first]} initialSelections={[{ id: first.id, strength: 0.8 }]} />);
    expect(await screen.findByRole("button", { name: "Add trigger words" })).toBeDisabled();
  });

  it("adds only the selected entry's words through the individual Add trigger action", async () => {
    const first = entry({ id: "one", triggerWords: ["first trigger"] });
    const second = entry({ id: "two", displayName: "Hard Cut", triggerWords: ["second trigger"] });
    render(<Harness entries={[first, second]} initialSelections={[{ id: "one", strength: 0.8 }, { id: "two", strength: 0.2 }]} initialPrompt="Scene" />);
    const firstCard = (await screen.findByText(first.displayName)).closest("article");
    expect(firstCard).not.toBeNull();
    fireEvent.click(within(firstCard as HTMLElement).getByText("How to use"));
    fireEvent.click(within(firstCard as HTMLElement).getByRole("button", { name: "Add trigger" }));
    expect(screen.getByTestId("prompt")).toHaveTextContent("Scene, first trigger");
    expect(screen.getByTestId("prompt")).not.toHaveTextContent("second trigger");
  });

  it("does not mutate the prompt when a LoRA is selected", async () => {
    const first = entry();
    render(<Harness entries={[first]} initialPrompt="Original prompt" />);
    fireEvent.click(await screen.findByRole("button", { name: "Select" }));
    await waitFor(() => expect(screen.getByText("1 of 2 selected. Internal workflow LoRAs stay active and are not listed.")).toBeInTheDocument());
    expect(screen.getByTestId("prompt")).toHaveTextContent("Original prompt");
  });
});


describe("Video LoRA individual collapse behavior", () => {
  it("starts unselected LoRAs collapsed and expands cards independently", async () => {
    const first = entry({ id: "first", displayName: "First LoRA" });
    const second = entry({ id: "second", displayName: "Second LoRA" });
    render(<Harness entries={[first, second]} />);

    const firstCard = (await screen.findByText(first.displayName)).closest("article") as HTMLElement;
    const secondCard = screen.getByText(second.displayName).closest("article") as HTMLElement;

    expect(within(firstCard).queryByText(first.description)).not.toBeInTheDocument();
    expect(within(secondCard).queryByText(second.description)).not.toBeInTheDocument();

    fireEvent.click(within(firstCard).getByRole("button", { name: `Expand ${first.displayName}` }));

    expect(within(firstCard).getByText(first.description)).toBeInTheDocument();
    expect(within(firstCard).getByRole("button", { name: `Collapse ${first.displayName}` })).toHaveAttribute("aria-expanded", "true");
    expect(within(secondCard).queryByText(second.description)).not.toBeInTheDocument();
  });

  it("can collapse an expanded LoRA without changing its selection", async () => {
    const first = entry();
    render(<Harness entries={[first]} initialSelections={[{ id: first.id, strength: 0.8 }]} />);

    const card = (await screen.findByText(first.displayName)).closest("article") as HTMLElement;
    expect(within(card).getByLabelText(`${first.displayName} strength`)).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: `Collapse ${first.displayName}` }));

    expect(within(card).queryByLabelText(`${first.displayName} strength`)).not.toBeInTheDocument();
    expect(within(card).getByText("Selected")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("automatically expands a LoRA when it is selected", async () => {
    const first = entry();
    render(<Harness entries={[first]} />);

    const card = (await screen.findByText(first.displayName)).closest("article") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Select" }));

    await waitFor(() => expect(within(card).getByLabelText(`${first.displayName} strength`)).toBeInTheDocument());
    expect(within(card).getByRole("button", { name: `Collapse ${first.displayName}` })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("Video LoRA Generate-page visibility and catalog states", () => {
  it("is hidden for image and unsupported video families", () => {
    expect(shouldShowVideoLoraPanel("image", "wan")).toBe(false);
    expect(shouldShowVideoLoraPanel("video", "hunyuan")).toBe(false);
    expect(shouldShowVideoLoraPanel("video", null)).toBe(false);
  });

  it("is visible for every exposed Wan and LTX workflow", () => {
    expect(VIDEO_GENERATE_WORKFLOWS).toHaveLength(9);
    for (const workflow of VIDEO_GENERATE_WORKFLOWS) {
      const family = workflow.modelId === "wan22" ? "wan" : "ltx";
      expect(shouldShowVideoLoraPanel("video", family), workflow.workflowId).toBe(true);
    }
  });

  it("keeps the Wan panel visible with the approved-catalog empty message", async () => {
    mockCatalog([], []);
    render(<VideoLoraPanel workflowId="presets/WAN 2.2 T2V GGUF" family="wan" value={[]} onChange={vi.fn()} prompt="" onPromptChange={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Video LoRAs" })).toBeInTheDocument();
    expect(screen.getByText("No approved Wan LoRAs are currently available. Installed files must be added to the compatibility catalog before use.")).toBeInTheDocument();
  });

  it("keeps active LTX entries selectable and metadata-pending entries visible but disabled", async () => {
    const active = entry();
    const pending = entry({ id: "camera-controls", displayName: "Camera Controls [LTX-2.3]", selectable: false, compatibilityReason: "Catalog metadata is incomplete; this LoRA is not selectable." });
    mockCatalog([active, pending], [active]);
    render(<VideoLoraPanel workflowId="presets/Create a Video" family="ltx" value={[]} onChange={vi.fn()} prompt="" onPromptChange={vi.fn()} />);
    const activeCard = (await screen.findByText(active.displayName)).closest("article") as HTMLElement;
    const pendingCard = screen.getByText(pending.displayName).closest("article") as HTMLElement;
    expect(within(activeCard).getByRole("button", { name: "Select" })).toBeEnabled();
    expect(within(pendingCard).getByRole("button", { name: "Select" })).toBeDisabled();
    fireEvent.click(within(pendingCard).getByRole("button", { name: `Expand ${pending.displayName}` }));
    expect(within(pendingCard).getByText("Catalog metadata is incomplete; this LoRA is not selectable.")).toBeInTheDocument();
  });

  it("renders count, search, clear-all, and enforces the existing maximum-two rule", async () => {
    const entries = [1, 2, 3].map((number) => entry({ id: `lora-${number}`, displayName: `LoRA ${number}` }));
    render(<Harness entries={entries} initialSelections={[{ id: "lora-1", strength: 0.8 }, { id: "lora-2", strength: 0.8 }]} />);
    expect(await screen.findByText("2 of 2 selected. Internal workflow LoRAs stay active and are not listed.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search compatible Video LoRAs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
    const thirdCard = (
      await screen.findByText("LoRA 3")
    ).closest("article") as HTMLElement;

    expect(thirdCard).not.toBeNull();

    expect(
      within(thirdCard).getByRole("button", {
        name: "Select",
      }),
    ).toBeDisabled();
  });

  it("retains Wan unified and separate high/low strength controls", async () => {
    const wan = entry({ id: "wan-style", family: "wan", displayName: "Wan Test Style", triggerWords: [] });
    render(<Harness entries={[wan]} family="wan" workflowId="presets/WAN 2.2 T2V SafeTensor" initialSelections={[{ id: wan.id, strength: 0.8 }]} />);
    const checkbox = await screen.findByRole("checkbox", { name: "Use same strength for high and low noise" });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(screen.getByText("High Noise")).toBeInTheDocument();
    expect(screen.getByText("Low Noise")).toBeInTheDocument();
  });

  it("uses responsive grids and no fixed viewport width", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/app/components/VideoLoraPanel.tsx"), "utf8");
    expect(source).toContain('className="grid gap-3 sm:grid-cols-2"');
    expect(source).toContain("min-w-0");
    expect(source).not.toMatch(/w-\[(?:[4-9]\d\d|\d{4,})px\]/);
  });
});

describe("Video LoRA request payload contract", () => {
  it("still submits selected strengths without a separate trigger-word payload", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/app/AppPageClient.tsx"), "utf8");
    expect(source).toContain('body.set("videoLoras", JSON.stringify(selectedVideoLoras.slice(0, 2)))');
    expect(source).not.toMatch(/body\.set\(["'](?:videoLora)?triggerWords/i);
    expect(source).toContain("prompt={prompt}");
    expect(source).toContain("onPromptChange={setPrompt}");
  });
});
