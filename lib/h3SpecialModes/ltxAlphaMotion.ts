export const H3_LTX_ALPHA_GENERATOR_ID = "ltx-2.5-alpha-gen" as const;
export const H3_LTX_ALPHA_WORKFLOW_FILE = "LTX 2.5 Alpha Gen Beta.json";

export const H3_LTX_ALPHA_REQUIRED_NODE_CLASSES = [
  "VHS_LoadVideo",
  "VHS_VideoCombine",
  "CreateVideo",
  "ImageCompositeMasked",
  "b7c1e94a-3f52-4d08-9a61-2e7c5d4f8a13",
  "bee43e38-9234-4e41-86ff-63874164f482",
  "c28230e9-b195-4ec2-9679-39e1e920f733",
  "c4a8f261-5b93-4e17-8d2a-6f01b3e97c45",
  "d92e6f38-7a14-4c85-b3e0-9f52a1d68b74",
  "f9337bd7-ca7a-4a59-99f1-65b664bed7e7",
] as const;

type ObjectInfo = Record<string, unknown>;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function abortAfter(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
  const timeout = abortAfter(timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: timeout.signal });
    if (!response.ok) return null;
    return await response.json().catch(() => null) as T | null;
  } finally {
    timeout.cancel();
  }
}

export async function inspectH3LtxAlphaCompatibility(baseUrl: string) {
  const base = clean(baseUrl).replace(/\/+$/, "");
  if (!base) {
    return {
      compatible: false,
      missingNodes: [...H3_LTX_ALPHA_REQUIRED_NODE_CLASSES],
      missingAssets: [] as string[],
      workflowFile: H3_LTX_ALPHA_WORKFLOW_FILE,
    };
  }
  const entries = await Promise.all(
    H3_LTX_ALPHA_REQUIRED_NODE_CLASSES.map(async (node) => {
      const payload = await fetchJson<ObjectInfo>(`${base}/object_info/${encodeURIComponent(node)}`);
      return [node, payload?.[node] ? true : false] as const;
    }),
  );
  const missingNodes = entries.flatMap(([node, present]) => present ? [] : [node]);
  return {
    compatible: missingNodes.length === 0,
    missingNodes,
    missingAssets: [] as string[],
    workflowFile: H3_LTX_ALPHA_WORKFLOW_FILE,
  };
}

export async function assertH3LtxAlphaAvailable(baseUrl: string) {
  const compatibility = await inspectH3LtxAlphaCompatibility(baseUrl);
  if (!compatibility.compatible) {
    throw new Error(
      `LTX 2.5 Alpha Generation is unavailable on this backend. Missing nodes: ${compatibility.missingNodes.join(", ") || "none"}.`,
    );
  }
  return compatibility;
}
