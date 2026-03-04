/* eslint-disable @typescript-eslint/no-explicit-any */

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function findPromptLineNodeId(workflow: any): string | null {
  // Heuristics:
  // 1) class_type contains 'PromptLine'
  // 2) _meta.title contains 'promptLine'
  // 3) inputs has key 'prompt' and node seems like a string passthrough
  for (const [id, node] of Object.entries<any>(workflow || {})) {
    const ct = String(node?.class_type || "");
    const title = String(node?._meta?.title || node?._meta?.name || "");
    const inputs = node?.inputs || {};
    if (/promptline/i.test(ct)) return id;
    if (/promptline/i.test(title)) return id;
    if (typeof inputs?.prompt === "string" && /prompt/i.test(title)) return id;
  }
  // fallback: first node that has inputs.prompt
  for (const [id, node] of Object.entries<any>(workflow || {})) {
    if (node?.inputs && typeof node.inputs.prompt === "string") return id;
  }
  return null;
}

export function findNegativeTextNodeId(workflow: any): string | null {
  // Heuristics:
  // 1) meta title includes 'negative'
  // 2) inputs.text exists and looks like a negative prompt list
  for (const [id, node] of Object.entries<any>(workflow || {})) {
    const title = String(node?._meta?.title || node?._meta?.name || "");
    const inputs = node?.inputs || {};
    if (typeof inputs?.text !== "string") continue;
    if (/negative/i.test(title)) return id;
    const t = inputs.text.toLowerCase();
    if (t.includes("worst quality") || t.includes("extra limbs") || t.includes("watermark")) return id;
  }
  return null;
}

export function setWorkflowPrompt(workflow: any, promptText: string): { promptNodeId: string | null } {
  const pid = findPromptLineNodeId(workflow);
  if (pid && workflow[pid]?.inputs) {
    workflow[pid].inputs.prompt = promptText;
  }
  return { promptNodeId: pid };
}

export function setWorkflowNegative(workflow: any, negativeText: string): { negativeNodeId: string | null } {
  const nid = findNegativeTextNodeId(workflow);
  if (nid && workflow[nid]?.inputs) {
    workflow[nid].inputs.text = negativeText;
  }
  return { negativeNodeId: nid };
}
