import type { ResolvedH3OptionalLora } from "@/lib/h3LoraCatalogServer";

type H3LoraGraphNode = {
  class_type?: string;
  inputs?: Record<string, any>;
  _meta?: Record<string, unknown>;
};

export function applyH3OptionalLoraChainBeforeConsumer(
  graph: Record<string, H3LoraGraphNode>,
  consumerNodeId: string,
  optionalLoras: readonly ResolvedH3OptionalLora[] | undefined,
  nodeIdStart: number,
  context: string,
) {
  const selected = optionalLoras || [];
  if (!selected.length) return;

  const consumer = graph[consumerNodeId];
  if (!consumer) {
    throw new Error(
      `${context} model consumer node ${consumerNodeId} is missing.`,
    );
  }

  consumer.inputs ||= {};

  const currentModel = consumer.inputs.model;
  if (!Array.isArray(currentModel) || currentModel.length < 1) {
    throw new Error(
      `${context} model consumer node ${consumerNodeId} has no model input.`,
    );
  }

  let previousNodeId = String(currentModel[0]);
  let previousOutput = Number(currentModel[1]) || 0;

  selected.forEach((lora, index) => {
    const nodeId = String(nodeIdStart + index);

    if (graph[nodeId]) {
      throw new Error(
        `${context} optional LoRA node ${nodeId} collides with the workflow template.`,
      );
    }

    graph[nodeId] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: [previousNodeId, previousOutput],
        lora_name: lora.filename,
        strength_model: lora.strength,
      },
      _meta: {
        title: `OTG H3 ${lora.label} LoRA`,
      },
    };

    previousNodeId = nodeId;
    previousOutput = 0;
  });

  consumer.inputs.model = [previousNodeId, 0];
}
