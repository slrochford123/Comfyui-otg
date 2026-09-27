"use client";

export function CharacterDesignPanel() {
  return (
    <section className="rounded-[20px] border border-white/10 bg-white/[0.035] p-4">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
        Characters
      </p>

      <h3 className="mt-2 text-lg font-black text-white">
        Character Design
      </h3>

      <p className="mt-2 text-sm leading-6 text-white/55">
        Character, card, and reference prompts are submitted through
        the Story Asset Grid with Qwen Image 2.1. Dedicated story
        workflow files now live under the Story Creator workflow
        bundle for Qwen Image 2.1 and Qwen Image Edit 2.1 handoff.
      </p>
    </section>
  );
}
