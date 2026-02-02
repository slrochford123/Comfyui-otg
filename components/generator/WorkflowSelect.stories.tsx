import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { WorkflowSelect } from "./WorkflowSelect";

const meta: Meta<typeof WorkflowSelect> = {
  title: "Generator/WorkflowSelect",
  component: WorkflowSelect,
};
export default meta;

type Story = StoryObj<typeof WorkflowSelect>;

export const Interactive: Story = {
  render: () => {
    const [v, setV] = useState("Text To Video");
    return (
      <WorkflowSelect
        workflows={[
          { id: "Text To Video", label: "Text To Video", type: "t2v" },
          { id: "Image To Video", label: "Image To Video", type: "i2v" },
          { id: "SVD", label: "SVD", type: "i2v" },
        ]}
        value={v}
        onChange={setV}
        onSync={() => alert("Sync clicked (storybook)")}
      />
    );
  },
};
