import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { VideoProfilePicker } from "./VideoProfilePicker";
import type { Ratio, Size } from "../../lib/generator/types";

const meta: Meta<typeof VideoProfilePicker> = {
  title: "Generator/VideoProfilePicker",
  component: VideoProfilePicker,
};
export default meta;

type Story = StoryObj<typeof VideoProfilePicker>;

export const Interactive: Story = {
  render: () => {
    const [ratio, setRatio] = useState<Ratio>("auto");
    const [size, setSize] = useState<Size>(512);

    return (
      <div style={{ maxWidth: 420, margin: 16 }}>
        <VideoProfilePicker
          ratio={ratio}
          size={size}
          onChangeRatio={setRatio}
          onChangeSize={setSize}
        />
      </div>
    );
  },
};
