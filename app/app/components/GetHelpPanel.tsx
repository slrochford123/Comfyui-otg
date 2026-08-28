"use client";

import React, { useState } from "react";

type Props = {
  title: string;
  description: string;
  onSendToPrompt?: (text: string) => void;
  onGotoGenerate?: () => void;
};

export default function GetHelpPanel({ title, description, onSendToPrompt, onGotoGenerate }: Props) {
  const [text, setText] = useState("");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
    }
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
      <h1 className="text-3xl font-black tracking-tight text-white">{title}</h1>
      <p className="mt-3 max-w-3xl text-white/65">{description}</p>

      <div className="mt-5 space-y-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Write your notes, prompt ideas, or scene draft here."
          className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
        />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => onSendToPrompt?.(text)}
            disabled={!text.trim()}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.35),rgba(40,200,255,0.28))] px-5 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send to Prompt
          </button>
          <button
            type="button"
            onClick={onGotoGenerate}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10"
          >
            Go to Generate
          </button>
        </div>
      </div>
    </section>
  );
}
