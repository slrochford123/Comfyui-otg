"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "./Controls";
const CharacterCreator = dynamic(() => import("../CharacterRefCardCreator"));
const AssetCreator = dynamic(() => import("../AssetGalleryPanel"));
const AudioCreator = dynamic(() => import("../UnifiedAudioEditingPanel"));
const Dialogue = dynamic(() => import("../EditVideoVoiceDubbingPanel"));
export default function SharedTools({
  characters,
  onSaved,
}: {
  characters: Array<{ id: string; name: string }>;
  onSaved: () => void;
}) {
  const [tool, setTool] = useState<
    "character" | "asset" | "audio" | "dialogue" | null
  >(null);
  const [dialogueSource, setDialogueSource] = useState<
    { path: string; name: string; url: string } | undefined
  >();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => setTool(tool === "character" ? null : "character")}
        >
          Create character / RefMod
        </Button>
        <Button onClick={() => setTool(tool === "asset" ? null : "asset")}>
          Create or edit world asset
        </Button>
        <Button onClick={() => setTool(tool === "audio" ? null : "audio")}>
          Music & sound studio
        </Button>
        <Button onClick={onSaved}>Refresh saved libraries</Button>
      </div>
      {tool && (
        <div className="rounded-xl border border-purple-400/20 p-3">
          <p className="mb-3 text-sm text-white/60">
            Shared creation tool. When you approve and save the result, import a
            pinned copy above for this production.
          </p>
          {tool === "character" ? (
            <CharacterCreator characters={characters} onSaved={onSaved} />
          ) : tool === "audio" ? (
            <AudioCreator
              initialSection="Create"
              onOpenDialogue={(source) => {
                setDialogueSource(source);
                setTool("dialogue");
              }}
            />
          ) : tool === "dialogue" ? (
            <Dialogue initialSource={dialogueSource} onSaved={onSaved} />
          ) : (
            <AssetCreator
              onBack={() => {
                setTool(null);
                onSaved();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
