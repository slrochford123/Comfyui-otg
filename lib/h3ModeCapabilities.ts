export type H3StudioModeId =
  | "h3-text-to-video"
  | "h3-image-to-video"
  | "h3-reference-to-video"
  | "h3-realism"
  | "h3-body-swap"
  | "h3-refmods";

export type H3ModeCapabilities = {
  supportsPromptWorkspace: boolean;
  supportsLookControls: boolean;
  supportsSourceImage: boolean;
  supportsReferenceDeck: boolean;
  supportsRealismReferences: boolean;
  supportsBodySwapInputs: boolean;
  supportsRefModSlots: boolean;
  supportsQuality: boolean;
  supportsDuration: boolean;
  supportsOrientation: boolean;
  supportsRife: boolean;
  supportsSeed: boolean;
  supportsTurboNative: boolean;
  supportsStandardSingularity: boolean;
  supportsOptionalLoras: boolean;
  supportsH3Enhancements: boolean;
  supportsRealismPreset: boolean;
  supportsRefModsTurboNative: boolean;
};

const BASE_VIDEO_OUTPUT = {
  supportsQuality: true,
  supportsDuration: true,
  supportsOrientation: true,
  supportsRife: true,
} as const;

export const H3_MODE_CAPABILITIES: Record<H3StudioModeId, H3ModeCapabilities> = {
  "h3-text-to-video": {
    ...BASE_VIDEO_OUTPUT,
    supportsPromptWorkspace: true,
    supportsLookControls: true,
    supportsSourceImage: false,
    supportsReferenceDeck: false,
    supportsRealismReferences: false,
    supportsBodySwapInputs: false,
    supportsRefModSlots: false,
    supportsSeed: false,
    supportsTurboNative: true,
    supportsStandardSingularity: true,
    supportsOptionalLoras: true,
    supportsH3Enhancements: true,
    supportsRealismPreset: false,
    supportsRefModsTurboNative: false,
  },
  "h3-image-to-video": {
    ...BASE_VIDEO_OUTPUT,
    supportsPromptWorkspace: true,
    supportsLookControls: true,
    supportsSourceImage: true,
    supportsReferenceDeck: false,
    supportsRealismReferences: false,
    supportsBodySwapInputs: false,
    supportsRefModSlots: false,
    supportsSeed: false,
    supportsTurboNative: true,
    supportsStandardSingularity: true,
    supportsOptionalLoras: true,
    supportsH3Enhancements: true,
    supportsRealismPreset: false,
    supportsRefModsTurboNative: false,
  },
  "h3-reference-to-video": {
    ...BASE_VIDEO_OUTPUT,
    supportsPromptWorkspace: true,
    supportsLookControls: true,
    supportsSourceImage: false,
    supportsReferenceDeck: true,
    supportsRealismReferences: false,
    supportsBodySwapInputs: false,
    supportsRefModSlots: false,
    supportsSeed: false,
    supportsTurboNative: true,
    supportsStandardSingularity: true,
    supportsOptionalLoras: true,
    supportsH3Enhancements: true,
    supportsRealismPreset: false,
    supportsRefModsTurboNative: false,
  },
  "h3-realism": {
    ...BASE_VIDEO_OUTPUT,
    supportsPromptWorkspace: true,
    supportsLookControls: true,
    supportsSourceImage: false,
    supportsReferenceDeck: false,
    supportsRealismReferences: true,
    supportsBodySwapInputs: false,
    supportsRefModSlots: false,
    supportsSeed: true,
    supportsTurboNative: false,
    supportsStandardSingularity: true,
    supportsOptionalLoras: true,
    supportsH3Enhancements: false,
    supportsRealismPreset: true,
    supportsRefModsTurboNative: false,
  },
  "h3-body-swap": {
    ...BASE_VIDEO_OUTPUT,
    supportsPromptWorkspace: true,
    supportsLookControls: true,
    supportsSourceImage: false,
    supportsReferenceDeck: false,
    supportsRealismReferences: false,
    supportsBodySwapInputs: true,
    supportsRefModSlots: false,
    supportsSeed: true,
    supportsTurboNative: false,
    supportsStandardSingularity: false,
    supportsOptionalLoras: true,
    supportsH3Enhancements: false,
    supportsRealismPreset: false,
    supportsRefModsTurboNative: false,
  },
  "h3-refmods": {
    ...BASE_VIDEO_OUTPUT,
    supportsPromptWorkspace: true,
    supportsLookControls: true,
    supportsSourceImage: false,
    supportsReferenceDeck: false,
    supportsRealismReferences: false,
    supportsBodySwapInputs: false,
    supportsRefModSlots: true,
    supportsSeed: true,
    supportsTurboNative: false,
    supportsStandardSingularity: false,
    supportsOptionalLoras: true,
    supportsH3Enhancements: false,
    supportsRealismPreset: false,
    supportsRefModsTurboNative: true,
  },
};

export function h3ModeCapabilities(mode: H3StudioModeId): H3ModeCapabilities {
  return H3_MODE_CAPABILITIES[mode];
}

