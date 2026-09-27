"use client";

import Image from "next/image";
import {
  useMemo,
  useState,
} from "react";

export type StoryCreatorAssetType =
  | "character"
  | "location"
  | "object"
  | "reference"
  | "character_card";

export type StoryCreatorAsset = {
  id: string;
  assetType: string;
  name: string;
  prompt: string;
  status: string;
  provider: string;
  url: string | null;
  filePath: string | null;
  jobId: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type StoryCreatorAssetCreateInput = {
  assetType: StoryCreatorAssetType;
  name: string;
  prompt: string;
  artStyle: string;
  metadata?: Record<string, unknown>;
};

type Props = {
  title?: string;
  assets: StoryCreatorAsset[];
  busy: boolean;
  loading: boolean;
  error: string;
  notice: string;
  refreshingAssetIds: string[];
  onCreateAsset: (
    input: StoryCreatorAssetCreateInput,
  ) => void;
  onRefreshAsset: (assetId: string) => void;
};

const assetTypes: {
  id: StoryCreatorAssetType;
  label: string;
}[] = [
  { id: "character", label: "Character" },
  { id: "location", label: "Location" },
  { id: "object", label: "Object" },
  { id: "reference", label: "Reference" },
  { id: "character_card", label: "Card" },
];

function statusLabel(value: string) {
  if (value === "generating") return "Generating";
  if (value === "ready") return "Ready";
  if (value === "failed") return "Failed";
  return "Planned";
}

function safeMetadataText(
  metadata: Record<string, unknown>,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function assetFailureText(asset: StoryCreatorAsset) {
  return (
    safeMetadataText(asset.metadata, "completionError") ||
    safeMetadataText(asset.metadata, "errorText")
  );
}

export function StoryAssetGrid({
  title = "Assets",
  assets,
  busy,
  loading,
  error,
  notice,
  refreshingAssetIds,
  onCreateAsset,
  onRefreshAsset,
}: Props) {
  const [assetType, setAssetType] =
    useState<StoryCreatorAssetType>("character");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [artStyle, setArtStyle] = useState(
    "cinematic story concept art, production reference, detailed but consistent",
  );
  const refreshingAssetIdSet = useMemo(
    () => new Set(refreshingAssetIds),
    [refreshingAssetIds],
  );

  function submit() {
    onCreateAsset({
      assetType,
      name,
      prompt,
      artStyle,
    });
  }

  return (
    <section className="rounded-[20px] border border-white/10 bg-white/[0.035] p-4">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
        {title}
      </p>

      <h3 className="mt-2 text-lg font-black text-white">
        Qwen Image 2.1 Asset Studio
      </h3>

      <div className="mt-4 flex flex-wrap gap-2">
        {assetTypes.map((item) => {
          const selected = item.id === assetType;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setAssetType(item.id)}
              className={
                selected
                  ? "rounded-[12px] border border-cyan-200/35 bg-cyan-300 px-3 py-2 text-xs font-black text-black"
                  : "rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-xs font-black text-white/65 hover:bg-white/[0.06]"
              }
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3">
        <label className="block">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Asset Name
          </span>

          <input
            value={name}
            onChange={(event) =>
              setName(event.target.value)
            }
            maxLength={120}
            placeholder="Name this reference"
            className="w-full rounded-[14px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-cyan-300/40"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Prompt
          </span>

          <textarea
            value={prompt}
            onChange={(event) =>
              setPrompt(event.target.value)
            }
            rows={5}
            placeholder="Describe the story reference to generate..."
            className="w-full resize-y rounded-[14px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-cyan-300/40"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Style
          </span>

          <input
            value={artStyle}
            onChange={(event) =>
              setArtStyle(event.target.value)
            }
            maxLength={200}
            className="w-full rounded-[14px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-cyan-300/40"
          />
        </label>
      </div>

      {error ? (
        <div className="mt-3 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="mt-3 rounded-[14px] border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-2 text-xs leading-5 text-cyan-50/80">
          {notice}
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="mt-4 rounded-[14px] bg-cyan-300 px-5 py-2.5 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy
          ? "Submitting..."
          : "Submit Qwen Image 2.1 job"}
      </button>

      <div className="mt-5 grid gap-2">
        {loading ? (
          <div className="rounded-[14px] border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/45">
            Loading Story assets...
          </div>
        ) : null}

        {!loading && !assets.length ? (
          <div className="rounded-[16px] border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm leading-6 text-white/50">
            Generated character references, locations, object
            designs, cards, and saved voice profiles will appear
            here.
          </div>
        ) : null}

        {assets.map((asset) => {
          const refreshing =
            refreshingAssetIdSet.has(asset.id);
          const failureText = assetFailureText(asset);

          return (
            <article
              key={asset.id}
              className="rounded-[16px] border border-white/10 bg-black/25 p-3"
            >
              <div className="grid gap-3 sm:grid-cols-[112px_minmax(0,1fr)]">
                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[12px] border border-white/10 bg-black/40">
                  {asset.status === "ready" && asset.url ? (
                    <Image
                      src={asset.url}
                      alt={asset.name || "Story asset"}
                      width={224}
                      height={224}
                      unoptimized
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="px-3 text-center text-xs font-black uppercase tracking-[0.12em] text-white/45">
                      {asset.status === "failed"
                        ? "Failed"
                        : refreshing
                          ? "Checking result..."
                          : asset.status === "generating"
                            ? "Generating..."
                            : "Planned"}
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-black text-white">
                        {asset.name}
                      </div>

                      <div className="mt-1 text-xs text-white/45">
                        {asset.assetType} | {asset.provider || "Story Creator"}
                      </div>
                    </div>

                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black uppercase text-white/55">
                      {statusLabel(asset.status)}
                    </span>
                  </div>

                  {asset.prompt ? (
                    <p className="mt-3 line-clamp-3 text-xs leading-5 text-white/55">
                      {asset.prompt}
                    </p>
                  ) : null}

                  {asset.jobId ? (
                    <div className="mt-2 break-all text-[11px] text-cyan-100/55">
                      Prompt {asset.jobId}
                    </div>
                  ) : null}

                  {failureText ? (
                    <div className="mt-2 rounded-[10px] border border-red-400/15 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/75">
                      {failureText}
                    </div>
                  ) : null}

                  {asset.status === "generating" ||
                  asset.status === "failed" ? (
                    <button
                      type="button"
                      disabled={refreshing}
                      onClick={() => onRefreshAsset(asset.id)}
                      className="mt-3 rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-white/70 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {refreshing ? "Checking..." : "Refresh Status"}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
