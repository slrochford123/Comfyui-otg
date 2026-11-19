import { resolveH3StylePreset } from "@/lib/h3StylePresets";
import { h3SceneDirectionInstructions, type H3SceneDirectionContext } from "@/lib/openai/h3SceneDirection";
import { RequestError } from "@/lib/requestError";
import { probeVideoInfo } from "@/lib/videoFrame";
import { DEFAULT_LAB_CREATIVE, labH3Mode } from "./creative";
import { appendH3References } from "./referenceLimits";
import { getAsset, type LabAsset, type LabSession } from "./store";

export type NsfwClipDirection = {
  context: H3SceneDirectionContext;
  shotFlow?: string;
  styleLabel?: string;
  input: {
    scene: string;
    revision?: string;
    visualStyle?: string;
    cameraFeel?: string;
    shotFlow?: string;
    orientation: string;
    references: { tag: string; role: string; name: string }[];
  };
};

/** Only resolve metadata for the exact media selected in this saved draft. */
export async function buildNsfwClipDirection(owner: string, session: LabSession, revision: string, legacy: boolean): Promise<NsfwClipDirection | null> {
  const settings = session.settings;
  const mode = settings.mode === "edit-image" ? "h3-image-to-video" : labH3Mode(settings.mode);
  const sourceAssets = session.assets.filter(asset => asset.role === "source");
  const sourceIds = settings.selectedSources ?? appendH3References([], sourceAssets.filter(asset => !asset.removedFromSaved).map(asset => asset.id), sourceAssets, settings.mode);
  const sourceById = new Map(sourceAssets.map(asset => [asset.id, asset]));
  const sources = mode === "h3-text-to-video" ? [] : sourceIds.map(id => sourceById.get(id)).filter((asset): asset is LabAsset => Boolean(asset));
  if (mode !== "h3-text-to-video" && sources.length !== sourceIds.length) throw new RequestError("A selected reference is unavailable.", 400);
  const pictures = sources.filter(asset => asset.mime.startsWith("image/"));
  const videos = sources.filter(asset => asset.mime.startsWith("video/"));
  const audio = settings.experimentalAudioReferences===true ? sources.filter(asset => asset.mime.startsWith("audio/")) : [];
  if (mode === "h3-image-to-video" && (pictures.length !== 1 || sources.length !== 1)) {
    if (legacy) return null;
    throw new RequestError("Choose one First Image before directing.", 400);
  }
  if (mode === "h3-reference-to-video" && !sources.length) {
    if (legacy) return null;
    throw new RequestError("Choose a reference before directing.", 400);
  }
  const videoSound = await Promise.all(videos.map(async asset => {
    try {
      const { file } = getAsset(owner, asset.id);
      return (await probeVideoInfo(file, { uploadedVideo: true })).hasAudio;
    } catch {
      throw new RequestError("A selected video could not be read. Check the upload and try Direct Scene again.", 400);
    }
  }));
  // The renderer numbers attached video soundtracks before standalone audio.
  const soundtracks = (settings.experimentalAudioReferences===true ? videos : []).flatMap((asset, index) => videoSound[index] ? [{ asset, index }] : []);
  const references = [
    ...pictures.map((asset, index) => ({ tag: `<Picture ${index + 1}>`, role: mode === "h3-image-to-video" ? "first frame" : "image reference", name: asset.name })),
    ...videos.map((asset, index) => ({ tag: `<Video ${index + 1}>`, role: settings.mode === "edit" ? "video to edit" : "video reference", name: asset.name })),
    ...soundtracks.map(({asset, index}, i) => ({ tag: `<Audio ${i + 1}>`, role: `soundtrack of <Video ${index + 1}>`, name: asset.name })),
    ...audio.map((asset, index) => ({ tag: `<Audio ${soundtracks.length + index + 1}>`, role: "audio reference", name: asset.name })),
  ];
  const preset = resolveH3StylePreset(settings.stylePresetId);
  const styleLabel = preset?.label || (settings.visualStyle !== DEFAULT_LAB_CREATIVE.visualStyle ? settings.visualStyle : undefined);
  const visualStyle = preset ? `${preset.label}: ${preset.description}` : settings.visualStyle !== DEFAULT_LAB_CREATIVE.visualStyle ? settings.visualStyle : undefined;
  return {
    context: {mode,durationSeconds:settings.seconds,firstImage:mode === "h3-image-to-video",lastImage:false,pictures:pictures.length,videos:videos.length,audios:audio.length + soundtracks.length},
    shotFlow:settings.shotFlow,
    styleLabel,
    input: {scene:settings.prompt,...(revision ? {revision} : {}),visualStyle,cameraFeel:settings.cameraFeel,shotFlow:settings.shotFlow,orientation:settings.orientation,references},
  };
}

export function nsfwClipMessages(direction: NsfwClipDirection) {
  const {context, input, shotFlow} = direction;
  return [
    {role:"system", content:[
      h3SceneDirectionInstructions(context, {shotFlow,styleLabel:direction.styleLabel}),
      shotFlow === "Multiple cinematic shots" && "Use at least two shots for this clip with a cut that advances the same scene.",
      "In every speech tag put the language in square brackets directly after the opening tag. For example, an English line must read <d>[English] exact spoken words</d>. Check each speech tag for its language before returning the JSON.",
      "Selected reference filenames are labels. No images, video frames, or audio content are attached to this request. Use the draft's visible details and the actual reference bindings without assuming pixel or audio inspection.",
      "Apply style as scene-specific visual treatment. Add no unrelated lore or automatic LoRA guidance. The application owns explicitly selected adapters.",
    ].filter(Boolean).join("\n")},
    {role:"user",content:JSON.stringify(input)},
  ];
}
