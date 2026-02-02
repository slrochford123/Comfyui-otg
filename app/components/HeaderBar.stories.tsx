import type { Meta, StoryObj } from "@storybook/nextjs";

import React from "react";
import HeaderBar from "./HeaderBar";

const meta: Meta<typeof HeaderBar> = {
  title: "OTG/HeaderBar",
  component: HeaderBar,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof HeaderBar>;

export const Connected: Story = {
  args: { isConnected: true },
};

export const Disconnected: Story = {
  args: { isConnected: false },
};

export const Unknown: Story = {
  args: { isConnected: null },
};
