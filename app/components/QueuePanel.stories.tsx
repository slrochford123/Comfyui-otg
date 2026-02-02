import type { Meta, StoryObj } from "@storybook/react";
import React, { useMemo, useState } from "react";
import { QueuePanel } from "./QueuePanel";

const meta: Meta<typeof QueuePanel> = {
  title: "OTG/QueuePanel",
  component: QueuePanel,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof QueuePanel>;

function Wrapper(args: Omit<React.ComponentProps<typeof QueuePanel>,
  | "selectedPreset"
  | "setSelectedPreset"
  | "runName"
  | "setRunName"
  | "positivePrompt"
  | "setPositivePrompt"
  | "negativePrompt"
  | "setNegativePrompt"
  | "enhanceStrength"
  | "setEnhanceStrength"
  | "ratio"
  | "setRatio"
  | "size"
  | "setSize"
  | "seconds"
  | "setSeconds"
>) {
  const presets = useMemo(
    () =>
      args.presets.length
        ? args.presets
        : [
            { name: "wan-i2v", label: "Wan I2V", description: "Image → video" },
            { name: "svd", label: "Stable Video Diffusion", description: "Image → video" },
          ],
    [args.presets]
  );

  const [selectedPreset, setSelectedPreset] = useState(presets[0]?.name ?? "");
  const [runName, setRunName] = useState("Demo run");
  const [positivePrompt, setPositivePrompt] = useState(
    "cinematic lighting, high detail, sharp focus"
  );
  const [negativePrompt, setNegativePrompt] = useState("blurry, lowres");

  const [enhanceStrength, setEnhanceStrength] = useState<"small" | "medium" | "large">("medium");
  const [ratio, setRatio] = useState<"auto" | "16:9" | "9:16" | "1:1" | "4:3">("auto");
  const [size, setSize] = useState<number>(512);
  const [seconds, setSeconds] = useState<number>(10);

  return (
    <div style={{ maxWidth: 820 }}>
      <QueuePanel
        {...args}
        presets={presets}
        selectedPreset={selectedPreset}
        setSelectedPreset={setSelectedPreset}
        runName={runName}
        setRunName={setRunName}
        positivePrompt={positivePrompt}
        setPositivePrompt={setPositivePrompt}
        negativePrompt={negativePrompt}
        setNegativePrompt={setNegativePrompt}
        enhanceStrength={enhanceStrength as any}
        setEnhanceStrength={setEnhanceStrength as any}
        ratio={ratio as any}
        setRatio={setRatio as any}
        size={size}
        setSize={setSize}
        seconds={seconds}
        setSeconds={setSeconds}
      />
    </div>
  );
}

export const Default: Story = {
  render: (args) => <Wrapper {...args} />,
  args: {
    generationLocked: false,
    lockMessage: null,
    presets: [],
    canRun: true,
    sending: false,
    status: "Ready",
    runState: "idle",
    refreshWorkflows: () => {
      // Story-only no-op
      alert("Sync Workflows (storybook demo)");
    },
    generateNow: () => {
      alert("Generate (storybook demo)");
    },
  },
};

export const Locked: Story = {
  render: (args) => <Wrapper {...args} />,
  args: {
    ...Default.args,
    generationLocked: true,
    lockMessage: "Generating in progress. Please wait.",
    canRun: false,
    runState: "running",
    status: "Job running…",
  },
};

export const Sending: Story = {
  render: (args) => <Wrapper {...args} />,
  args: {
    ...Default.args,
    sending: true,
    canRun: false,
    runState: "running",
    status: "Submitting job…",
  },
};
