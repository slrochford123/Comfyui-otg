import type { Meta, StoryObj } from "@storybook/react";
import { GeneratorPanel } from "./GeneratorPanel";

const meta: Meta<typeof GeneratorPanel> = {
  title: "OTG/Generator/GeneratorPanel",
  component: GeneratorPanel,
};

export default meta;

type Story = StoryObj<typeof GeneratorPanel>;

export const Default: Story = {
  args: {},
};
