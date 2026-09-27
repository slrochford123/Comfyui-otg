"use client";

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

type Props = {
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
}: Props) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <CharacterDesignPanel />

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
