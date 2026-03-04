export type StoryboardCharacter = {
  id?: string;
  label?: string;
  descriptor?: string;
};

export type StoryboardSceneDraft = {
  id?: string;
  title?: string;
  idea: string;
  inheritLens?: boolean;
  inheritIdentity?: boolean;
  inheritStyle?: boolean;
  applyNegative?: boolean;
  lens?: string;
  identityLock?: string;
  styleLock?: string;
};

export type StoryboardBatchRequest = {
  deviceId?: string;
  comfyTargetId?: string | null;

  characterCount: number;
  characters: StoryboardCharacter[];

  negEnabled?: boolean;
  negText?: string;

  scenes: StoryboardSceneDraft[];

  // optional override: choose explicit workflow file name (relative to OTG_WORKFLOWS_ROOT)
  workflowFile?: string;
};

export type FormattedScene = {
  sceneNumber: number;
  prompt: string;
  negative?: string | null;
  meta: {
    lens?: string;
    identityLock?: string;
    styleLock?: string;
    inherited: {
      lens: boolean;
      identity: boolean;
      style: boolean;
      negative: boolean;
    };
  };
};
