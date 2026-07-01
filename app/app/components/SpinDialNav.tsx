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
  showProduction?: boolean;
  uiMode?: "clean" | "classic";
};

type Item = {
  id: SpinTabId;
  label: string;
  disabled?: boolean;
};

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function SpinDialNav({ tab, onTab, isAdmin = false, showProduction = false, uiMode = "classic" }: Props) {
  const items: Item[] = useMemo(
    () => [
      { id: "gethelp", label: "AI Assistance" },
      { id: "generate", label: "Generate" },
      { id: "angles", label: "Angles" },
      ...(showProduction ? [{ id: "storyboard", label: "Production" } as Item] : []),
      { id: "characters", label: "Characters" },
      { id: "gallery", label: "Gallery" },
      ...(isAdmin ? [{ id: "voices", label: "Voices" } as Item] : []),
      { id: "favorites", label: "Favorites" },
      { id: "editvideo", label: "Edit Video" },
      { id: "settings", label: "Settings" },
      { id: "support", label: "Support" },
    ],
    [isAdmin, showProduction]
  );

  return (
    <nav
      className={classNames(
        "fixed inset-x-0 bottom-0 z-40 border-t px-1 backdrop-blur-md sm:px-2",
        uiMode === "clean" ? "border-white/8 bg-[#08090d]/95 py-1.5 sm:py-2" : "border-white/10 bg-black/75 py-2 sm:py-3"
      )}
    >
      <div className={classNames("mx-auto flex max-w-full overflow-x-auto overscroll-x-contain px-1 pb-1", uiMode === "clean" ? "max-w-[1480px] gap-1.5" : "max-w-[1400px] gap-2")}>
        {items.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => !item.disabled && onTab(item.id)}
              disabled={item.disabled}
              className={classNames(
                "inline-flex shrink-0 min-w-[72px] max-w-[88px] items-center justify-center rounded-full border px-2 py-2 text-center text-[11px] font-semibold leading-tight whitespace-normal transition sm:min-w-[120px] sm:max-w-none sm:px-4 sm:py-3 sm:text-base sm:whitespace-nowrap",
                uiMode === "clean" ? "rounded-[10px] sm:min-w-[104px] sm:px-3 sm:py-2 sm:text-sm" : "",
                active && uiMode === "clean"
                  ? "border-cyan-300/45 bg-cyan-400 text-slate-950 shadow-none"
                  : active
                    ? "border-cyan-400/40 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))] text-white shadow-[0_0_24px_rgba(90,160,255,0.18)]"
                    : uiMode === "clean"
                      ? "border-white/8 bg-white/[0.035] text-white/68 hover:bg-white/[0.07] hover:text-white"
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

/* OTG_SPIN_DIAL_NAV_MOBILE_COMPACT_PATCH_V1 */
