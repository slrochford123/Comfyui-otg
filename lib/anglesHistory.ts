export type AnglesHistoryFile = {
  filename: string;
  subfolder?: string;
  type?: string;
};

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(?:$|\?)/i;

export function extractAnglesHistoryFiles(value: unknown): AnglesHistoryFile[] {
  const files: AnglesHistoryFile[] = [];
  const seen = new Set<string>();

  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }

    if (!candidate || typeof candidate !== "object") return;

    const record = candidate as Record<string, unknown>;
    const filename = typeof record.filename === "string" ? record.filename : "";

    if (filename && IMAGE_EXT_RE.test(filename)) {
      const file: AnglesHistoryFile = {
        filename,
        subfolder: typeof record.subfolder === "string" ? record.subfolder : "",
        type: typeof record.type === "string" ? record.type : "output",
      };
      const key = `${file.type}|${file.subfolder}|${file.filename}`;

      if (!seen.has(key)) {
        seen.add(key);
        files.push(file);
      }
    }

    for (const nested of Object.values(record)) visit(nested);
  };

  visit(value);
  return files;
}

function pickPreferredFile(files: AnglesHistoryFile[], expectedBase: string) {
  if (!files.length) return null;

  const byPrefix = files.find((file) => file.filename.startsWith(expectedBase));
  if (byPrefix) return byPrefix;

  const outputFile = files.find((file) => (file.type || "output") === "output");
  return outputFile || files[0];
}

export function selectAnglesGeneratedOutput(
  historyRecord: unknown,
  outputNodeId: string,
  expectedBase: string
) {
  const record =
    historyRecord && typeof historyRecord === "object"
      ? (historyRecord as Record<string, unknown>)
      : {};
  const outputs =
    record.outputs && typeof record.outputs === "object"
      ? (record.outputs as Record<string, unknown>)
      : {};

  const outputNodeFiles = extractAnglesHistoryFiles(outputs[outputNodeId]);
  const allFiles = extractAnglesHistoryFiles(outputs);

  return {
    imageFile: pickPreferredFile(outputNodeFiles, expectedBase),
    outputNodeFiles,
    allFiles,
  };
}
