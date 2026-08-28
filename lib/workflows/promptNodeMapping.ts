export type PromptNodeMappingOptions = {
  positive: string;
  negative: string;
  otgMeta?: Record<string, unknown> | null;
};

function assignText(node: any, keys: string[], value: string) {
  if (!node?.inputs) return false;
  for (const key of keys) {
    if (typeof node.inputs[key] === 'string') {
      node.inputs[key] = value;
      return true;
    }
  }
  return false;
}

function setFirstStringInput(node: any, value: string) {
  if (!node?.inputs) return false;
  for (const [key, current] of Object.entries(node.inputs)) {
    if (typeof current === 'string') {
      node.inputs[key] = value;
      return true;
    }
  }
  return false;
}

function toNodeIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x) => x !== null && x !== undefined).map(String);
  if (value === null || value === undefined || value === '') return [];
  return [String(value)];
}

export function applyPromptNodeMapping(graph: any, opts: PromptNodeMappingOptions) {
  if (!graph || typeof graph !== 'object') return { positiveApplied: 0, negativeApplied: 0 };
  const nodes: Record<string, any> = graph;
  const meta = opts.otgMeta || {};
  let positiveApplied = 0;
  let negativeApplied = 0;

  const setPositiveOnNode = (id: string) => {
    const node = nodes[id];
    if (!node) return;
    const ok = assignText(node, ['text', 'prompt', 'caption', 'positive', 'positive_prompt'], opts.positive) || setFirstStringInput(node, opts.positive);
    if (ok) positiveApplied += 1;
  };

  const setNegativeOnNode = (id: string) => {
    const node = nodes[id];
    if (!node) return;
    const ok = assignText(node, ['text', 'prompt', 'caption', 'negative', 'negative_prompt'], opts.negative) || setFirstStringInput(node, opts.negative);
    if (ok) negativeApplied += 1;
  };

  const positiveIds = [
    ...toNodeIds((meta as any).promptNodeId),
    ...toNodeIds((meta as any).positiveNodeId),
    ...toNodeIds((meta as any).positiveTextNodeId),
    ...toNodeIds((meta as any).positiveTextNode),
    ...toNodeIds((meta as any).promptNodeIds),
    ...toNodeIds((meta as any).positiveNodeIds),
  ];
  const negativeIds = [
    ...toNodeIds((meta as any).negativeNodeId),
    ...toNodeIds((meta as any).negativeTextNodeId),
    ...toNodeIds((meta as any).negativeTextNode),
    ...toNodeIds((meta as any).negativeNodeIds),
  ];

  for (const id of Array.from(new Set(positiveIds))) setPositiveOnNode(id);
  for (const id of Array.from(new Set(negativeIds))) setNegativeOnNode(id);
  if (positiveApplied || negativeApplied) return { positiveApplied, negativeApplied };

  const positiveTargets = new Set<string>();
  const negativeTargets = new Set<string>();
  for (const node of Object.values(nodes) as any[]) {
    const inputs = node?.inputs;
    if (!inputs) continue;
    for (const [key, value] of Object.entries(inputs)) {
      if (!Array.isArray(value) || value.length < 2) continue;
      const sourceId = String(value[0]);
      const lower = String(key).toLowerCase();
      if (lower.includes('neg')) negativeTargets.add(sourceId);
      else if (lower.includes('pos') || lower.includes('cond') || lower.includes('conditioning')) positiveTargets.add(sourceId);
    }
  }

  for (const id of positiveTargets) setPositiveOnNode(id);
  for (const id of negativeTargets) setNegativeOnNode(id);
  if (positiveApplied || negativeApplied) return { positiveApplied, negativeApplied };

  const textLike = Object.entries(nodes)
    .map(([id, node]) => ({ id, node: node as any }))
    .filter((x) => x.node?.inputs && (typeof x.node.inputs.text === 'string' || typeof x.node.inputs.prompt === 'string'))
    .filter((x) => /textencode|cliptextencode|t5|prompt/i.test(String(x.node.class_type || '')));

  if (textLike[0]) setPositiveOnNode(textLike[0].id);
  if (textLike[1]) setNegativeOnNode(textLike[1].id);
  return { positiveApplied, negativeApplied };
}
