import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { GeneratorScreen } from "./GeneratorScreen";
import { useGeneratorState } from "../../lib/generator/useGeneratorState";

const meta: Meta<typeof GeneratorScreen> = {
  title: "Generator/GeneratorScreen",
  component: GeneratorScreen,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof GeneratorScreen>;

export const Interactive: Story = {
  render: () => {
    const [state, dispatch] = useGeneratorState();
    return <GeneratorScreen state={state} dispatch={dispatch} />;
  },
};
