"use client";

import { readStoryDirectorStream } from "./storyDirectorStream";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BibleTab } from "./storyCreatorV2/BibleTab";
import { DesignTab } from "./storyCreatorV2/DesignTab";
import { StoryAudioProductionStudio } from "./storyCreatorV2/StoryAudioProductionStudio";
import { StoryVideoProductionStudio } from "./storyCreatorV2/StoryVideoProductionStudio";
import { StoryMovieEditor } from "./storyCreatorV2/StoryMovieEditor";
import { IdeasTab } from "./storyCreatorV2/IdeasTab";
import {
  ProductionPlanner,
  type StoryPlanVersion,
  type StoryPlanWorkload,
} from "./storyCreatorV2/ProductionPlanner";
import { ProduceTab } from "./storyCreatorV2/ProduceTab";
import { StoryCreatorHeader } from "./storyCreatorV2/StoryCreatorHeader";
import type { StoryCreatorStage } from "./storyCreatorV2/StoryCreatorStageTabs";
import {
  StoryStudioShell,
  type StoryProductionMode,
  type StoryStudioTool,
} from "./storyCreatorV2/StoryStudioShell";
import { WriteTab } from "./storyCreatorV2/WriteTab";
import type {
  StoryCreatorAsset,
  StoryCreatorAssetCreateInput,
} from "./storyCreatorV2/StoryAssetGrid";
import type {
  StoryProductionPlan,
  StoryProductionPlanRecord,
} from "@/lib/storyCreator/productionPlan";
import {
  isStoryVisualActionInstruction,
  type StoryVisualDirectorAction,
} from "@/lib/storyCreator/visualActions";

type StoryProject = {
  id: string;
  ownerKey: string;
  title: string;
  format: string;
  genre: string;
  createdAt: number;
  updatedAt: number;
};

type StoryMessage = {
  id: string;
  projectId: string;
  ownerKey: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
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

type StoryBibleFactStatus =
  | "canon"
  | "suggestion"
  | "unknown";

type StoryBibleFact = {
  id: string;
  projectId: string;
  subjectEntityId: string | null;
  predicate: string;
  valueText: string;
  objectEntityId: string | null;
  canonStatus: StoryBibleFactStatus;
  sourceRole: "user" | "assistant" | "system";
  sourceMessageId: string | null;
  supersedesFactId: string | null;
  createdAt: number;
  updatedAt: number;
};

type StoryConflict = {
  id: string;
  projectId: string;
  factId: string;
  conflictsWithFactId: string;
  summary: string;
  status: "open" | "resolved" | "dismissed";
  sourceRole: "user" | "assistant" | "system";
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type StoryConflictAction =
  | "KEEP_CURRENT_CANON"
  | "USE_PROPOSED_VERSION"
  | "EDIT_PROPOSED_VERSION"
  | "DISMISS_CONFLICT";

type StoryWritingMode =
  | "outline"
  | "chapter"
  | "episode"
  | "scene"
  | "dialogue";

type StoryVoiceProfileInput = {
  name: string;
  sampleText: string;
  direction: string;
};

type StoryOpenQuestion = {
  id: string;
  projectId: string;
  question: string;
  status: "open" | "answered" | "dismissed";
  sourceRole: "user" | "assistant" | "system";
  createdAt: number;
  updatedAt: number;
};

type StoryProductionPackage = {
  counts?: {
    canonFacts?: number;
    openConflicts?: number;
    assets?: number;
    generationJobs?: number;
  };
  workflowBundle?: string[];
  handoffTargets?: Record<string, string>;
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
  ownerKey: string;
};

const STORY_LIMIT = 6;

function formatDate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function errorMessage(
  data: any,
  fallback: string,
) {
  return typeof data?.error === "string" && data.error.trim()
    ? data.error
    : fallback;
}

function assistantText(data: any) {
  if (
    typeof data?.response === "string" &&
    data.response.trim()
  ) {
    return data.response.trim();
  }
  if (
    typeof data?.message === "string" &&
    data.message.trim()
  ) {
    return data.message.trim();
  }
  if (
    typeof data?.message?.content === "string" &&
    data.message.content.trim()
  ) {
    return data.message.content.trim();
  }
  if (
    typeof data?.content === "string" &&
    data.content.trim()
  ) {
    return data.content.trim();
  }
  return "";
}

export default function StoryCreatorPanel({
  ownerKey,
}: Props) {
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] =
    useState("");
  const [storyCreatorStage, setStoryCreatorStage] =
    useState<StoryCreatorStage>("ideas");
  const [storyProductionMode, setStoryProductionMode] =
    useState<StoryProductionMode>("assisted");
  const [storyMemoryOpen, setStoryMemoryOpen] =
    useState(false);
  const [storyProductionOpen, setStoryProductionOpen] =
    useState(false);
  const [storyDirectorVisualAction, setStoryDirectorVisualAction] =
    useState<StoryVisualDirectorAction | null>(null);
  const [storyDirectorVisualActionError, setStoryDirectorVisualActionError] =
    useState("");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const [storyMessages, setStoryMessages] =
    useState<StoryMessage[]>([]);
  const [messagesLoading, setMessagesLoading] =
    useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [draft, setDraft] = useState("");
  const [storyExtractionBusy, setStoryExtractionBusy] =
    useState(false);
  const [storyExtractionError, setStoryExtractionError] =
    useState("");
  const [storyExtractionNotice, setStoryExtractionNotice] =
    useState("");
  const [storyUsage, setStoryUsage] = useState<{
    costUsd: number;
    requestCount: number;
    status: "actual" | "partial" | "unavailable";
  }>({ costUsd: 0, requestCount: 0, status: "unavailable" });
  const [storyOpenQuestions, setStoryOpenQuestions] =
    useState<StoryOpenQuestion[]>([]);
  const [
    storyOpenQuestionsLoading,
    setStoryOpenQuestionsLoading,
  ] = useState(false);
  const [
    storyOpenQuestionsError,
    setStoryOpenQuestionsError,
  ] = useState("");

  const [storyBibleEntities, setStoryBibleEntities] =
    useState<StoryBibleEntity[]>([]);
  const [storyBibleFacts, setStoryBibleFacts] =
    useState<StoryBibleFact[]>([]);
  const [
    storyBiblePendingFacts,
    setStoryBiblePendingFacts,
  ] = useState<StoryBibleFact[]>([]);
  const [storyBibleLoading, setStoryBibleLoading] =
    useState(false);
  const [storyBibleError, setStoryBibleError] =
    useState("");
  const [storyConflicts, setStoryConflicts] =
    useState<StoryConflict[]>([]);
  const [storyConflictsLoading, setStoryConflictsLoading] =
    useState(false);
  const [storyConflictsBusy, setStoryConflictsBusy] =
    useState(false);
  const [
    storyConflictActionBusyId,
    setStoryConflictActionBusyId,
  ] = useState("");
  const [storyConflictsError, setStoryConflictsError] =
    useState("");
  const [storyWritingMode, setStoryWritingMode] =
    useState<StoryWritingMode>("scene");
  const [
    storyWritingInstruction,
    setStoryWritingInstruction,
  ] = useState("");
  const [storyWritingDraft, setStoryWritingDraft] =
    useState("");
  const [storyWritingBusy, setStoryWritingBusy] =
    useState(false);
  const [storyWritingError, setStoryWritingError] =
    useState("");
  const [storyProductionPlan, setStoryProductionPlan] =
    useState<StoryProductionPlanRecord | null>(null);
  const [storyPlanWorkload, setStoryPlanWorkload] =
    useState<StoryPlanWorkload | null>(null);
  const [storyPlanVersions, setStoryPlanVersions] =
    useState<StoryPlanVersion[]>([]);
  const [storyPlanLoading, setStoryPlanLoading] =
    useState(false);
  const [storyPlanBusy, setStoryPlanBusy] = useState(false);
  const [storyPlanError, setStoryPlanError] = useState("");
  const [storyPlanNotice, setStoryPlanNotice] = useState("");
  const [storyAssets, setStoryAssets] =
    useState<StoryCreatorAsset[]>([]);
  const [storyAssetsLoading, setStoryAssetsLoading] =
    useState(false);
  const [storyAssetBusy, setStoryAssetBusy] =
    useState(false);
  const [storyAssetError, setStoryAssetError] =
    useState("");
  const [storyAssetNotice, setStoryAssetNotice] =
    useState("");
  const [
    storyAssetStatusBusyIds,
    setStoryAssetStatusBusyIds,
  ] = useState<string[]>([]);
  const [
    storyProductionPackage,
    setStoryProductionPackage,
  ] = useState<StoryProductionPackage | null>(null);
  const [storyExportBusy, setStoryExportBusy] =
    useState(false);
  const [storyExportError, setStoryExportError] =
    useState("");
  const [storyExportNotice, setStoryExportNotice] =
    useState("");

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const storySendLockRef = useRef(false);
  const visualRestoreProjectRef = useRef("");
  const storyAssetStatusBusyRef = useRef<Set<string>>(
    new Set(),
  );

  const selectedProject = useMemo(
    () =>
      projects.find(
        (project) => project.id === selectedProjectId,
      ) || null,
    [projects, selectedProjectId],
  );

  const storyBibleEntityNames = useMemo(
    () =>
      new Map(
        storyBibleEntities.map((entity) => [
          entity.id,
          entity.name,
        ]),
      ),
    [storyBibleEntities],
  );

  const storyVoiceVocabularyKeywords = useMemo(() => {
    const terms = new Set<string>();
    if (selectedProject?.title) terms.add(selectedProject.title);
    for (const entity of storyBibleEntities) {
      if (entity.name) terms.add(entity.name);
    }
    for (const asset of storyAssets) {
      if (asset.name) terms.add(asset.name);
    }
    for (const fact of storyBibleFacts) {
      for (const token of fact.valueText.match(/\b[A-Z][A-Za-z0-9'-]{2,}\b/g) || []) {
        terms.add(token);
      }
    }
    return Array.from(terms).slice(0, 80);
  }, [selectedProject?.title, storyAssets, storyBibleEntities, storyBibleFacts]);

  const storyBibleFactsByStatus = useMemo(
    () => ({
      canon: storyBibleFacts.filter(
        (fact) => fact.canonStatus === "canon",
      ),
      suggestion: storyBibleFacts.filter(
        (fact) => fact.canonStatus === "suggestion",
      ),
      unknown: storyBibleFacts.filter(
        (fact) => fact.canonStatus === "unknown",
      ),
    }),
    [storyBibleFacts],
  );

  const extractionSourceMessageId = useMemo(() => {
    const latestAssistant = [...storyMessages]
      .reverse()
      .find((message) => message.role === "assistant");

    return (
      latestAssistant?.id ||
      storyMessages[storyMessages.length - 1]?.id ||
      ""
    );
  }, [storyMessages]);

  const loadProjects = useCallback(async () => {
    if (!ownerKey) return;

    setBusy(true);

    try {
      const response = await fetch(
        "/api/story-creator/projects",
        {
          cache: "no-store",
          credentials: "include",
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not load Story Creator projects.",
          ),
        );
      }

      const nextProjects = Array.isArray(data?.projects)
        ? data.projects
        : [];

      setProjects(nextProjects);

      setSelectedProjectId((current) => {
        if (
          current &&
          nextProjects.some(
            (project: StoryProject) =>
              project.id === current,
          )
        ) {
          return current;
        }

        return "";
      });

      setNotice("");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not load Story Creator projects.",
      );
    } finally {
      setBusy(false);
    }
  }, [ownerKey]);

  const loadStoryMessages = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setStoryMessages([]);
        return;
      }

      setMessagesLoading(true);
      setChatError("");

      try {
        const response = await fetch(
          `/api/story-creator/messages?projectId=${encodeURIComponent(projectId)}`,
          {
            cache: "no-store",
            credentials: "include",
          },
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            errorMessage(
              data,
              "Could not load Story Director conversation.",
            ),
          );
        }

        setStoryMessages(
          Array.isArray(data?.messages)
            ? data.messages
            : [],
        );
      } catch (error) {
        setChatError(
          error instanceof Error
            ? error.message
            : "Could not load Story Director conversation.",
        );
      } finally {
        setMessagesLoading(false);
      }
    },
    [],
  );

  const loadStoryBible = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setStoryBibleEntities([]);
        setStoryBibleFacts([]);
        setStoryBiblePendingFacts([]);
        setStoryBibleError("");
        return;
      }

      setStoryBibleLoading(true);
      setStoryBibleError("");

      try {
        const response = await fetch(
          `/api/story-creator/bible?projectId=${encodeURIComponent(projectId)}`,
          {
            cache: "no-store",
            credentials: "include",
          },
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            errorMessage(
              data,
              "Could not load Story Bible.",
            ),
          );
        }

        setStoryBibleEntities(
          Array.isArray(data?.entities)
            ? data.entities
            : [],
        );

        setStoryBibleFacts(
          Array.isArray(data?.facts)
            ? data.facts
            : [],
        );

        setStoryBiblePendingFacts(
          Array.isArray(data?.pendingFacts)
            ? data.pendingFacts
            : [],
        );
      } catch (error) {
        setStoryBibleEntities([]);
        setStoryBibleFacts([]);
        setStoryBiblePendingFacts([]);

        setStoryBibleError(
          error instanceof Error
            ? error.message
            : "Could not load Story Bible.",
        );
      } finally {
        setStoryBibleLoading(false);
      }
    },
    [],
  );

  const loadStoryUsage = useCallback(async (projectId: string) => {
    if (!projectId) {
      setStoryUsage({ costUsd: 0, requestCount: 0, status: "unavailable" });
      return;
    }
    try {
      const response = await fetch(`/api/story-creator/usage?projectId=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Usage unavailable");
      setStoryUsage({
        costUsd: Number(data.costUsd || 0),
        requestCount: Number(data.requestCount || 0),
        status: data.status === "actual" || data.status === "partial" ? data.status : "unavailable",
      });
    } catch {
      setStoryUsage({ costUsd: 0, requestCount: 0, status: "unavailable" });
    }
  }, []);

  const loadStoryConflicts = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setStoryConflicts([]);
        setStoryConflictsError("");
        return;
      }

      setStoryConflictsLoading(true);
      setStoryConflictsError("");

      try {
        const response = await fetch(
          `/api/story-creator/conflicts?projectId=${encodeURIComponent(projectId)}`,
          {
            cache: "no-store",
            credentials: "include",
          },
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            errorMessage(
              data,
              "Could not load Story conflicts.",
            ),
          );
        }

        setStoryConflicts(
          Array.isArray(data?.conflicts)
            ? data.conflicts
            : [],
        );
      } catch (error) {
        setStoryConflicts([]);
        setStoryConflictsError(
          error instanceof Error
            ? error.message
            : "Could not load Story conflicts.",
        );
      } finally {
        setStoryConflictsLoading(false);
      }
    },
    [],
  );

  const loadStoryOpenQuestions = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setStoryOpenQuestions([]);
        setStoryOpenQuestionsError("");
        return;
      }

      setStoryOpenQuestionsLoading(true);
      setStoryOpenQuestionsError("");

      try {
        const response = await fetch(
          `/api/story-creator/questions?projectId=${encodeURIComponent(projectId)}`,
          {
            cache: "no-store",
            credentials: "include",
          },
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            errorMessage(
              data,
              "Could not load Story open questions.",
            ),
          );
        }

        setStoryOpenQuestions(
          Array.isArray(data?.questions)
            ? data.questions
            : [],
        );
      } catch (error) {
        setStoryOpenQuestions([]);
        setStoryOpenQuestionsError(
          error instanceof Error
            ? error.message
            : "Could not load Story open questions.",
        );
      } finally {
        setStoryOpenQuestionsLoading(false);
      }
    },
    [],
  );

  const setStoryAssetRefreshBusy = useCallback(
    (assetId: string, busy: boolean) => {
      const next = new Set(storyAssetStatusBusyRef.current);

      if (busy) {
        next.add(assetId);
      } else {
        next.delete(assetId);
      }

      storyAssetStatusBusyRef.current = next;
      setStoryAssetStatusBusyIds(Array.from(next));
    },
    [],
  );

  const loadStoryAssets = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setStoryAssets([]);
        setStoryAssetError("");
        return;
      }

      setStoryAssetsLoading(true);
      setStoryAssetError("");

      try {
        const response = await fetch(
          `/api/story-creator/assets?projectId=${encodeURIComponent(projectId)}`,
          {
            cache: "no-store",
            credentials: "include",
          },
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            errorMessage(
              data,
              "Could not load Story assets.",
            ),
          );
        }

        setStoryAssets(
          Array.isArray(data?.assets)
            ? data.assets
            : [],
        );
      } catch (error) {
        setStoryAssets([]);
        setStoryAssetError(
          error instanceof Error
            ? error.message
            : "Could not load Story assets.",
        );
      } finally {
        setStoryAssetsLoading(false);
      }
    },
    [],
  );

  const loadStoryProductionPlan = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setStoryProductionPlan(null);
        setStoryPlanWorkload(null);
        setStoryPlanVersions([]);
        setStoryPlanError("");
        return;
      }

      setStoryPlanLoading(true);
      setStoryPlanError("");

      try {
        const response = await fetch(
          `/api/story-creator/production-plan?projectId=${encodeURIComponent(projectId)}`,
          {
            cache: "no-store",
            credentials: "include",
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            errorMessage(data, "Could not load the production plan."),
          );
        }
        setStoryProductionPlan(data?.record || null);
        setStoryPlanWorkload(data?.workload || null);
        setStoryPlanVersions(
          Array.isArray(data?.versions) ? data.versions : [],
        );
      } catch (error) {
        setStoryProductionPlan(null);
        setStoryPlanWorkload(null);
        setStoryPlanVersions([]);
        setStoryPlanError(
          error instanceof Error
            ? error.message
            : "Could not load the production plan.",
        );
      } finally {
        setStoryPlanLoading(false);
      }
    },
    [],
  );

  const refreshStoryAssetStatus = useCallback(
    async (
      assetId: string,
      options: {
        silent?: boolean;
      } = {},
    ) => {
      const projectId = selectedProjectId;

      if (
        !projectId ||
        !assetId ||
        storyAssetStatusBusyRef.current.has(assetId)
      ) {
        return;
      }

      setStoryAssetRefreshBusy(assetId, true);
      if (!options.silent) {
        setStoryAssetError("");
      }

      try {
        const response = await fetch(
          "/api/story-creator/assets/status",
          {
            method: "POST",
            cache: "no-store",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              projectId,
              assetId,
            }),
          },
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            errorMessage(
              data,
              "Could not refresh Story asset status.",
            ),
          );
        }

        if (data?.asset) {
          setStoryAssets((current) =>
            current.map((asset) =>
              asset.id === data.asset.id
                ? data.asset
                : asset,
            ),
          );
        } else {
          await loadStoryAssets(projectId);
        }

        if (!options.silent && data?.message) {
          setStoryAssetNotice(String(data.message));
        }
      } catch (error) {
        if (!options.silent) {
          setStoryAssetError(
            error instanceof Error
              ? error.message
              : "Could not refresh Story asset status.",
          );
        }
      } finally {
        setStoryAssetRefreshBusy(assetId, false);
      }
    },
    [
      loadStoryAssets,
      selectedProjectId,
      setStoryAssetRefreshBusy,
    ],
  );

  const generatingStoryAssetIds = useMemo(
    () =>
      storyAssets
        .filter(
          (asset) =>
            asset.status === "generating" && asset.jobId,
        )
        .map((asset) => asset.id),
    [storyAssets],
  );

  const generatingStoryAssetIdsKey =
    generatingStoryAssetIds.join("|");

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (selectedProjectId) {
      setStoryCreatorStage("ideas");
      setStoryMemoryOpen(false);
      setStoryProductionOpen(false);
      setStoryDirectorVisualAction(null);
      setStoryDirectorVisualActionError("");
      visualRestoreProjectRef.current = "";

      try {
        const savedMode = window.localStorage.getItem(
          `otg:story-studio:mode:v1:${selectedProjectId}`,
        );
        if (
          savedMode === "automatic" ||
          savedMode === "assisted" ||
          savedMode === "manual"
        ) {
          setStoryProductionMode(savedMode);
        } else {
          setStoryProductionMode("assisted");
        }
      } catch {
        setStoryProductionMode("assisted");
      }
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || visualRestoreProjectRef.current === selectedProjectId) return;
    visualRestoreProjectRef.current = selectedProjectId;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/story-creator/visual-assets?projectId=${encodeURIComponent(selectedProjectId)}`, {
          cache: "no-store", credentials: "include",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !active) return;
        const assets = (Array.isArray(data.assets) ? data.assets : []) as Array<{
          id: string; name: string; visualKind: StoryVisualDirectorAction["visualKind"];
          metadata?: Record<string, unknown>; updatedAt?: number;
          versions?: Array<{ id: string; prompt: string; parentVersionId: string | null; status: string; metadata?: Record<string, unknown> }>;
        }>;
        const asset = assets
          .filter((item) => item.metadata?.source === "story-director-conversation" && Array.isArray(item.versions) && item.versions.length > 0)
          .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0];
        const version = asset?.versions?.[0];
        if (!asset || !version || !["planned", "generating", "ready", "approved", "failed"].includes(version.status)) return;
        const metadata = { ...(asset.metadata || {}), ...(version.metadata || {}) };
        setStoryDirectorVisualAction({
          action: version.parentVersionId ? "prepare-edit" : "prepare-generation",
          visualKind: asset.visualKind,
          name: asset.name,
          prompt: version.prompt,
          questions: [],
          entityId: typeof metadata.entityId === "string" ? metadata.entityId : null,
          assetId: asset.id,
          sourceVersionId: version.parentVersionId,
          displayVersionId: version.id,
          referenceVersionIds: Array.isArray(metadata.referenceVersionIds) ? metadata.referenceVersionIds.filter((value): value is string => typeof value === "string") : [],
          planVersion: typeof metadata.planVersion === "number" ? metadata.planVersion : null,
          sceneId: typeof metadata.sceneId === "string" ? metadata.sceneId : null,
          shotId: typeof metadata.shotId === "string" ? metadata.shotId : null,
        });
      } catch {
        // The conversation remains usable even if an older visual cannot be restored.
      }
    })();
    return () => { active = false; };
  }, [selectedProjectId]);

  function changeStoryProductionMode(mode: StoryProductionMode) {
    setStoryProductionMode(mode);
    if (!selectedProjectId) return;

    try {
      window.localStorage.setItem(
        `otg:story-studio:mode:v1:${selectedProjectId}`,
        mode,
      );
    } catch {
      // Production mode is a UI preference until project planning lands.
    }
  }

  function changeStoryStudioTool(tool: StoryStudioTool) {
    setStoryCreatorStage(tool);
    setStoryProductionOpen(true);
  }

  useEffect(() => {
    if (!selectedProjectId) {
      setStoryMessages([]);
      setChatError("");
      setDraft("");
      setStoryExtractionBusy(false);
      setStoryExtractionError("");
      setStoryExtractionNotice("");
      setStoryUsage({ costUsd: 0, requestCount: 0, status: "unavailable" });
      setStoryOpenQuestions([]);
      setStoryOpenQuestionsError("");

      setStoryBibleEntities([]);
      setStoryBibleFacts([]);
      setStoryBibleError("");
      setStoryConflicts([]);
      setStoryConflictsError("");
      setStoryWritingDraft("");
      setStoryWritingError("");
      setStoryWritingInstruction("");
      setStoryProductionPlan(null);
      setStoryPlanWorkload(null);
      setStoryPlanVersions([]);
      setStoryPlanError("");
      setStoryPlanNotice("");
      setStoryAssets([]);
      setStoryAssetError("");
      setStoryAssetNotice("");
      setStoryProductionPackage(null);
      setStoryExportError("");
      setStoryExportNotice("");

      return;
    }

    void loadStoryMessages(selectedProjectId);
    void loadStoryBible(selectedProjectId);
    void loadStoryConflicts(selectedProjectId);
    void loadStoryOpenQuestions(selectedProjectId);
    void loadStoryAssets(selectedProjectId);
    void loadStoryProductionPlan(selectedProjectId);
    void loadStoryUsage(selectedProjectId);
  }, [
    selectedProjectId,
    loadStoryMessages,
    loadStoryBible,
    loadStoryConflicts,
    loadStoryOpenQuestions,
    loadStoryAssets,
    loadStoryProductionPlan,
    loadStoryUsage,
  ]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    });
  }, [storyMessages, chatBusy]);

  useEffect(() => {
    if (
      storyCreatorStage !== "design" ||
      !selectedProjectId ||
      !generatingStoryAssetIds.length
    ) {
      return;
    }

    const refreshGeneratingAssets = () => {
      for (const assetId of generatingStoryAssetIds) {
        void refreshStoryAssetStatus(assetId, {
          silent: true,
        });
      }
    };

    refreshGeneratingAssets();
    const timer = window.setInterval(
      refreshGeneratingAssets,
      5000,
    );

    return () => window.clearInterval(timer);
  }, [
    generatingStoryAssetIds,
    generatingStoryAssetIdsKey,
    refreshStoryAssetStatus,
    selectedProjectId,
    storyCreatorStage,
  ]);

  async function createProject() {
    if (!ownerKey || busy) return;

    const title = newTitle.trim();

    if (!title) {
      setNotice("Enter a story title before creating a project.");
      return;
    }

    const normalizedTitle = title.toLocaleLowerCase();
    if (
      projects.some(
        (project) =>
          project.title.trim().toLocaleLowerCase() ===
          normalizedTitle,
      )
    ) {
      setNotice(
        "A Story with that title already exists. Choose a different title or continue the existing Story.",
      );
      return;
    }

    if (projects.length >= STORY_LIMIT) {
      setNotice(
        `Story Creator supports up to ${STORY_LIMIT} active stories. Delete one before creating another.`,
      );
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      const response = await fetch(
        "/api/story-creator/projects",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not create Story.",
          ),
        );
      }

      const project = data?.project as StoryProject;

      setProjects((current) => [
        project,
        ...current.filter(
          (item) => item.id !== project.id,
        ),
      ]);

      setSelectedProjectId(project.id);
      setNewTitle("");
      setNotice("Story created.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not create Story.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function renameProject(
    project: StoryProject,
  ) {
    if (!ownerKey || busy) return;

    const nextTitle =
      window
        .prompt("Rename Story", project.title)
        ?.trim() || "";

    if (
      !nextTitle ||
      nextTitle === project.title
    ) {
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      const response = await fetch(
        "/api/story-creator/projects",
        {
          method: "PATCH",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: project.id,
            title: nextTitle,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not rename Story.",
          ),
        );
      }

      const updated = data?.project as StoryProject;

      setProjects((current) =>
        current.map((item) =>
          item.id === updated.id
            ? updated
            : item,
        ),
      );

      setNotice("Story renamed.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not rename Story.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(
    project: StoryProject,
  ) {
    if (!ownerKey || busy) return;

    const confirmed = window.confirm(
      `Delete "${project.title}"?\n\nThe project and its Story Director conversation will be permanently removed.`,
    );

    if (!confirmed) return;

    setBusy(true);
    setNotice("");

    try {
      const response = await fetch(
        "/api/story-creator/projects",
        {
          method: "DELETE",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: project.id,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not delete Story.",
          ),
        );
      }

      setProjects((current) =>
        current.filter(
          (item) => item.id !== project.id,
        ),
      );

      setSelectedProjectId((current) =>
        current === project.id
          ? ""
          : current,
      );

      setNotice("Story deleted.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not delete Story.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function persistMessage(
    projectId: string,
    role: StoryMessage["role"],
    content: string,
  ) {
    const response = await fetch(
      "/api/story-creator/messages",
      {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          role,
          content,
        }),
      },
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        errorMessage(
          data,
          "Could not save Story Director message.",
        ),
      );
    }

    return data.message as StoryMessage;
  }

  async function createStoryAsset(
    input: StoryCreatorAssetCreateInput,
  ) {
    const project = selectedProject;
    const name = input.name.trim();
    const prompt = input.prompt.trim();
    const artStyle = input.artStyle.trim();

    if (!project || storyAssetBusy) {
      return;
    }

    if (!name || !prompt) {
      setStoryAssetError(
        "Add an asset name and prompt before submitting.",
      );
      return;
    }

    setStoryAssetBusy(true);
    setStoryAssetError("");
    setStoryAssetNotice("");

    const imageRequest = {
      name,
      model: "qwen-image-2-1",
      artStyle,
      prompt,
    };

    try {
      const imageResponse = await fetch(
        "/api/assets/create-image",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(imageRequest),
        },
      );

      const imageData = await imageResponse
        .json()
        .catch(() => ({}));

      if (!imageResponse.ok) {
        throw new Error(
          errorMessage(
            imageData,
            "Could not submit Qwen Image 2.1 asset job.",
          ),
        );
      }

      const promptId = String(
        imageData?.promptId ||
          imageData?.prompt_id ||
          "",
      ).trim();

      const assetResponse = await fetch(
        "/api/story-creator/assets",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: project.id,
            assetType: input.assetType,
            name,
            prompt,
            status: "generating",
            provider: "qwen-image-2-1",
            jobId: promptId,
            metadata: {
              artStyle,
              imageModel: "qwen-image-2-1",
              outputNodeId: imageData?.outputNodeId || "461",
              workflow:
                "comfy_workflows/internal/story-creator/qwen21-story-asset-t2i-api.json",
              imageResponse: imageData,
              ...(input.metadata || {}),
            },
            generation: {
              jobType: "story-image",
              provider: "qwen-image-2-1",
              status: "submitted",
              promptId,
              endpoint: "/api/assets/create-image",
              request: {
                ...imageRequest,
                storyDesignContextProvenance:
                  input.metadata?.storyDesignContextProvenance,
              },
              response: imageData,
            },
          }),
        },
      );

      const assetData = await assetResponse
        .json()
        .catch(() => ({}));

      if (!assetResponse.ok) {
        throw new Error(
          errorMessage(
            assetData,
            "Could not save Story asset metadata.",
          ),
        );
      }

      await loadStoryAssets(project.id);

      setStoryAssetNotice(
        promptId
          ? `Qwen Image 2.1 prompt ${promptId} submitted and linked to this Story.`
          : "Qwen Image 2.1 asset job submitted and linked to this Story.",
      );
    } catch (error) {
      setStoryAssetError(
        error instanceof Error
          ? error.message
          : "Could not submit Story asset job.",
      );
    } finally {
      setStoryAssetBusy(false);
    }
  }

  async function loadStoryDesignContext(input: {
    entityId: string;
    userInstruction: string;
  }) {
    const project = selectedProject;

    if (!project) {
      throw new Error("Select a Story before designing from canon.");
    }

    const response = await fetch(
      "/api/story-creator/design/context",
      {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: project.id,
          entityId: input.entityId,
          userInstruction: input.userInstruction,
        }),
      },
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        errorMessage(
          data,
          "Could not assemble Story design context.",
        ),
      );
    }

    return data.context as StoryDesignContext;
  }

  async function generateStoryDesignFromContext(input: {
    context: StoryDesignContext;
    userInstruction: string;
  }) {
    const context = input.context;
    const provenance = {
      ...(context.provenance || {}),
      assembledFinalPrompt:
        context.prompt ||
        String(context.provenance?.assembledPrompt || ""),
      contextGeneratedAt:
        context.provenance?.generatedAt ||
        new Date().toISOString(),
      userDesignInstruction: input.userInstruction,
    };

    await createStoryAsset({
      assetType:
        context.entityKind === "character"
          ? "character"
          : context.entityKind === "location"
            ? "location"
            : "object",
      name: `${context.entity.name} Story Design`,
      prompt: context.prompt,
      artStyle:
        "cinematic story concept art, production reference, detailed but consistent",
      metadata: {
        selectedEntityId: context.entity.id,
        storyDesignContextProvenance: provenance,
      },
    });
  }

  async function saveStoryVoiceProfile(
    input: StoryVoiceProfileInput,
  ) {
    const project = selectedProject;
    const name = input.name.trim();
    const sampleText = input.sampleText.trim();
    const direction = input.direction.trim();

    if (!project || storyAssetBusy) {
      return;
    }

    if (!name || !sampleText) {
      setStoryAssetError(
        "Add a voice name and sample line before saving.",
      );
      return;
    }

    setStoryAssetBusy(true);
    setStoryAssetError("");
    setStoryAssetNotice("");

    try {
      const response = await fetch(
        "/api/story-creator/assets",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: project.id,
            assetType: "voice",
            name,
            prompt: direction,
            status: "ready",
            provider: "story-voice-profile",
            metadata: {
              sampleText,
              direction,
              voicePreviewRoute:
                "/api/characters/voice-preview",
              aukPerformanceRoute:
                "/api/voice/auk-performance",
            },
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not save Story voice profile.",
          ),
        );
      }

      await loadStoryAssets(project.id);
      setStoryAssetNotice("Voice profile saved to this Story.");
    } catch (error) {
      setStoryAssetError(
        error instanceof Error
          ? error.message
          : "Could not save Story voice profile.",
      );
    } finally {
      setStoryAssetBusy(false);
    }
  }

  async function createStoryProductionPackage() {
    const project = selectedProject;

    if (!project || storyExportBusy) {
      return;
    }

    setStoryExportBusy(true);
    setStoryExportError("");
    setStoryExportNotice("");

    try {
      const response = await fetch(
        "/api/story-creator/export/production",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: project.id,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not build Story production package.",
          ),
        );
      }

      setStoryProductionPackage(
        data?.package || null,
      );
      setStoryExportNotice(
        "Production package built from approved canon, Story assets, and workflow handoff metadata.",
      );
    } catch (error) {
      setStoryExportError(
        error instanceof Error
          ? error.message
          : "Could not build Story production package.",
      );
    } finally {
      setStoryExportBusy(false);
    }
  }

  async function generateStoryWriting() {
    const project = selectedProject;

    if (!project || storyWritingBusy) {
      return;
    }

    setStoryWritingBusy(true);
    setStoryWritingError("");

    try {
      const response = await fetch(
        "/api/story-creator/write",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: project.id,
            mode: storyWritingMode,
            instruction: storyWritingInstruction,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not generate Story writing.",
          ),
        );
      }

      setStoryWritingDraft(
        typeof data?.draft === "string"
          ? data.draft
          : "",
      );
    } catch (error) {
      setStoryWritingError(
        error instanceof Error
          ? error.message
          : "Could not generate Story writing.",
      );
    } finally {
      setStoryWritingBusy(false);
    }
  }

  async function updateStoryProductionPlan(
    action: "create" | "generate" | "save" | "approve",
    payload: Record<string, unknown> = {},
  ) {
    const project = selectedProject;
    if (!project || storyPlanBusy) return;

    setStoryPlanBusy(true);
    setStoryPlanError("");
    setStoryPlanNotice("");

    try {
      const response = await fetch(
        "/api/story-creator/production-plan",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: project.id,
            action,
            ...payload,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          errorMessage(data, "Could not update the production plan."),
        );
      }

      setStoryProductionPlan(data?.record || null);
      setStoryPlanWorkload(data?.workload || null);
      setStoryPlanNotice(
        typeof data?.message === "string" && data.message.trim()
          ? data.message
          : action === "save"
            ? "Production plan draft saved."
            : action === "create"
              ? "Manual production plan created."
              : action === "generate"
                ? "AI draft created for review. No media generation was started."
                : "Production plan approved. No media generation was started.",
      );
      await loadStoryProductionPlan(project.id);
    } catch (error) {
      setStoryPlanError(
        error instanceof Error
          ? error.message
          : "Could not update the production plan.",
      );
    } finally {
      setStoryPlanBusy(false);
    }
  }

  async function checkStoryConflicts() {
    const project = selectedProject;

    if (!project || storyConflictsBusy) {
      return;
    }

    setStoryConflictsBusy(true);
    setStoryConflictsError("");

    try {
      const response = await fetch(
        "/api/story-creator/conflicts",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: project.id,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not check Story conflicts.",
          ),
        );
      }

      setStoryConflicts(
        Array.isArray(data?.conflicts)
          ? data.conflicts
          : [],
      );
    } catch (error) {
      setStoryConflictsError(
        error instanceof Error
          ? error.message
          : "Could not check Story conflicts.",
      );
    } finally {
      setStoryConflictsBusy(false);
    }
  }

  async function extractStoryInformation(
    sourceMessageId?: string,
    options: {
      stayInIdeas?: boolean;
      silent?: boolean;
      paidOperationAuthorized?: boolean;
    } = {},
  ) {
    const project = selectedProject;
    const targetSourceMessageId =
      sourceMessageId || extractionSourceMessageId;

    if (
      !project ||
      storyExtractionBusy ||
      !targetSourceMessageId
    ) {
      return {
        ok: false,
        summary: "No stored Story message is ready for extraction.",
      };
    }

    setStoryExtractionBusy(true);
    if (!options.silent) {
      setStoryExtractionError("");
      setStoryExtractionNotice("");
    }

    try {
      const response = await fetch(
        "/api/story-creator/extract",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: project.id,
            sourceMessageId: targetSourceMessageId,
            paidOperationAuthorization: options.paidOperationAuthorized
              ? {
                  approved: true,
                  operation: "story-memory-extraction",
                  maxOutputTokens: 1000,
                }
              : undefined,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not extract Story information.",
          ),
        );
      }

      const factCount = Number(data?.factsAutoSaved || 0);
      const conflictCount =
        Number(data?.conflictsCreated || 0) +
        Number(data?.conflictsExisting || 0);
      const summary = String(data?.message || "").trim() ||
        `Story details updated. ${factCount} details saved. ${conflictCount} conflicts need your attention.`;

      await loadStoryBible(project.id);
      await loadStoryOpenQuestions(project.id);
      await loadStoryConflicts(project.id);
      await loadStoryUsage(project.id);

      if (!options.silent) {
        setStoryExtractionNotice(summary);
      }

      if (
        !options.stayInIdeas &&
        (factCount || conflictCount)
      ) {
        setStoryMemoryOpen(true);
      }

      return {
        ok: true,
        summary,
      };
    } catch (error) {
      const summary =
        error instanceof Error
          ? error.message
          : "Could not extract Story information.";

      if (!options.silent) {
        setStoryExtractionError(summary);
      }

      return {
        ok: false,
        summary,
      };
    } finally {
      setStoryExtractionBusy(false);
    }
  }

  async function resolveStoryConflict(
    conflictId: string,
    action: StoryConflictAction,
    valueText?: string,
  ) {
    const project = selectedProject;

    if (
      !project ||
      !conflictId ||
      storyConflictActionBusyId
    ) {
      return;
    }

    setStoryConflictActionBusyId(conflictId);
    setStoryConflictsError("");

    try {
      const response = await fetch(
        "/api/story-creator/conflicts",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: project.id,
            conflictId,
            action,
            ...(valueText === undefined
              ? {}
              : { valueText }),
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not resolve Story conflict.",
          ),
        );
      }

      await loadStoryBible(project.id);
      await loadStoryConflicts(project.id);
    } catch (error) {
      setStoryConflictsError(
        error instanceof Error
          ? error.message
          : "Could not resolve Story conflict.",
      );
    } finally {
      setStoryConflictActionBusyId("");
    }
  }

  async function changeStoryCanonFact(
    action: "update-fact" | "delete-fact",
    factId: string,
    valueText?: string,
  ) {
    const project = selectedProject;
    if (!project || !factId) return;
    setStoryBibleError("");
    try {
      const response = await fetch("/api/story-creator/bible/write", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, action, factId, valueText }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data, "Could not update Story Memory."));
      await loadStoryBible(project.id);
      await loadStoryConflicts(project.id);
    } catch (error) {
      setStoryBibleError(error instanceof Error ? error.message : "Could not update Story Memory.");
    }
  }

  async function sendStoryMessage() {
    const project = selectedProject;
    const content = draft.trim();

    if (
      !project ||
      !content ||
      chatBusy ||
      storySendLockRef.current
    ) {
      return;
    }
    storySendLockRef.current = true;
    let transientAssistantId = "";
    setChatBusy(true);
    setChatError("");
    setStoryDirectorVisualActionError("");
    if (!isStoryVisualActionInstruction(content)) {
      setStoryDirectorVisualAction(null);
    }

    try {
      const savedUserMessage =
        await persistMessage(
          project.id,
          "user",
          content,
        );

      const history = [
        ...storyMessages,
        savedUserMessage,
      ];

      setStoryMessages(history);
      setDraft("");

      if (isStoryVisualActionInstruction(content)) {
        const actionResponse = await fetch(
          "/api/story-creator/visual-actions",
          {
            method: "POST",
            cache: "no-store",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: project.id, instruction: content }),
          },
        );
        const actionData = await actionResponse.json().catch(() => ({}));
        if (!actionResponse.ok || !actionData.action) {
          throw new Error(errorMessage(actionData, "Story Director could not prepare the Qwen image action."));
        }

        const action = actionData.action as StoryVisualDirectorAction;
        if (action.action === "clarify") {
          const clarification = action.questions.join("\n");
          const savedAssistantMessage = await persistMessage(
            project.id,
            "assistant",
            clarification,
          );
          setStoryDirectorVisualAction(null);
          setStoryMessages([...history, savedAssistantMessage]);
          setProjects((current) => current.map((item) => item.id === project.id
            ? { ...item, updatedAt: savedAssistantMessage.createdAt }
            : item));
          return;
        }
        const savedAssistantMessage = await persistMessage(
          project.id,
          "assistant",
          action.action === "prepare-edit"
            ? `I prepared the requested change to ${action.name}. Review it below, then choose Change Image to authorize one edit.`
            : `I prepared a focused visual design for ${action.name}. Review it below, then choose Create Image to authorize one image.`,
        );
        setStoryDirectorVisualAction(action);
        setStoryDirectorVisualActionError("");
        setStoryMessages([...history, savedAssistantMessage]);
        setProjects((current) =>
          current.map((item) =>
            item.id === project.id
              ? { ...item, updatedAt: savedAssistantMessage.createdAt }
              : item,
          ),
        );
        return;
      }

      const aiResponse = await fetch(
        "/api/ollama-ai/chat",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/x-ndjson, application/json",
            "x-otg-ai-assistance": "1",
            "x-otg-ai-assistance-profile":
              "story-helper",
            "x-otg-story-creator": "1",
            "x-otg-stream": "1",
          },
          body: JSON.stringify({
            projectId: project.id,
            messages: history.map(
              ({ role, content }) => ({
                role,
                content,
              }),
            ),
          }),
        },
      );

      if (!aiResponse.ok) {
        const aiData = await aiResponse.json().catch(() => ({}));
        throw new Error(
          errorMessage(
            aiData,
            "Story Director could not respond.",
          ),
        );
      }

      let responseText = "";
      if ((aiResponse.headers.get("content-type") || "").includes("application/x-ndjson")) {
        transientAssistantId = `story-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const transientMessage: StoryMessage = {
          id: transientAssistantId,
          projectId: project.id,
          ownerKey,
          role: "assistant",
          content: "",
          createdAt: Date.now(),
        };
        setStoryMessages([...history, transientMessage]);
        responseText = await readStoryDirectorStream(aiResponse, (text) => {
          setStoryMessages((current) => current.map((message) =>
            message.id === transientAssistantId
              ? { ...message, content: text }
              : message));
        });
      } else {
        const aiData = await aiResponse.json().catch(() => ({}));
        responseText = assistantText(aiData);
      }

      if (!responseText) {
        throw new Error(
          "Story Director returned an empty response.",
        );
      }

      const savedAssistantMessage =
        await persistMessage(
          project.id,
          "assistant",
          responseText,
        );

      setStoryMessages([
        ...history,
        savedAssistantMessage,
      ]);

      setProjects((current) =>
        current.map((item) =>
          item.id === project.id
            ? {
                ...item,
                updatedAt:
                  savedAssistantMessage.createdAt,
              }
            : item,
        ),
      );

      setStoryExtractionNotice(
        "Story Director turn saved. Story Memory extraction is deferred until you explicitly authorize Review Story Details.",
      );
    } catch (error) {
      if (transientAssistantId) {
        setStoryMessages((current) =>
          current.filter((message) => message.id !== transientAssistantId),
        );
      }
      if (isStoryVisualActionInstruction(content)) {
        setStoryDirectorVisualActionError(
          error instanceof Error
            ? error.message
            : "Story Director could not prepare the Qwen image action.",
        );
      }
      setChatError(
        error instanceof Error
          ? error.message
          : "Story Director request failed.",
      );
    } finally {
      storySendLockRef.current = false;
      setChatBusy(false);
    }
  }

  if (selectedProject) {
    const selectedProjectUpdatedLabel = formatDate(
      selectedProject.updatedAt,
    );

    return (
      <div className="min-w-0 space-y-4">
        <StoryCreatorHeader
          project={selectedProject}
          updatedLabel={selectedProjectUpdatedLabel}
          onBack={() => setSelectedProjectId("")}
        />

        <StoryStudioShell
          mode={storyProductionMode}
          memoryOpen={storyMemoryOpen}
          productionOpen={storyProductionOpen}
          activeTool={
            storyCreatorStage === "design" ||
            storyCreatorStage === "audio" ||
            storyCreatorStage === "produce" ||
            storyCreatorStage === "movie"
              ? storyCreatorStage
              : "write"
          }
          canonCount={storyBibleFactsByStatus.canon.length}
          suggestionCount={storyBiblePendingFacts.length}
          assetCount={storyAssets.length}
          openConflictCount={storyConflicts.length}
          onModeChange={changeStoryProductionMode}
          onMemoryOpenChange={(open) => {
            setStoryMemoryOpen(open);
          }}
          onProductionOpenChange={(open) => {
            setStoryProductionOpen(open);
            if (
              open &&
              storyCreatorStage !== "design" &&
              storyCreatorStage !== "audio" &&
              storyCreatorStage !== "produce" &&
              storyCreatorStage !== "movie"
            ) {
              setStoryCreatorStage("write");
            }
          }}
          onToolChange={changeStoryStudioTool}
          director={(
            <IdeasTab
            projectId={selectedProject.id}
            projectTitle={selectedProject.title}
            vocabularyKeywords={storyVoiceVocabularyKeywords}
            storyMessages={storyMessages}
            messagesLoading={messagesLoading}
            chatBusy={chatBusy}
            chatError={chatError}
            draft={draft}
            chatEndRef={chatEndRef}
            extractionBusy={storyExtractionBusy}
            extractionError={storyExtractionError}
            extractionNotice={storyExtractionNotice}
            extractionSourceMessageId={
              extractionSourceMessageId
            }
            storyUsage={storyUsage}
            openQuestions={storyOpenQuestions}
            openQuestionsLoading={
              storyOpenQuestionsLoading
            }
            openQuestionsError={
              storyOpenQuestionsError
            }
            onDraftChange={setDraft}
            onSend={() => void sendStoryMessage()}
            onExtract={(sourceMessageId) => {
              const authorized = window.confirm(
                "Reviewing your story will use AI credits. Continue?",
              );

              if (authorized) {
                void extractStoryInformation(sourceMessageId, {
                  paidOperationAuthorized: true,
                });
              }
            }}
            visualAction={storyDirectorVisualAction}
            visualActionError={storyDirectorVisualActionError}
            />
          )}
          memory={(
            <BibleTab
            storyBibleEntities={storyBibleEntities}
            storyBibleFacts={storyBibleFacts}
            storyBibleEntityNames={storyBibleEntityNames}
            storyBibleLoading={storyBibleLoading}
            storyBibleError={storyBibleError}
            storyConflicts={storyConflicts}
            storyConflictsLoading={
              storyConflictsLoading
            }
            storyConflictsBusy={storyConflictsBusy}
            storyConflictBusyId={
              storyConflictActionBusyId
            }
            storyConflictsError={storyConflictsError}
            onCheckConflicts={() =>
              void checkStoryConflicts()
            }
            onBack={() => setStoryMemoryOpen(false)}
            onUpdateFact={(factId, valueText) => void changeStoryCanonFact("update-fact", factId, valueText)}
            onDeleteFact={(factId) => void changeStoryCanonFact("delete-fact", factId)}
            onResolveConflict={(
              conflictId,
              action,
              valueText,
            ) =>
              void resolveStoryConflict(
                conflictId,
                action,
                valueText,
              )
            }
            />
          )}
          design={(
            <DesignTab
            projectId={selectedProject?.id || ""}
            productionPlan={storyProductionPlan}
            productionMode={storyProductionMode}
            directorVisualAction={storyDirectorVisualAction}
            entities={storyBibleEntities}
            assetsLabel="Assets"
            assets={storyAssets}
            assetsLoading={storyAssetsLoading}
            assetBusy={storyAssetBusy}
            assetError={storyAssetError}
            assetNotice={storyAssetNotice}
            refreshingAssetIds={storyAssetStatusBusyIds}
            onCreateAsset={(input) =>
              void createStoryAsset(input)
            }
            onRefreshAsset={(assetId) =>
              void refreshStoryAssetStatus(assetId)
            }
            onSaveVoiceProfile={(input) =>
              void saveStoryVoiceProfile(input)
            }
            onLoadDesignContext={loadStoryDesignContext}
            onGenerateFromStory={generateStoryDesignFromContext}
            />
          )}
          writing={(
            <div className="space-y-6">
              <ProductionPlanner
                record={storyProductionPlan}
                workload={storyPlanWorkload}
                versions={storyPlanVersions}
                loading={storyPlanLoading}
                busy={storyPlanBusy}
                error={storyPlanError}
                notice={storyPlanNotice}
                onCreateManual={(targetDurationSeconds) =>
                  void updateStoryProductionPlan("create", {
                    targetDurationSeconds,
                  })
                }
                onGenerate={(direction, targetDurationSeconds) =>
                  void updateStoryProductionPlan("generate", {
                    direction,
                    targetDurationSeconds,
                  })
                }
                onSave={(plan: StoryProductionPlan) =>
                  void updateStoryProductionPlan("save", { plan })
                }
                onApprove={() =>
                  void updateStoryProductionPlan("approve")
                }
              />
              <WriteTab
                mode={storyWritingMode}
                instruction={storyWritingInstruction}
                draft={storyWritingDraft}
                busy={storyWritingBusy}
                error={storyWritingError}
                onModeChange={setStoryWritingMode}
                onInstructionChange={
                  setStoryWritingInstruction
                }
                onGenerate={() =>
                  void generateStoryWriting()
                }
              />
            </div>
          )}
          production={(
            <div className="space-y-6">
              <StoryVideoProductionStudio
                projectId={selectedProject.id}
                record={storyProductionPlan}
                mode={storyProductionMode}
              />
              <ProduceTab
                assets={storyAssets}
                canonCount={
                  storyBibleFactsByStatus.canon.length
                }
                openConflictCount={storyConflicts.length}
                busy={storyExportBusy}
                error={storyExportError}
                notice={storyExportNotice}
                storyPackage={storyProductionPackage}
                onCreatePackage={() =>
                  void createStoryProductionPackage()
                }
              />
            </div>
          )}
          audio={(
            <StoryAudioProductionStudio
              projectId={selectedProject.id}
              record={storyProductionPlan}
              mode={storyProductionMode}
            />
          )}
          movie={(
            <StoryMovieEditor
              projectId={selectedProject.id}
              record={storyProductionPlan}
              mode={storyProductionMode}
            />
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-white/10 bg-black/45 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200/70">
          SLR Studios
        </p>

        <h1 className="mt-2 text-4xl font-black tracking-tight text-white">
          Story Creator
        </h1>

        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/62">
          Develop a story with an AI creative partner,
          preserve its canon, and eventually turn
          characters, locations, scenes, dialogue,
          images, voices, music, and video into one
          connected production.
        </p>
      </div>

      <div className="rounded-[24px] border border-white/10 bg-black/35 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/45">
              New Story
            </span>

            <input
              value={newTitle}
              onChange={(event) =>
                setNewTitle(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void createProject();
                }
              }}
              placeholder="Story title required"
              maxLength={120}
              className="w-full rounded-[14px] border border-white/10 bg-black/45 px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-white/30 focus:border-cyan-300/40"
            />
          </label>

          <button
            type="button"
            onClick={() => void createProject()}
            disabled={
              busy ||
              !newTitle.trim() ||
              projects.length >= STORY_LIMIT
            }
            className="rounded-[14px] bg-cyan-300 px-5 py-3 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? "Working..."
              : "+ New Story"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-white/45">
            {projects.length} of {STORY_LIMIT} active
            Stories
          </span>

          {projects.length >= STORY_LIMIT ? (
            <span className="font-bold text-amber-200/80">
              Delete a Story to create another.
            </span>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">
          {notice}
        </div>
      ) : null}

      {projects.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <article
              key={project.id}
              className="rounded-[24px] border border-white/10 bg-black/35 p-5"
            >
              <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200/55">
                Story Project
              </div>

              <h2 className="mt-2 line-clamp-2 text-xl font-black text-white">
                {project.title}
              </h2>

              <div className="mt-3 text-xs text-white/45">
                Updated{" "}
                {formatDate(project.updatedAt)}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedProjectId(
                      project.id,
                    )
                  }
                  className="rounded-[12px] bg-white px-4 py-2 text-xs font-black text-black transition hover:bg-cyan-100"
                >
                  Continue
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void renameProject(project)
                  }
                  disabled={busy}
                  className="rounded-[12px] border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-black text-white/75 transition hover:bg-white/[0.09]"
                >
                  Rename
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void deleteProject(project)
                  }
                  disabled={busy}
                  className="rounded-[12px] border border-red-400/20 bg-red-500/10 px-4 py-2 text-xs font-black text-red-100/80 transition hover:bg-red-500/15"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-white/15 bg-black/25 p-8 text-center">
          <div className="text-lg font-black text-white">
            No Story projects yet
          </div>

          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/55">
            Create the first Story and begin talking
            naturally with its persistent Story Director.
          </p>
        </div>
      )}
    </div>
  );
}
