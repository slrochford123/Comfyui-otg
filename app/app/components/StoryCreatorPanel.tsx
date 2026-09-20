"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type StoryProject = {
  id: string;
  ownerKey: string;
  title: string;
  format: string;
  genre: string;
  matureLanguageEnabled: boolean;
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

type PendingStoryTurn = {
  projectId: string;
  content: string;
  clientTurnId: string;
};

const STORY_CLIENT_TURN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * STORY_CREATOR_PENDING_TURN_V1
 */
function newStoryClientTurnId() {
  const cryptoApi =
    typeof window !== "undefined"
      ? window.crypto
      : undefined;

  if (
    cryptoApi &&
    typeof cryptoApi.randomUUID === "function"
  ) {
    try {
      return cryptoApi.randomUUID();
    } catch {
      // Fall through to getRandomValues for non-secure HTTP contexts.
    }
  }

  if (
    !cryptoApi ||
    typeof cryptoApi.getRandomValues !== "function"
  ) {
    throw new Error(
      "Secure Story Director request IDs are unavailable in this browser.",
    );
  }

  const bytes =
    new Uint8Array(16);

  cryptoApi.getRandomValues(
    bytes,
  );

  bytes[6] =
    (bytes[6] & 0x0f) | 0x40;

  bytes[8] =
    (bytes[8] & 0x3f) | 0x80;

  const hex =
    Array.from(
      bytes,
      (value) =>
        value
          .toString(16)
          .padStart(2, "0"),
    );

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function pendingStoryTurnStorageKey(
  projectId: string,
) {
  return (
    "otg:story-creator:pending-turn:" +
    projectId
  );
}

function readPendingStoryTurn(
  projectId: string,
): PendingStoryTurn | null {
  if (
    typeof window === "undefined" ||
    !projectId
  ) {
    return null;
  }

  try {
    const raw =
      window.sessionStorage.getItem(
        pendingStoryTurnStorageKey(
          projectId,
        ),
      );

    if (!raw) {
      return null;
    }

    const value =
      JSON.parse(raw) as
        Partial<PendingStoryTurn>;

    if (
      value.projectId !== projectId ||
      typeof value.content !== "string" ||
      !value.content.trim() ||
      typeof value.clientTurnId !== "string" ||
      !STORY_CLIENT_TURN_ID_PATTERN.test(
        value.clientTurnId,
      )
    ) {
      window.sessionStorage.removeItem(
        pendingStoryTurnStorageKey(
          projectId,
        ),
      );

      return null;
    }

    return {
      projectId,
      content: value.content,
      clientTurnId:
        value.clientTurnId,
    };
  } catch {
    return null;
  }
}

function writePendingStoryTurn(
  projectId: string,
  pending:
    PendingStoryTurn | null,
) {
  if (
    typeof window === "undefined" ||
    !projectId
  ) {
    return;
  }

  try {
    const key =
      pendingStoryTurnStorageKey(
        projectId,
      );

    if (!pending) {
      window.sessionStorage.removeItem(
        key,
      );

      return;
    }

    window.sessionStorage.setItem(
      key,
      JSON.stringify(
        pending,
      ),
    );
  } catch {
    // In-memory retry identity remains available.
  }
}

function storyMessage(
  value: unknown,
  expectedRole:
    StoryMessage["role"],
): StoryMessage | null {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return null;
  }

  const message =
    value as Partial<StoryMessage>;

  if (
    typeof message.id !== "string" ||
    !message.id ||
    message.role !== expectedRole
  ) {
    return null;
  }

  return message as StoryMessage;
}

function mergeStoryMessages(
  current: StoryMessage[],
  incoming: StoryMessage[],
) {
  const byId =
    new Map<string, StoryMessage>();

  for (const message of current) {
    byId.set(
      message.id,
      message,
    );
  }

  for (const message of incoming) {
    byId.set(
      message.id,
      message,
    );
  }

  return Array.from(
    byId.values(),
  ).sort(
    (a, b) =>
      a.createdAt -
        b.createdAt ||
      a.id.localeCompare(
        b.id,
      ),
  );
}

export default function StoryCreatorPanel({
  ownerKey,
}: Props) {
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] =
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

  const [storyBibleEntities, setStoryBibleEntities] =
    useState<StoryBibleEntity[]>([]);
  const [storyBibleFacts, setStoryBibleFacts] =
    useState<StoryBibleFact[]>([]);
  const [storyBibleLoading, setStoryBibleLoading] =
    useState(false);
  const [storyBibleError, setStoryBibleError] =
    useState("");

  const [
    storyReferenceOpen,
    setStoryReferenceOpen,
  ] = useState(true);

  const [
    expandedStoryReferenceIds,
    setExpandedStoryReferenceIds,
  ] = useState<string[]>([]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const storySendLockRef = useRef(false);
  const storyPendingTurnRef =
    useRef<PendingStoryTurn | null>(null);

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

  const storyReferenceRecentMentions = useMemo(
    () => {
      const recentUserText = storyMessages
        .filter(
          (message) =>
            message.role === "user",
        )
        .slice(-8)
        .map(
          (message) =>
            message.content,
        )
        .join("\n");

      const matches =
        recentUserText.match(
          /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+|[A-Z][a-z]{3,})\b/g,
        ) || [];

      const ignored =
        new Set([
          "The",
          "This",
          "That",
          "These",
          "Those",
          "Give",
          "Tell",
          "Treat",
          "Everything",
          "Character",
          "Characters",
          "Story",
          "Director",
          "Canon",
          "Unknown",
          "Suggestion",
          "Suggestions",
        ]);

      const seen =
        new Set<string>();

      const mentions:
        string[] = [];

      for (const match of matches) {
        const value =
          match.trim();

        if (
          !value ||
          ignored.has(value) ||
          seen.has(value)
        ) {
          continue;
        }

        seen.add(value);
        mentions.push(value);

        if (
          mentions.length >= 8
        ) {
          break;
        }
      }

      return mentions;
    },
    [storyMessages],
  );

  const storyReferenceRecentText =
    useMemo(
      () =>
        storyMessages
          .slice(-8)
          .map(
            (message) =>
              message.content,
          )
          .join("\n")
          .toLocaleLowerCase(),
      [storyMessages],
    );

  const storyReferenceGroups =
    useMemo(() => {
      const factsByEntity =
        new Map<
          string,
          StoryBibleFact[]
        >();

      for (
        const fact of
        storyBibleFacts
      ) {
        if (
          !fact.subjectEntityId
        ) {
          continue;
        }

        const current =
          factsByEntity.get(
            fact.subjectEntityId,
          ) || [];

        current.push(fact);

        factsByEntity.set(
          fact.subjectEntityId,
          current,
        );
      }

      function categoryFor(
        entityType: string,
      ) {
        const type =
          entityType
            .trim()
            .toLocaleLowerCase();

        if (
          /character|person|people|hero|villain/.test(
            type,
          )
        ) {
          return "Characters";
        }

        if (
          /location|place|city|world|region|kingdom|building/.test(
            type,
          )
        ) {
          return "Locations";
        }

        if (
          /power|ability|skill|magic|spell/.test(
            type,
          )
        ) {
          return "Powers & Abilities";
        }

        if (
          /object|item|artifact|weapon|vehicle|relic/.test(
            type,
          )
        ) {
          return "Key Objects";
        }

        return "Other";
      }

      const groupOrder = [
        "Characters",
        "Locations",
        "Powers & Abilities",
        "Key Objects",
        "Other",
      ];

      return groupOrder
        .map((label) => ({
          label,

          items:
            storyBibleEntities
              .filter(
                (entity) =>
                  categoryFor(
                    entity.entityType,
                  ) === label,
              )
              .map(
                (entity) => ({
                  entity,

                  facts:
                    factsByEntity.get(
                      entity.id,
                    ) || [],

                  mentioned:
                    Boolean(
                      entity.name.trim(),
                    ) &&
                    storyReferenceRecentText.includes(
                      entity.name
                        .trim()
                        .toLocaleLowerCase(),
                    ),
                }),
              )
              .sort(
                (a, b) => {
                  if (
                    a.mentioned !==
                    b.mentioned
                  ) {
                    return a.mentioned
                      ? -1
                      : 1;
                  }

                  return (
                    a.entity.name.localeCompare(
                      b.entity.name,
                    )
                  );
                },
              ),
        }))
        .filter(
          (group) =>
            group.items.length > 0,
        );
    }, [
      storyBibleEntities,
      storyBibleFacts,
      storyReferenceRecentText,
    ]);

  const storyReferenceStoryFacts =
    useMemo(
      () =>
        storyBibleFacts.filter(
          (fact) =>
            !fact.subjectEntityId,
        ),
      [storyBibleFacts],
    );

  function toggleStoryReferenceEntity(
    entityId: string,
  ) {
    setExpandedStoryReferenceIds(
      (current) =>
        current.includes(
          entityId,
        )
          ? current.filter(
              (id) =>
                id !== entityId,
            )
          : [
              ...current,
              entityId,
            ],
    );
  }

  const loadProjects = useCallback(async () => {
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
      } catch (error) {
        setStoryBibleEntities([]);
        setStoryBibleFacts([]);

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

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedProjectId) {
      setStoryMessages([]);
      setChatError("");
      setDraft("");

      setStoryBibleEntities([]);
      setStoryBibleFacts([]);
      setStoryBibleError("");

      return;
    }

    void loadStoryMessages(selectedProjectId);
    void loadStoryBible(selectedProjectId);
  }, [
    selectedProjectId,
    loadStoryMessages,
    loadStoryBible,
  ]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    });
  }, [storyMessages, chatBusy]);

  async function createProject() {
    if (busy) return;

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
            title:
              newTitle.trim() || "Untitled Story",
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
    if (busy) return;

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

  async function setMatureLanguage(
    project: StoryProject,
    enabled: boolean,
  ) {
    if (busy) return;

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
            matureLanguageEnabled:
              enabled,
          }),
        },
      );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            "Could not update Mature Language.",
          ),
        );
      }

      const updated =
        data?.project as StoryProject;

      setProjects((current) =>
        current.map((item) =>
          item.id === updated.id
            ? updated
            : item,
        ),
      );

      setNotice(
        updated.matureLanguageEnabled
          ? "Mature Language enabled."
          : "Mature Language disabled.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not update Mature Language.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(
    project: StoryProject,
  ) {
    if (busy) return;

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

  async function sendStoryMessage() {
    const project =
      selectedProject;

    const content =
      draft.trim();

    if (
      !project ||
      !content ||
      chatBusy ||
      storySendLockRef.current
    ) {
      return;
    }

    storySendLockRef.current = true;
    setChatBusy(true);
    setChatError("");

    const inMemoryPending =
      storyPendingTurnRef.current;

    const storedPending =
      readPendingStoryTurn(
        project.id,
      );

    const rememberedPending =
      inMemoryPending?.projectId ===
        project.id
        ? inMemoryPending
        : storedPending;

    const pendingTurn:
      PendingStoryTurn =
      rememberedPending &&
      rememberedPending.content ===
        content
        ? rememberedPending
        : {
            projectId:
              project.id,
            content,
            clientTurnId:
              newStoryClientTurnId(),
          };

    storyPendingTurnRef.current =
      pendingTurn;

    writePendingStoryTurn(
      project.id,
      pendingTurn,
    );

    try {
      const response =
        await fetch(
          "/api/story-creator/turn",
          {
            method: "POST",
            cache: "no-store",
            credentials: "include",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                projectId:
                  project.id,
                content,
                clientTurnId:
                  pendingTurn.clientTurnId,
              }),
          },
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      const returnedUser =
        storyMessage(
          data?.userMessage,
          "user",
        );

      const returnedAssistant =
        storyMessage(
          data?.assistantMessage,
          "assistant",
        );

      const returnedMessages =
        [
          returnedUser,
          returnedAssistant,
        ].filter(
          (
            message,
          ): message is StoryMessage =>
            Boolean(message),
        );

      if (
        returnedMessages.length
      ) {
        setStoryMessages(
          (current) =>
            mergeStoryMessages(
              current,
              returnedMessages,
            ),
        );
      }

      if (!response.ok) {
        const code =
          typeof data?.code === "string"
            ? data.code
            : "";

        if (
          code ===
            "STORY_DIRECTOR_TURN_ID_CONFLICT" ||
          code ===
            "STORY_DIRECTOR_CLIENT_TURN_ID_INVALID"
        ) {
          storyPendingTurnRef.current =
            null;

          writePendingStoryTurn(
            project.id,
            null,
          );
        }

        throw new Error(
          errorMessage(
            data,
            code ===
              "STORY_DIRECTOR_TURN_IN_PROGRESS"
              ? "Story Director is still processing this turn. Retry shortly."
              : "Story Director could not respond.",
          ),
        );
      }

      if (
        !returnedUser?.id ||
        !returnedAssistant?.id
      ) {
        throw new Error(
          "Story Director returned an invalid persisted turn.",
        );
      }

      storyPendingTurnRef.current =
        null;

      writePendingStoryTurn(
        project.id,
        null,
      );

      setDraft("");

      setProjects(
        (current) =>
          current.map(
            (item) =>
              item.id ===
              project.id
                ? {
                    ...item,
                    updatedAt:
                      returnedAssistant.createdAt,
                  }
                : item,
          ),
      );
    } catch (error) {
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
    return (
      <div className="space-y-4">
        <div className="rounded-[28px] border border-white/10 bg-black/45 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200/70">
                Story Creator
              </p>

              <h1 className="mt-2 text-4xl font-black tracking-tight text-white">
                {selectedProject.title}
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-white/62">
                Your Story Director conversation is
                saved inside this Story and reloads
                whenever you return.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={
                    selectedProject.matureLanguageEnabled
                  }
                  onClick={() =>
                    void setMatureLanguage(
                      selectedProject,
                      !selectedProject.matureLanguageEnabled,
                    )
                  }
                  disabled={busy}
                  className={
                    selectedProject.matureLanguageEnabled
                      ? "rounded-full border border-amber-300/35 bg-amber-300/15 px-3 py-1.5 text-xs font-black text-amber-100 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-50"
                      : "rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-black text-white/60 transition hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-50"
                  }
                >
                  Mature Language:{" "}
                  {selectedProject.matureLanguageEnabled
                    ? "On"
                    : "Off"}
                </button>

                <span className="max-w-xl text-[11px] leading-5 text-white/40">
                  When on, the Story Director may use
                  strong language when it fits the
                  requested dialogue, tone, or scene.
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setSelectedProjectId("")
              }
              className="rounded-[14px] border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-black text-white/75 transition hover:bg-white/[0.09]"
            >
              Back to Stories
            </button>
          </div>
        </div>

        <div
          className={
            storyReferenceOpen
              ? "grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,0.9fr)]"
              : "grid gap-4 xl:grid-cols-[minmax(0,1fr)_64px]"
          }
        >
          <section className="flex min-h-[620px] flex-col rounded-[24px] border border-cyan-300/15 bg-black/40">
            <div className="border-b border-white/10 p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/60">
                Story Director
              </p>

              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-black text-white">
                  Conversation
                </h2>

                <span className="text-xs text-white/35">
                  {storyMessages.length} saved messages
                </span>
              </div>

              <p className="mt-2 text-xs leading-5 text-white/45">
                Uses the existing Story Helper strict-canon
                protections. User and assistant turns are
                persisted server-side.
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {messagesLoading ? (
                <div className="text-sm text-white/45">
                  Loading conversation...
                </div>
              ) : storyMessages.length ? (
                storyMessages.map((item) => (
                  <div
                    key={item.id}
                    className={
                      item.role === "user"
                        ? "ml-auto max-w-[88%] rounded-[18px] bg-cyan-300 px-4 py-3 text-sm leading-6 text-black"
                        : "mr-auto max-w-[92%] rounded-[18px] border border-white/10 bg-white/[0.06] px-4 py-3 text-sm leading-6 text-white/82"
                    }
                  >
                    <div className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] opacity-55">
                      {item.role === "user"
                        ? "You"
                        : "Story Director"}
                    </div>

                    <div className="whitespace-pre-wrap">
                      {item.content}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.025] p-5">
                  <div className="font-black text-white">
                    Start telling me your story.
                  </div>

                  <p className="mt-2 text-sm leading-6 text-white/52">
                    You can describe characters, the world,
                    scenes, relationships, problems, ideas,
                    or simply talk naturally. This
                    conversation will remain attached to
                    this Story.
                  </p>
                </div>
              )}

              {chatBusy ? (
                <div className="mr-auto rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/50">
                  Story Director is thinking...
                </div>
              ) : null}

              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-white/10 p-4">
              {chatError ? (
                <div className="mb-3 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
                  {chatError}
                </div>
              ) : null}

              <textarea
                value={draft}
                onChange={(event) =>
                  setDraft(event.target.value)
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    void sendStoryMessage();
                  }
                }}
                placeholder="Tell the Story Director what happens next..."
                rows={4}
                disabled={chatBusy}
                className="w-full resize-y rounded-[16px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-cyan-300/40 disabled:opacity-60"
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] text-white/35">
                  Ctrl/Cmd + Enter to send
                </span>

                <button
                  type="button"
                  disabled={
                    chatBusy ||
                    !draft.trim()
                  }
                  onClick={() =>
                    void sendStoryMessage()
                  }
                  className="rounded-[14px] bg-cyan-300 px-5 py-2.5 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {chatBusy
                    ? "Thinking..."
                    : "Send"}
                </button>
              </div>
            </div>
          </section>

          <div
            className={
              storyReferenceOpen
                ? "space-y-4"
                : "[&>div]:hidden"
            }
          >
            <aside
              className={
                storyReferenceOpen
                  ? "rounded-[24px] border border-cyan-300/20 bg-black/50 p-4"
                  : "flex min-h-[64px] items-center justify-center rounded-[18px] border border-cyan-300/20 bg-cyan-300/[0.04] p-2 xl:min-h-[620px]"
              }
            >
              {storyReferenceOpen ? (
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/65">
                        Story Reference
                      </p>

                      <h2 className="mt-1 text-lg font-black text-white">
                        Quick Reference
                      </h2>
                    </div>

                    <button
                      type="button"
                      aria-label="Collapse Story Reference"
                      title="Collapse Story Reference"
                      onClick={() =>
                        setStoryReferenceOpen(false)
                      }
                      className="rounded-[10px] border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-sm font-black text-white/60 transition hover:bg-white/[0.1] hover:text-white"
                    >
                      ›
                    </button>
                  </div>

                  <p className="mt-2 text-xs leading-5 text-white/42">
                    Fast reminders while you write.
                    Durable cards come from the Story
                    Bible. Recent mentions are temporary
                    and never change canon.
                  </p>

                  {storyReferenceRecentMentions.length ? (
                    <section className="mt-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.14em] text-white/45">
                          Recent Mentions
                        </h3>

                        <span className="text-[9px] uppercase tracking-[0.1em] text-white/25">
                          Not saved
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {storyReferenceRecentMentions.map(
                          (mention) => (
                            <span
                              key={mention}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-white/55"
                            >
                              {mention}
                            </span>
                          ),
                        )}
                      </div>
                    </section>
                  ) : null}

                  {storyBibleLoading ? (
                    <div className="mt-4 text-xs text-white/40">
                      Loading reference...
                    </div>
                  ) : storyBibleError ? (
                    <div className="mt-4 rounded-[12px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/75">
                      {storyBibleError}
                    </div>
                  ) : storyReferenceGroups.length ||
                    storyReferenceStoryFacts.length ? (
                    <div className="mt-5 space-y-5">
                      {storyReferenceGroups.map(
                        (group) => (
                          <section key={group.label}>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <h3 className="text-[10px] font-black uppercase tracking-[0.15em] text-cyan-100/60">
                                {group.label}
                              </h3>

                              <span className="text-[10px] text-white/30">
                                {group.items.length}
                              </span>
                            </div>

                            <div className="space-y-2">
                              {group.items.map(
                                (item) => {
                                  const expanded =
                                    expandedStoryReferenceIds.includes(
                                      item.entity.id,
                                    );

                                  const canonFacts =
                                    item.facts.filter(
                                      (fact) =>
                                        fact.canonStatus ===
                                        "canon",
                                    );

                                  const visibleFacts =
                                    expanded
                                      ? item.facts
                                      : canonFacts.slice(
                                          0,
                                          3,
                                        );

                                  return (
                                    <div
                                      key={
                                        item.entity.id
                                      }
                                      className="rounded-[14px] border border-white/10 bg-white/[0.035] p-3"
                                    >
                                      <button
                                        type="button"
                                        onClick={() =>
                                          toggleStoryReferenceEntity(
                                            item.entity.id,
                                          )
                                        }
                                        className="flex w-full items-start justify-between gap-3 text-left"
                                      >
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="truncate text-sm font-black text-white/88">
                                              {
                                                item.entity
                                                  .name
                                              }
                                            </span>

                                            {item.mentioned ? (
                                              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-cyan-100/75">
                                                Mentioned
                                              </span>
                                            ) : null}
                                          </div>

                                          <div className="mt-1 text-[9px] uppercase tracking-[0.1em] text-white/32">
                                            {
                                              item.entity
                                                .entityType
                                            }
                                          </div>
                                        </div>

                                        <span className="shrink-0 text-xs font-black text-white/35">
                                          {expanded
                                            ? "−"
                                            : "+"}
                                        </span>
                                      </button>

                                      {visibleFacts.length ? (
                                        <div className="mt-2 space-y-1.5">
                                          {visibleFacts.map(
                                            (fact) => {
                                              const object =
                                                fact.objectEntityId
                                                  ? storyBibleEntityNames.get(
                                                      fact.objectEntityId,
                                                    ) ||
                                                    "Unknown entity"
                                                  : "";

                                              return (
                                                <div
                                                  key={
                                                    fact.id
                                                  }
                                                  className={
                                                    expanded
                                                      ? "rounded-[10px] bg-black/25 px-2.5 py-2"
                                                      : "text-[11px] leading-4 text-white/58"
                                                  }
                                                >
                                                  {expanded ? (
                                                    <div className="mb-1">
                                                      <span
                                                        className={
                                                          fact.canonStatus ===
                                                          "canon"
                                                            ? "rounded-full border border-cyan-300/25 bg-cyan-300/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-cyan-100/75"
                                                            : fact.canonStatus ===
                                                                "suggestion"
                                                              ? "rounded-full border border-amber-300/25 bg-amber-300/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-amber-100/75"
                                                              : "rounded-full border border-white/15 bg-white/[0.05] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-white/50"
                                                        }
                                                      >
                                                        {
                                                          fact.canonStatus
                                                        }
                                                      </span>
                                                    </div>
                                                  ) : null}

                                                  <span className="font-black text-white/70">
                                                    {
                                                      fact.predicate
                                                    }
                                                  </span>

                                                  {object
                                                    ? ` → ${object}`
                                                    : fact.valueText
                                                      ? `: ${fact.valueText}`
                                                      : ""}
                                                </div>
                                              );
                                            },
                                          )}
                                        </div>
                                      ) : expanded ? (
                                        <div className="mt-2 text-[11px] leading-4 text-white/35">
                                          No facts recorded.
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                },
                              )}
                            </div>
                          </section>
                        ),
                      )}

                      {storyReferenceStoryFacts.length ? (
                        <section>
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.15em] text-cyan-100/60">
                              Key Story Points
                            </h3>

                            <span className="text-[10px] text-white/30">
                              {
                                storyReferenceStoryFacts.length
                              }
                            </span>
                          </div>

                          <div className="space-y-2">
                            {storyReferenceStoryFacts
                              .slice(0, 6)
                              .map((fact) => (
                                <div
                                  key={fact.id}
                                  className="rounded-[12px] border border-white/10 bg-white/[0.03] px-3 py-2"
                                >
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span
                                      className={
                                        fact.canonStatus ===
                                        "canon"
                                          ? "rounded-full border border-cyan-300/25 bg-cyan-300/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-cyan-100/75"
                                          : fact.canonStatus ===
                                              "suggestion"
                                            ? "rounded-full border border-amber-300/25 bg-amber-300/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-amber-100/75"
                                            : "rounded-full border border-white/15 bg-white/[0.05] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-white/50"
                                      }
                                    >
                                      {
                                        fact.canonStatus
                                      }
                                    </span>

                                    <span className="text-[10px] font-black text-white/70">
                                      {fact.predicate}
                                    </span>
                                  </div>

                                  {fact.valueText ? (
                                    <div className="mt-1 text-[11px] leading-4 text-white/52">
                                      {fact.valueText}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                          </div>
                        </section>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[14px] border border-dashed border-white/10 bg-white/[0.02] p-4">
                      <div className="text-xs font-black text-white/65">
                        No durable reference cards yet
                      </div>

                      <p className="mt-1 text-[11px] leading-5 text-white/36">
                        Recent Mentions are temporary.
                        Story Director extraction may add
                        durable suggestion or unknown
                        reference cards after completed turns.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  aria-label="Open Story Reference"
                  title="Open Story Reference"
                  onClick={() =>
                    setStoryReferenceOpen(true)
                  }
                  className="flex h-full w-full items-center justify-center gap-2 text-cyan-100/65 xl:flex-col"
                >
                  <span className="text-lg font-black">
                    ‹
                  </span>

                  <span className="text-[10px] font-black uppercase tracking-[0.15em] xl:[writing-mode:vertical-rl]">
                    Story Reference
                  </span>
                </button>
              )}
            </aside>

            <div className="rounded-[24px] border border-white/10 bg-black/35 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                    Story Bible
                  </p>

                  <h2 className="mt-2 text-xl font-black text-white">
                    Canon & Continuity
                  </h2>
                </div>

                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/45">
                  Review only
                </span>
              </div>

              <p className="mt-2 text-sm leading-6 text-white/60">
                Structured entities and facts are loaded
                from this Story&apos;s durable Story Bible.
                Story Director extraction may add suggestion
                or unknown records, but it cannot promote
                them to canon.
              </p>

              {storyBibleError ? (
                <div className="mt-4 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
                  {storyBibleError}
                </div>
              ) : null}

              {storyBibleLoading ? (
                <div className="mt-4 text-sm text-white/45">
                  Loading Story Bible...
                </div>
              ) : (
                <>
                  <div className="mt-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/65">
                        Entities
                      </h3>

                      <span className="text-[10px] text-white/35">
                        {storyBibleEntities.length}
                      </span>
                    </div>

                    {storyBibleEntities.length ? (
                      <div className="mt-2 space-y-2">
                        {storyBibleEntities.map((entity) => (
                          <div
                            key={entity.id}
                            className="rounded-[12px] border border-white/10 bg-white/[0.035] px-3 py-2"
                          >
                            <div className="text-sm font-black text-white/82">
                              {entity.name}
                            </div>

                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.1em] text-white/35">
                              <span>{entity.entityType}</span>
                              <span>
                                source: {entity.sourceRole}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 rounded-[12px] border border-dashed border-white/10 px-3 py-3 text-xs leading-5 text-white/38">
                        No Story Bible entities yet.
                      </div>
                    )}
                  </div>

                  <div className="mt-5 border-t border-white/10 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/65">
                        Facts
                      </h3>

                      <span className="text-[10px] text-white/35">
                        {storyBibleFacts.length}
                      </span>
                    </div>

                    {(
                      [
                        [
                          "Canon",
                          "canon",
                          storyBibleFactsByStatus.canon,
                        ],
                        [
                          "Suggestions",
                          "suggestion",
                          storyBibleFactsByStatus.suggestion,
                        ],
                        [
                          "Unknown",
                          "unknown",
                          storyBibleFactsByStatus.unknown,
                        ],
                      ] as const
                    ).map(
                      ([
                        label,
                        status,
                        facts,
                      ]) => (
                        <div
                          key={status}
                          className="mt-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white/52">
                              {label}
                            </div>

                            <div className="text-[10px] text-white/30">
                              {facts.length}
                            </div>
                          </div>

                          {facts.length ? (
                            <div className="mt-2 space-y-2">
                              {facts.map((fact) => {
                                const subject =
                                  fact.subjectEntityId
                                    ? storyBibleEntityNames.get(
                                        fact.subjectEntityId,
                                      ) ||
                                      "Unknown entity"
                                    : "Story";

                                const object =
                                  fact.objectEntityId
                                    ? storyBibleEntityNames.get(
                                        fact.objectEntityId,
                                      ) ||
                                      "Unknown entity"
                                    : "";

                                return (
                                  <div
                                    key={fact.id}
                                    className="rounded-[12px] border border-white/10 bg-white/[0.03] px-3 py-2"
                                  >
                                    <div className="text-xs leading-5 text-white/72">
                                      <span className="font-black text-white/88">
                                        {subject}
                                      </span>
                                      {" · "}
                                      {fact.predicate}

                                      {object
                                        ? ` → ${object}`
                                        : fact.valueText
                                          ? `: ${fact.valueText}`
                                          : ""}
                                    </div>

                                    <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-white/30">
                                      Source: {fact.sourceRole}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="mt-2 text-xs text-white/32">
                              No {label.toLowerCase()} facts.
                            </div>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="rounded-[24px] border border-white/10 bg-black/35 p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                Assets
              </p>

              <h2 className="mt-2 text-xl font-black text-white">
                Production
              </h2>

              <p className="mt-2 text-sm leading-6 text-white/60">
                Character references, locations,
                storyboards, video, voices, music, and
                SFX attach here in later phases.
              </p>
            </div>

            <div className="rounded-[24px] border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/60">
                Persistent Story ID
              </div>

              <code className="mt-2 block break-all text-xs leading-5 text-cyan-100/75">
                {selectedProject.id}
              </code>

              <div className="mt-3 text-xs text-white/45">
                Last updated:{" "}
                {formatDate(
                  selectedProject.updatedAt,
                )}
              </div>
            </div>
          </div>
        </div>
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
              placeholder="Story title — or leave blank"
              maxLength={120}
              className="w-full rounded-[14px] border border-white/10 bg-black/45 px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-white/30 focus:border-cyan-300/40"
            />
          </label>

          <button
            type="button"
            onClick={() => void createProject()}
            disabled={
              busy ||
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
