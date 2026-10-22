export async function readStoryDirectorStream(
  response: Response,
  onDelta: (text: string) => void,
) {
  if (!response.body) {
    throw new Error("Story Director returned an empty stream.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let completedText = "";

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type?: string;
      delta?: string;
      text?: string;
      error?: string;
    };
    if (event.type === "delta" && event.delta) {
      accumulated += event.delta;
      onDelta(accumulated);
    } else if (event.type === "done") {
      completedText = String(event.text || accumulated).trim();
      onDelta(completedText);
    } else if (event.type === "error") {
      throw new Error(event.error || "Story Director streaming was interrupted.");
    }
  };

  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value || new Uint8Array(), {
      stream: !chunk.done,
    });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) consumeLine(line);
    if (chunk.done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  if (!completedText) {
    throw new Error("Story Director stream ended before completion.");
  }
  return completedText;
}
