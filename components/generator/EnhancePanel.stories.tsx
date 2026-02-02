import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { EnhancePanel } from "./EnhancePanel";
import type { EnhanceLevel } from "../../lib/generator/types";

const meta: Meta<typeof EnhancePanel> = {
  title: "Generator/EnhancePanel",
  component: EnhancePanel,
  parameters: { layout: "fullscreen" },
};

export default meta;

export const Interactive: StoryObj<typeof EnhancePanel> = {
  render: () => {
    const [level, setLevel] = useState<EnhanceLevel>("medium");
    const [busy, setBusy] = useState(false);

    return (
      <div style={{ padding: 16, maxWidth: 520, margin: "0 auto" }}>
        <EnhancePanel
          level={level}
          onChangeLevel={setLevel}
          busy={busy}
          onEnhance={() => {
            setBusy(true);
            setTimeout(() => setBusy(false), 800);
            // Replace this with /api/enhance wiring in GeneratorApp later.
            // eslint-disable-next-line no-alert
            alert(`Enhance level: ${level}`);
          }}
        />
      </div>
    );
  },
};
