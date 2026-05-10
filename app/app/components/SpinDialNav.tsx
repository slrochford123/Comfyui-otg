"use client";

import { useMemo } from "react";

export type SpinTabId =
  | "gethelp"
  | "generate"
  | "angles"
  | "storyboard"
  | "characters"
  | "gallery"
  | "voices"
  | "favorites"
  | "editvideo"
  | "settings"
  | "support";

type Props = {
  tab: SpinTabId;
  onTab: (t: SpinTabId) => void;
  isAdmin?: boolean;
};

type Item = {
  id: SpinTabId;
  label: string;
  disabled?: boolean;
};

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function SpinDialNav({ tab, onTab, isAdmin = false }: Props) {
  const items: Item[] = useMemo(
    () => [
      { id: "gethelp", label: "AI Assistance" },
      { id: "generate", label: "Generate" },
      { id: "angles", label: "Angles" },
      { id: "storyboard", label: "Production" },
      { id: "characters", label: "Characters" },
      { id: "gallery", label: "Gallery" },
      ...(isAdmin ? [{ id: "voices", label: "Voices" } as Item] : []),
      { id: "favorites", label: "Favorites" },
      { id: "editvideo", label: "Edit Video" },
      { id: "settings", label: "Settings" },
      { id: "support", label: "Support" },
    ],
    [isAdmin]
  );

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/75 px-2 py-3 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1400px] gap-2 overflow-x-auto pb-1">
        {items.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => !item.disabled && onTab(item.id)}
              disabled={item.disabled}
              className={classNames(
                "inline-flex min-w-[120px] items-center justify-center rounded-full border px-4 py-3 text-base font-semibold whitespace-nowrap transition",
                active
                  ? "border-cyan-400/40 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))] text-white shadow-[0_0_24px_rgba(90,160,255,0.18)]"
                  : "border-white/10 bg-white/5 text-white/88 hover:bg-white/10",
                item.disabled ? "cursor-not-allowed opacity-45" : ""
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
