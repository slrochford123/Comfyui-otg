import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { DurationPicker } from "./DurationPicker";
import type { Seconds } from "../../lib/generator/types";

const meta: Meta<typeof DurationPicker> = {
  title: "Generator/DurationPicker",
  component: DurationPicker,
};
export default meta;

export const Interactive: StoryObj<typeof DurationPicker> = {
  render: () => {
    const [value, setValue] = useState<Seconds>(7);
    return <div style={{ padding: 16 }}><DurationPicker value={value} onChange={setValue} /></div>;
  },
};
