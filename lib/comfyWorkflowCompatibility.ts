export type WorkflowCompatibilityResult = {
  workflow: any;
  sageAttentionEnabled: boolean;
  removedSageNodeIds: string[];
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isNodeRef(value: unknown, nodeId: string): value is [string, number] {
  return Array.isArray(value) && value.length >= 2 && String(value[0]) === nodeId && Number.isFinite(Number(value[1]));
}

function replaceNodeRefs(value: unknown, nodeId: string, replacement: [string, number]): unknown {
  if (isNodeRef(value, nodeId)) return [replacement[0], replacement[1]];
  if (Array.isArray(value)) return value.map((item) => replaceNodeRefs(item, nodeId, replacement));
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      next[key] = replaceNodeRefs(child, nodeId, replacement);
    }
    return next;
  }
  return value;
}

function sageNodeIds(workflow: Record<string, any>): string[] {
  return Object.entries(workflow)
    .filter(([, node]) => {
      const classType = String(node?.class_type || "").toLowerCase();
      return classType.includes("sageattention") || classType.includes("sage_attention");
    })
    .map(([nodeId]) => nodeId);
}

export function stripSageAttention(workflowInput: any): WorkflowCompatibilityResult {
  let workflow = deepClone(workflowInput || {});
  const removed: string[] = [];

  for (const nodeId of sageNodeIds(workflow)) {
    const node = workflow?.[nodeId];
    const modelRef = node?.inputs?.model;
    if (!Array.isArray(modelRef) || modelRef.length < 2 || !String(modelRef[0])) {
      throw new Error(`Cannot safely bypass Sage Attention node ${nodeId}: missing model input reference.`);
    }

    const replacement: [string, number] = [String(modelRef[0]), Number(modelRef[1]) || 0];
    delete workflow[nodeId];
    workflow = replaceNodeRefs(workflow, nodeId, replacement) as Record<string, any>;
    removed.push(nodeId);
  }

  return { workflow, sageAttentionEnabled: false, removedSageNodeIds: removed };
}

export function targetAllowsSageAttention(targetId?: string | null): boolean {
  const key = String(targetId || "").trim().toLowerCase();
  // Sage is opt-in only on the known RTX 3090 workstation. Unknown targets default off.
  return key.includes("3090") || key.includes("shawn");
}

export function prepareWorkflowForTarget(workflowInput: any, targetId?: string | null): WorkflowCompatibilityResult {
  const workflow = deepClone(workflowInput || {});
  if (targetAllowsSageAttention(targetId)) {
    return {
      workflow,
      sageAttentionEnabled: sageNodeIds(workflow).length > 0,
      removedSageNodeIds: [],
    };
  }
  return stripSageAttention(workflow);
}
