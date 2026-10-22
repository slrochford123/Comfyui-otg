// Official AuK zero-shot TTS instruction. --gen_text controls duration only;
// the actual words must be present in this task-conditioning instruction.
export function aukRewriteInstruction(text: string) {
  const target = text.trim();
  if (!target) throw new Error("Rewrite Line mode requires replacement text.");
  return `Say the following with the same voice: ${JSON.stringify(target)}`;
}
