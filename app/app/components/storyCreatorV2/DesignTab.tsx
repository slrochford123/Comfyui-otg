"use client";

import {
  useMemo,
  useState,
} from "react";

import { CharacterDesignPanel } from "./CharacterDesignPanel";
import {
  StoryAssetGrid,
  type StoryCreatorAsset,
  type StoryCreatorAssetCreateInput,
} from "./StoryAssetGrid";
import { VoiceDesignPanel } from "./VoiceDesignPanel";

type VoiceProfileInput = {
  name: string;
  sampleText: string;
  direction: string;
};

type StoryBibleEntity = {
  id: string;
  projectId: string;
  entityType: string;
  name: string;
  sourceRole: "user" | "assistant" | "system";
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
};

type StoryBibleFact = {
  id: string;
  projectId: string;
  subjectEntityId: string | null;
  predicate: string;
  valueText: string;
  objectEntityId: string | null;
  canonStatus: "canon" | "suggestion" | "unknown";
  sourceRole: "user" | "assistant" | "system";
  sourceMessageId: string | null;
  supersedesFactId: string | null;
  createdAt: number;
  updatedAt: number;
};

type StoryDesignContext = {
  entity: StoryBibleEntity;
  entityKind: "character" | "location" | "object";
  authoritativeFacts: StoryBibleFact[];
  relatedEntities: StoryBibleEntity[];
  relatedFacts: StoryBibleFact[];
  readyAssets: StoryCreatorAsset[];
  unapprovedHints: StoryBibleFact[];
  userInstruction: string;
  knowledgeSummary: string[];
  prompt: string;
  provenance: Record<string, unknown>;
};

type Props = {
  entities: StoryBibleEntity[];
  assetsLabel: string;
  assets: StoryCreatorAsset[];
  assetsLoading: boolean;
  assetBusy: boolean;
  assetError: string;
  assetNotice: string;
  refreshingAssetIds: string[];
  onCreateAsset: (
    input: StoryCreatorAssetCreateInput,
  ) => void;
  onRefreshAsset: (assetId: string) => void;
  onSaveVoiceProfile: (input: VoiceProfileInput) => void;
  onLoadDesignContext: (
    input: {
      entityId: string;
      userInstruction: string;
    },
  ) => Promise<StoryDesignContext>;
  onGenerateFromStory: (
    input: {
      context: StoryDesignContext;
      userInstruction: string;
    },
  ) => Promise<void>;
};

const designAreas = [
  {
    title: "Locations",
    body: "Location references use the same Qwen Image 2.1 asset route and are packaged separately in production exports.",
  },
  {
    title: "Character Cards",
    body: "Character card handoff uses the Story Creator Qwen Image Edit 2.1 workflow bundle and the existing card-builder route patterns.",
  },
] as const;

export function DesignTab({
  entities,
  assetsLabel,
  assets,
  assetsLoading,
  assetBusy,
  assetError,
  assetNotice,
  refreshingAssetIds,
  onCreateAsset,
  onRefreshAsset,
  onSaveVoiceProfile,
  onLoadDesignContext,
  onGenerateFromStory,
}: Props) {
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [designDirection, setDesignDirection] = useState("");
  const [designContext, setDesignContext] =
    useState<StoryDesignContext | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextError, setContextError] = useState("");

  const designEntities = useMemo(
    () =>
      entities.filter((entity) => {
        const type = entity.entityType.toLowerCase();
        return (
          type.includes("character") ||
          type.includes("person") ||
          type.includes("location") ||
          type.includes("environment") ||
          type.includes("place") ||
          type.includes("setting") ||
          type.includes("object") ||
          type.includes("prop") ||
          type.includes("item")
        );
      }),
    [entities],
  );
  const characterEntities = designEntities.filter((entity) => {
    const type = entity.entityType.toLowerCase();
    return type.includes("character") || type.includes("person");
  });
  const locationEntities = designEntities.filter((entity) => {
    const type = entity.entityType.toLowerCase();
    return (
      type.includes("location") ||
      type.includes("environment") ||
      type.includes("place") ||
      type.includes("setting")
    );
  });
  const objectEntities = designEntities.filter((entity) => {
    const type = entity.entityType.toLowerCase();
    return (
      type.includes("object") ||
      type.includes("prop") ||
      type.includes("item")
    );
  });

  async function loadContext(entityId = selectedEntityId) {
    if (!entityId || contextBusy) return null;

    setContextBusy(true);
    setContextError("");

    try {
      const context = await onLoadDesignContext({
        entityId,
        userInstruction: designDirection,
      });
      setDesignContext(context);
      return context;
    } catch (error) {
      setContextError(
        error instanceof Error
          ? error.message
          : "Could not load Story design context.",
      );
      return null;
    } finally {
      setContextBusy(false);
    }
  }

  async function generateFromStory() {
    if (!selectedEntityId || assetBusy || contextBusy) return;

    const context =
      designContext?.entity.id === selectedEntityId &&
      designContext.userInstruction === designDirection
        ? designContext
        : await loadContext(selectedEntityId);
    if (!context) return;

    await onGenerateFromStory({
      context,
      userInstruction: designDirection,
    });
  }

  function renderEntityButtons(
    title: string,
    items: StoryBibleEntity[],
  ) {
    return (
      <div>
        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white/38">
          {title}
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {items.length ? (
            items.map((entity) => {
              const selected = entity.id === selectedEntityId;
              return (
                <button
                  key={entity.id}
                  type="button"
                  onClick={() => {
                    setSelectedEntityId(entity.id);
                    setDesignContext(null);
                  }}
                  className={
                    selected
                      ? "rounded-[12px] border border-cyan-200/35 bg-cyan-300 px-3 py-2 text-xs font-black text-black"
                      : "rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-xs font-black text-white/65 hover:bg-white/[0.06]"
                  }
                >
                  {entity.name}
                </button>
              );
            })
          ) : (
            <span className="text-xs text-white/35">
              None yet
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <CharacterDesignPanel />

      <section className="rounded-[20px] border border-cyan-300/15 bg-cyan-300/[0.04] p-4 xl:col-span-2">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/60">
          Story-Aware Design
        </p>

        <h3 className="mt-2 text-lg font-black text-white">
          Generate From Story
        </h3>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-4">
            {renderEntityButtons("Characters", characterEntities)}
            {renderEntityButtons(
              "Locations / Environments",
              locationEntities,
            )}
            {renderEntityButtons("Objects", objectEntities)}

            <label className="block">
              <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
                Design Direction
              </span>

              <textarea
                value={designDirection}
                onChange={(event) => {
                  setDesignDirection(event.target.value);
                  setDesignContext(null);
                }}
                rows={4}
                placeholder="Temporary visual direction for this generation only..."
                className="w-full resize-y rounded-[14px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-cyan-300/40"
              />
            </label>

            {contextError ? (
              <div className="rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
                {contextError}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!selectedEntityId || contextBusy}
                onClick={() => void loadContext()}
                className="rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-black text-white/70 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {contextBusy ? "Loading..." : "Preview Context"}
              </button>

              <button
                type="button"
                disabled={
                  !selectedEntityId || contextBusy || assetBusy
                }
                onClick={() => void generateFromStory()}
                className="rounded-[14px] bg-cyan-300 px-4 py-2.5 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {assetBusy
                  ? "Generating..."
                  : "Generate From Story"}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-[16px] border border-white/10 bg-black/25 p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
                Known Visual Details
              </div>
              <div className="mt-2 space-y-1 text-sm leading-6 text-white/68">
                {designContext?.authoritativeFacts.length ? (
                  designContext.authoritativeFacts.map((fact) => (
                    <div key={fact.id}>
                      {fact.predicate}: {fact.valueText}
                    </div>
                  ))
                ) : (
                  <div className="text-white/38">
                    Select an entity and preview context.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[16px] border border-white/10 bg-black/25 p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
                Relevant Story Context
              </div>
              <div className="mt-2 space-y-1 text-sm leading-6 text-white/68">
                {designContext?.knowledgeSummary.length ? (
                  designContext.knowledgeSummary.map((line) => (
                    <div key={line}>{line}</div>
                  ))
                ) : (
                  <div className="text-white/38">
                    Approved canon and related context will appear
                    here.
                  </div>
                )}
              </div>
            </div>

            {designContext?.relatedEntities.length ? (
              <div className="rounded-[16px] border border-white/10 bg-black/25 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
                  Related Environment
                </div>
                <div className="mt-2 text-sm leading-6 text-white/68">
                  {designContext.relatedEntities
                    .map((entity) => entity.name)
                    .join(", ")}
                </div>
              </div>
            ) : null}

            {designContext?.readyAssets.length ? (
              <div className="rounded-[16px] border border-white/10 bg-black/25 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
                  Existing Story Assets
                </div>
                <div className="mt-2 text-sm leading-6 text-white/68">
                  {designContext.readyAssets
                    .map((asset) => asset.name)
                    .join(", ")}
                </div>
              </div>
            ) : null}

            {designContext?.unapprovedHints.length ? (
              <div className="rounded-[16px] border border-yellow-200/15 bg-yellow-200/[0.06] p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-yellow-50/55">
                  Unapproved Hints
                </div>
                <div className="mt-2 space-y-1 text-sm leading-6 text-yellow-50/68">
                  {designContext.unapprovedHints.map((fact) => (
                    <div key={fact.id}>
                      {fact.predicate}: {fact.valueText}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {designContext?.prompt ? (
              <div className="rounded-[16px] border border-cyan-300/15 bg-cyan-300/[0.05] p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-cyan-100/55">
                  Final Prompt Preview
                </div>
                <div className="mt-2 text-sm leading-6 text-cyan-50/75">
                  {designContext.prompt}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {designAreas.map((area) => (
        <section
          key={area.title}
          className="rounded-[20px] border border-white/10 bg-black/35 p-4"
        >
          <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
            {area.title}
          </p>

          <h3 className="mt-2 text-lg font-black text-white">
            {area.title} Workspace
          </h3>

          <p className="mt-2 text-sm leading-6 text-white/55">
            {area.body}
          </p>
        </section>
      ))}

      <StoryAssetGrid
        title={assetsLabel}
        assets={assets}
        busy={assetBusy}
        loading={assetsLoading}
        error={assetError}
        notice={assetNotice}
        refreshingAssetIds={refreshingAssetIds}
        onCreateAsset={onCreateAsset}
        onRefreshAsset={onRefreshAsset}
      />

      <VoiceDesignPanel
        busy={assetBusy}
        onSaveVoiceProfile={onSaveVoiceProfile}
      />
    </div>
  );
}
