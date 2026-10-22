"use client";

import { useEffect, useState } from "react";

import type {
  StoryProductionPlan,
  StoryProductionPlanRecord,
  StoryProductionScene,
  StoryProductionShot,
} from "@/lib/storyCreator/productionPlan";

export type StoryPlanWorkload = {
  actCount: number;
  sceneCount: number;
  shotCount: number;
  plannedVideoSeconds: number;
  pendingVideoJobs: number;
  acceptedTakes: number;
};

export type StoryPlanVersion = {
  id: string;
  version: number;
  status: "draft" | "approved";
  sourceRole: "user" | "assistant" | "system";
  createdAt: number;
};

type Props = {
  record: StoryProductionPlanRecord | null;
  workload: StoryPlanWorkload | null;
  versions: StoryPlanVersion[];
  loading: boolean;
  busy: boolean;
  error: string;
  notice: string;
  onCreateManual: (targetDurationSeconds: number) => void;
  onGenerate: (
    direction: string,
    targetDurationSeconds: number,
  ) => void;
  onSave: (plan: StoryProductionPlan) => void;
  onApprove: () => void;
};

function localId(prefix: string) {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function blankScene(number: number): StoryProductionScene {
  return {
    id: localId("scene"),
    order: number,
    sceneNumber: String(number),
    title: `Scene ${number}`,
    purpose: "",
    location: "",
    timeOfDay: "",
    characters: [],
    action: "",
    dialogue: [],
    emotionalTone: "",
    continuityRequirements: [],
    durationTargetSeconds: 30,
    screenplaySource: "",
    shots: [],
  };
}

function blankShot(number: number): StoryProductionShot {
  return {
    id: localId("shot"),
    order: number,
    shotNumber: String(number),
    screenplayExcerpt: "",
    description: "",
    cameraFraming: "Medium shot",
    cameraMovement: "Locked camera",
    characterActions: "",
    dialogue: [],
    referenceAssetIds: [],
    generationApproach: "reference-to-video",
    requestedDurationSeconds: 5,
    status: "planned",
    acceptedTakeId: null,
    takes: [],
  };
}

export function ProductionPlanner({
  record,
  workload,
  versions,
  loading,
  busy,
  error,
  notice,
  onCreateManual,
  onGenerate,
  onSave,
  onApprove,
}: Props) {
  const [draft, setDraft] = useState<StoryProductionPlan | null>(
    record?.plan || null,
  );
  const [direction, setDirection] = useState("");
  const [targetDurationSeconds, setTargetDurationSeconds] =
    useState(60);

  useEffect(() => {
    setDraft(record?.plan || null);
    if (record?.plan.targetDurationSeconds) {
      setTargetDurationSeconds(record.plan.targetDurationSeconds);
    }
  }, [record]);

  function updateScene(
    sceneId: string,
    patch: Partial<StoryProductionScene>,
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            status: "draft",
            acts: current.acts.map((act) => ({
              ...act,
              scenes: act.scenes.map((scene) =>
                scene.id === sceneId ? { ...scene, ...patch } : scene,
              ),
            })),
          }
        : current,
    );
  }

  function updateShot(
    sceneId: string,
    shotId: string,
    patch: Partial<StoryProductionShot>,
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            status: "draft",
            acts: current.acts.map((act) => ({
              ...act,
              scenes: act.scenes.map((scene) =>
                scene.id === sceneId
                  ? {
                      ...scene,
                      shots: scene.shots.map((shot) =>
                        shot.id === shotId ? { ...shot, ...patch } : shot,
                      ),
                    }
                  : scene,
              ),
            })),
          }
        : current,
    );
  }

  function addScene() {
    setDraft((current) => {
      if (!current) return current;
      const sceneCount = current.acts.reduce(
        (sum, act) => sum + act.scenes.length,
        0,
      );
      const acts = current.acts.length
        ? current.acts.map((act, index) =>
            index === 0
              ? {
                  ...act,
                  scenes: [...act.scenes, blankScene(sceneCount + 1)],
                }
              : act,
          )
        : [
            {
              id: localId("act"),
              order: 1,
              title: "Act 1",
              summary: "",
              scenes: [blankScene(1)],
            },
          ];
      return { ...current, status: "draft", acts };
    });
  }

  function addShot(scene: StoryProductionScene) {
    updateScene(scene.id, {
      shots: [...scene.shots, blankShot(scene.shots.length + 1)],
    });
  }

  if (loading) {
    return (
      <div className="border-y border-white/10 py-8 text-sm text-white/45">
        Loading production plan...
      </div>
    );
  }

  if (!draft || !record) {
    return (
      <section className="border-y border-white/10 bg-black/20 py-5">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/55">
          Production Planner
        </p>
        <h3 className="mt-2 text-xl font-black text-white">
          Build scenes and shots from this Story
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
          Create a draft plan for review. Planning does not generate
          images, video, audio, or start GPU work.
        </p>

        <label className="mt-5 block max-w-4xl">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Direction for Story Director
          </span>
          <textarea
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
            rows={4}
            placeholder="For example: Plan the opening three scenes as a cinematic fantasy sequence."
            className="w-full resize-y rounded-lg border border-white/12 bg-black/40 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-cyan-200/40"
          />
        </label>

        <label className="mt-4 block max-w-xs">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Target length in seconds
          </span>
          <input
            type="number"
            min={5}
            max={43200}
            step={5}
            value={targetDurationSeconds}
            onChange={(event) =>
              setTargetDurationSeconds(Number(event.target.value) || 60)
            }
            className="min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white outline-none focus:border-cyan-200/40"
          />
        </label>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onGenerate(direction, targetDurationSeconds)}
            className="min-h-11 rounded-lg bg-cyan-300 px-4 py-2 text-sm font-black text-black disabled:opacity-40"
          >
            {busy ? "Planning..." : "Create AI Plan"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onCreateManual(targetDurationSeconds)}
            className="min-h-11 rounded-lg border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-black text-white/72 disabled:opacity-40"
          >
            Start Manually
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="min-w-0 border-y border-white/10 bg-black/20 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/55">
              Production Planner
            </p>
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase text-white/50">
              Version {record.version} · {record.status}
            </span>
          </div>
          <h3 className="mt-2 text-xl font-black text-white">
            Scenes, shots, and takes
          </h3>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave(draft)}
            className="min-h-11 rounded-lg border border-white/12 bg-white/[0.05] px-4 py-2 text-sm font-black text-white disabled:opacity-40"
          >
            Save Draft
          </button>
          <button
            type="button"
            disabled={busy || record.status === "approved"}
            onClick={onApprove}
            className="min-h-11 rounded-lg bg-emerald-300 px-4 py-2 text-sm font-black text-black disabled:opacity-40"
          >
            {record.status === "approved" ? "Plan Approved" : "Approve Plan"}
          </button>
        </div>
      </div>

      {workload ? (
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Acts", workload.actCount],
            ["Scenes", workload.sceneCount],
            ["Shots", workload.shotCount],
            ["Video", `${workload.plannedVideoSeconds}s`],
            ["Jobs", workload.pendingVideoJobs],
            ["Accepted", workload.acceptedTakes],
          ].map(([label, value]) => (
            <div key={label} className="min-h-20 bg-[#0b0d14] p-3">
              <div className="text-xl font-black text-white">{value}</div>
              <div className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/40">
                {label}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4 rounded-lg border border-cyan-200/20 bg-cyan-300/[0.07] px-3 py-2 text-sm text-cyan-50/80">
          {notice}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label>
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Production title
          </span>
          <input
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value, status: "draft" })
            }
            className="min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white outline-none focus:border-cyan-200/40"
          />
        </label>
        <label>
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Target length in seconds
          </span>
          <input
            type="number"
            min={5}
            max={43200}
            step={5}
            value={draft.targetDurationSeconds}
            onChange={(event) =>
              setDraft({
                ...draft,
                targetDurationSeconds: Number(event.target.value) || 60,
                status: "draft",
              })
            }
            className="min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white outline-none focus:border-cyan-200/40"
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/45">
          Production summary
        </span>
        <textarea
          value={draft.summary}
          onChange={(event) =>
            setDraft({ ...draft, summary: event.target.value, status: "draft" })
          }
          rows={3}
          className="w-full resize-y rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-sm leading-6 text-white outline-none focus:border-cyan-200/40"
        />
      </label>

      <div className="mt-6 space-y-6">
        {draft.acts.map((act) => (
          <div key={act.id} className="border-t border-white/12 pt-5">
            <div className="text-sm font-black text-white">{act.title}</div>
            <div className="mt-4 space-y-5">
              {act.scenes.map((scene) => (
                <div key={scene.id} className="border-l-2 border-cyan-200/25 pl-4">
                  <div className="grid gap-3 sm:grid-cols-[100px_minmax(0,1fr)_130px]">
                    <input
                      aria-label="Scene number"
                      value={scene.sceneNumber}
                      onChange={(event) =>
                        updateScene(scene.id, { sceneNumber: event.target.value })
                      }
                      className="min-h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white"
                    />
                    <input
                      aria-label="Scene title"
                      value={scene.title}
                      onChange={(event) =>
                        updateScene(scene.id, { title: event.target.value })
                      }
                      className="min-h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm font-bold text-white"
                    />
                    <input
                      aria-label="Scene duration seconds"
                      type="number"
                      min={5}
                      step={5}
                      value={scene.durationTargetSeconds}
                      onChange={(event) =>
                        updateScene(scene.id, {
                          durationTargetSeconds: Number(event.target.value) || 30,
                        })
                      }
                      className="min-h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white"
                    />
                  </div>

                  <textarea
                    aria-label="Scene purpose and action"
                    value={scene.action}
                    onChange={(event) =>
                      updateScene(scene.id, { action: event.target.value })
                    }
                    rows={3}
                    placeholder="What happens in this scene?"
                    className="mt-3 w-full resize-y rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm leading-6 text-white placeholder:text-white/28"
                  />

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs font-black uppercase tracking-[0.12em] text-white/42">
                      {scene.shots.length} shots
                    </div>
                    <button
                      type="button"
                      onClick={() => addShot(scene)}
                      className="min-h-10 rounded-lg border border-white/12 px-3 py-2 text-xs font-black text-white/70 hover:bg-white/[0.06]"
                    >
                      Add Shot
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {scene.shots.map((shot) => (
                      <details
                        key={shot.id}
                        className="rounded-lg border border-white/10 bg-white/[0.025] p-3"
                      >
                        <summary className="cursor-pointer text-sm font-black text-white/80">
                          Shot {shot.shotNumber}: {shot.description || "Untitled shot"}
                        </summary>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <label className="sm:col-span-2">
                            <span className="mb-1 block text-[10px] font-black uppercase text-white/40">
                              Shot description
                            </span>
                            <textarea
                              value={shot.description}
                              onChange={(event) =>
                                updateShot(scene.id, shot.id, {
                                  description: event.target.value,
                                })
                              }
                              rows={2}
                              className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                            />
                          </label>
                          <label>
                            <span className="mb-1 block text-[10px] font-black uppercase text-white/40">
                              Framing
                            </span>
                            <input
                              value={shot.cameraFraming}
                              onChange={(event) =>
                                updateShot(scene.id, shot.id, {
                                  cameraFraming: event.target.value,
                                })
                              }
                              className="min-h-10 w-full rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white"
                            />
                          </label>
                          <label>
                            <span className="mb-1 block text-[10px] font-black uppercase text-white/40">
                              Camera movement
                            </span>
                            <input
                              value={shot.cameraMovement}
                              onChange={(event) =>
                                updateShot(scene.id, shot.id, {
                                  cameraMovement: event.target.value,
                                })
                              }
                              className="min-h-10 w-full rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white"
                            />
                          </label>
                          <label>
                            <span className="mb-1 block text-[10px] font-black uppercase text-white/40">
                              Generation path
                            </span>
                            <select
                              value={shot.generationApproach}
                              onChange={(event) =>
                                updateShot(scene.id, shot.id, {
                                  generationApproach: event.target.value as StoryProductionShot["generationApproach"],
                                })
                              }
                              className="min-h-10 w-full rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white"
                            >
                              <option value="reference-to-video">Reference to video</option>
                              <option value="image-to-video">Image to video</option>
                              <option value="text-to-video">Text to video</option>
                              <option value="video-edit">Video edit</option>
                            </select>
                          </label>
                          <label>
                            <span className="mb-1 block text-[10px] font-black uppercase text-white/40">
                              Clip length
                            </span>
                            <select
                              value={shot.requestedDurationSeconds}
                              onChange={(event) =>
                                updateShot(scene.id, shot.id, {
                                  requestedDurationSeconds:
                                    Number(event.target.value) === 10 ? 10 : 5,
                                })
                              }
                              className="min-h-10 w-full rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white"
                            >
                              <option value={5}>5 seconds</option>
                              <option value={10}>10 seconds</option>
                            </select>
                          </label>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addScene}
        className="mt-6 min-h-11 rounded-lg border border-cyan-200/25 bg-cyan-300/[0.07] px-4 py-2 text-sm font-black text-cyan-50"
      >
        Add Scene
      </button>

      {versions.length ? (
        <details className="mt-6 border-t border-white/10 pt-4">
          <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em] text-white/45">
            Version history ({versions.length})
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {versions.map((version) => (
              <span
                key={version.id}
                className="rounded-md border border-white/10 bg-white/[0.035] px-2 py-1 text-xs text-white/55"
              >
                v{version.version} · {version.status} · {version.sourceRole}
              </span>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
