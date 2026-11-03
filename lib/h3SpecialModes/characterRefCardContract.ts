/** Shared, client-safe contract. Four files, never a collage sent to H3. */
export const CHARACTER_REF_VIEWS = [
  {id: "face", label: "Face · front", instruction: "Zoom in and reframe as a close-up front-facing head-and-shoulders portrait. Only head and shoulders are visible; crop below the upper chest, face fills most of the picture. Neutral expression and unobstructed facial details."},
  {id: "front", label: "Full body · front", instruction: "A front-facing full-body reference, entire head and feet visible, relaxed neutral standing pose."},
  {id: "left", label: "Full body · left ¾", instruction: "Rotate the entire character, face and torso together, 45 degrees toward the left side of the picture. Show a distinct LEFT THREE-QUARTER view, not a frontal view. Both the front and the character's right side are visible, nose points diagonally left. Entire head and feet visible."},
  {id: "right", label: "Full body · right ¾", instruction: "Rotate the entire character, face and torso together, 45 degrees toward the right side of the picture. Show a distinct RIGHT THREE-QUARTER view, not a frontal view. Both the front and the character's left side are visible, nose points diagonally right. Entire head and feet visible."},
] as const;
export type CharacterRefAngle = typeof CHARACTER_REF_VIEWS[number]["id"];
export function characterRefViewPrompt(angle: CharacterRefAngle, description: string) {
  const view = CHARACTER_REF_VIEWS.find(item => item.id === angle);
  if (!view) throw Error("Choose a supported reference view.");
  // Native TextEncodeFibo2 accepts this trained edit+caption form directly.
  // Deterministic VGL needs neither a paid caption API nor another loaded VLM.
  return JSON.stringify({
    edit_instruction:`${view.instruction} Change the camera framing or viewpoint as requested, while preserving the identity and outfit of the subject in <image_1>. Create ONE image, not a grid or contact sheet. Preserve anatomical left/right markings; do not mirror the character.`,
    short_description:`A single reference portrait of the exact same character from <image_1>. ${view.instruction} ${description}`,
    objects:[{description:`The same character, face, species, age, hair, clothing, colors and distinctive markings as <image_1>. ${description}`,location:"center",pose:view.instruction}],
    background_setting:"Plain neutral light-gray studio backdrop without objects or text.",
    lighting:{conditions:"soft even studio light"},
    photographic_characteristics:{camera_angle:angle==="left"?"left three-quarter view, 45 degrees":angle==="right"?"right three-quarter view, 45 degrees":"front eye-level",framing:angle==="face"?"tight head-and-shoulders close-up":"entire full body from head to feet"},
    artistic_style:"Match the original reference image style exactly.",
  });
}
export const CHARACTER_REF_PREFIX = "characters/slr-test-cards/";
export type CharacterRefCardPublic = {
  id: string; revision: number; name: string; description: string; characterId: string;
  mode: "single" | "upload"; gpu: "auto" | "rtx3090" | "rtx5060ti";
  state: "draft" | "generating" | "review" | "encoding" | "completed" | "attention";
  createdAt: string; updatedAt: string; message: string; error: string;
  original: {id: string; url: string} | null;
  views: Array<{id: string; label: string; angle?: CharacterRefAngle; state: string; url?: string; error?: string; seed?: number; gpu?: string}>;
  libraryName?: string; backend?: string; tokenCount?: number; previewUrl?: string;
  voiceEnabled?: boolean;
  voice?: {id: string; name: string; durationSeconds: number; url: string} | null;
};

/** Immutable recording attached to one version of a character RefMod. */
export type CharacterRefVoice = {
  id: string; name: string; sourceId?: string; originalPath: string;
  path: string; sha256: string; durationSeconds: number;
};
export type CharacterRefMember = {kind: "image" | "video" | "audio"; tokens: number; shape: number[]};
