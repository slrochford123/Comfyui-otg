"use client";

import React from "react";

import {
  characterImageUrl,
  getReadyHqVoiceArtifact,
  isVoiceCharacterJobActive,
  listVoiceCharacterJobs,
  listVoiceCharacters,
  queueVoiceCharacterAction,
  voiceCharacterJobProgress,
  voiceCharacterJobStage,
  voiceSampleUrl,
  type VoiceCharacterPipelineJob,
  type VoiceCharacterRecord,
} from "@/lib/characters/voiceCharactersClient";

const CHARACTER_LIBRARY_ENDPOINT =
  "/api/characters";

const TRAINING_STAGES = [
  "Preparing Voice Reference",
  "Generating Training Speech",
  "Validating Dataset",
  "Extracting Voice Features",
  "Training HQ Voice Model",
  "Testing Voice Model",
  "Finalizing",
] as const;

type UnknownRecord = Record<string, unknown>;

type TrainingView = {
  stageIndex: number;
  progress: number;
  status: "idle" | "running" | "failed" | "completed";
  message: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): UnknownRecord {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value as UnknownRecord;
}

function displayDate(
  value: unknown,
) {
  const source = text(value);

  if (!source) return "";

  const parsed =
    new Date(source);

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return "";
  }

  return parsed.toLocaleString();
}

function jobStatus(
  job: VoiceCharacterPipelineJob | undefined,
) {
  return text(job?.status).toLowerCase();
}

function latestJob(
  jobs: VoiceCharacterPipelineJob[],
  action: string,
) {
  return jobs.find(
    (job) => job.action === action,
  );
}

function failedStageIndex(
  job: VoiceCharacterPipelineJob,
) {
  const result = record(job.result);
  const raw = text(
    result.failedStage ||
      result.currentStage ||
      voiceCharacterJobStage(job),
  ).toLowerCase();

  if (raw.includes("final")) return 6;
  if (raw.includes("testing")) return 5;
  if (raw === "train" || raw.includes("training")) return 4;
  if (raw.includes("extract")) return 3;
  if (
    raw.includes("validat") ||
    raw.includes("qc") ||
    raw.includes("quality")
  ) {
    return 2;
  }
  if (raw.includes("generat")) return 1;
  return 0;
}

function stageProgress(
  stageIndex: number,
  rawProgress: number,
  completed = false,
) {
  if (completed) return 100;

  const ranges = [
    [2, 12],
    [15, 38],
    [40, 48],
    [50, 58],
    [60, 88],
    [90, 96],
    [97, 99],
  ] as const;

  const [start, end] =
    ranges[
      Math.max(
        0,
        Math.min(6, stageIndex),
      )
    ];

  const normalized =
    Math.max(
      0,
      Math.min(100, rawProgress),
    ) / 100;

  return Math.round(
    start +
      (end - start) * normalized,
  );
}

function resolveTrainingView(
  character: VoiceCharacterRecord,
  jobs: VoiceCharacterPipelineJob[],
): TrainingView {
  const artifact =
    getReadyHqVoiceArtifact(character);

  const activeTraining =
    jobs.find(
      (job) =>
        job.action === "start_applio_training" &&
        isVoiceCharacterJobActive(job),
    );

  if (activeTraining) {
    const rawStage =
      voiceCharacterJobStage(
        activeTraining,
      ).toLowerCase();

    let stageIndex = 0;

    if (
      rawStage === "testing_voice_model" ||
      rawStage.includes("testing")
    ) {
      stageIndex = 5;
    } else if (
      rawStage === "finalizing" ||
      rawStage === "artifact_copy" ||
      rawStage.includes("final")
    ) {
      stageIndex = 6;
    } else if (
      rawStage === "train" ||
      rawStage.includes("training")
    ) {
      stageIndex = 4;
    } else if (
      rawStage === "extract" ||
      rawStage.includes("extract")
    ) {
      stageIndex = 3;
    } else {
      stageIndex = 0;
    }

    return {
      stageIndex,
      progress: stageProgress(
        stageIndex,
        voiceCharacterJobProgress(
          activeTraining,
        ),
      ),
      status: "running",
      message:
        text(activeTraining.message) ||
        `Running ${TRAINING_STAGES[stageIndex]}.`,
    };
  }

  const activeDataset =
    jobs.find(
      (job) =>
        job.action === "generate_training_dataset" &&
        isVoiceCharacterJobActive(job),
    );

  if (activeDataset) {
    const rawStage =
      voiceCharacterJobStage(
        activeDataset,
      ).toLowerCase();

    const rawProgress =
      voiceCharacterJobProgress(
        activeDataset,
      );

    let stageIndex = 1;

    if (
      rawStage.includes("validat") ||
      rawStage.includes("qc") ||
      rawStage.includes("quality") ||
      rawStage.includes("upload") ||
      rawStage.includes("complete") ||
      rawStage.includes("ready") ||
      rawProgress >= 85
    ) {
      stageIndex = 2;
    } else if (
      rawStage.includes("prepare") ||
      rawStage.includes("reference") ||
      rawStage.includes("claimed") ||
      rawStage === "queued" ||
      rawProgress <= 10
    ) {
      stageIndex = 0;
    }

    return {
      stageIndex,
      progress: stageProgress(
        stageIndex,
        rawProgress,
      ),
      status: "running",
      message:
        text(activeDataset.message) ||
        `Running ${TRAINING_STAGES[stageIndex]}.`,
    };
  }

  const failedTraining =
    jobs.find(
      (job) =>
        job.action === "start_applio_training" &&
        jobStatus(job) === "failed",
    );

  if (failedTraining) {
    const stageIndex =
      failedStageIndex(
        failedTraining,
      );

    return {
      stageIndex,
      progress: stageProgress(
        stageIndex,
        voiceCharacterJobProgress(
          failedTraining,
        ),
      ),
      status: "failed",
      message:
        text(failedTraining.error) ||
        text(failedTraining.message) ||
        "HQ Voice Model training failed.",
    };
  }

  const failedDataset =
    jobs.find(
      (job) =>
        job.action === "generate_training_dataset" &&
        jobStatus(job) === "failed",
    );

  if (failedDataset) {
    const stageIndex =
      failedStageIndex(
        failedDataset,
      );

    return {
      stageIndex,
      progress: stageProgress(
        stageIndex,
        voiceCharacterJobProgress(
          failedDataset,
        ),
      ),
      status: "failed",
      message:
        text(failedDataset.error) ||
        text(failedDataset.message) ||
        "Training dataset generation failed.",
    };
  }

  if (artifact) {
    return {
      stageIndex: 6,
      progress: 100,
      status: "completed",
      message:
        "HQ Voice Model is trained and ready.",
    };
  }

  const completedDataset =
    latestJob(
      jobs,
      "generate_training_dataset",
    );

  if (
    completedDataset &&
    jobStatus(completedDataset) === "completed"
  ) {
    return {
      stageIndex: 2,
      progress: 48,
      status: "running",
      message:
        "Validated training speech is ready; HQ Voice Model training is starting.",
    };
  }

  return {
    stageIndex: 0,
    progress: 0,
    status: "idle",
    message:
      "Ready to train from the permanent original Voice Sample.",
  };
}

function HqStatus({
  character,
  isTraining,
}: {
  character: VoiceCharacterRecord;
  isTraining: boolean;
}) {
  const artifact =
    getReadyHqVoiceArtifact(
      character,
    );

  if (artifact) {
    return (
      <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-200/70">
          HQ Voice Model
        </div>

        <div className="mt-1 text-sm font-black text-emerald-50">
          Ready
        </div>

        {artifact.trainedAt ? (
          <div className="mt-1 text-xs text-emerald-100/45">
            Verified{" "}
            {displayDate(
              artifact.trainedAt,
            )}
          </div>
        ) : null}
      </div>
    );
  }

  const profileStatus =
    text(
      character
        .characterVoiceProfile
        ?.status,
    ).toLowerCase();

  const profileTraining =
    profileStatus === "queued" ||
    profileStatus === "running";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2">
      <div className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
        HQ Voice Model
      </div>

      <div className="mt-1 text-sm font-black text-white/75">
        {isTraining || profileTraining
          ? "Training"
          : "Not trained"}
      </div>
    </div>
  );
}

function TrainingProgress({
  character,
  jobs,
}: {
  character: VoiceCharacterRecord;
  jobs: VoiceCharacterPipelineJob[];
}) {
  const view =
    resolveTrainingView(
      character,
      jobs,
    );

  return (
    <div
      className="rounded-xl border border-violet-300/15 bg-violet-400/[0.05] p-3"
      data-otg="voice-training-progress"
      data-stage={
        TRAINING_STAGES[
          view.stageIndex
        ]
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-200/55">
            Training progress
          </div>

          <div className="mt-1 text-sm font-black text-white/80">
            {view.status === "completed"
              ? "Complete"
              : TRAINING_STAGES[
                  view.stageIndex
                ]}
          </div>
        </div>

        <div className="text-xs font-black text-violet-100/70">
          {view.progress}%
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/45">
        <div
          className="h-full rounded-full bg-violet-300/70 transition-[width] duration-300"
          style={{
            width: `${view.progress}%`,
          }}
        />
      </div>

      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {TRAINING_STAGES.map(
          (stage, index) => {
            const complete =
              view.status === "completed" ||
              index < view.stageIndex;

            const current =
              view.status !== "completed" &&
              index === view.stageIndex;

            return (
              <div
                key={stage}
                className={
                  `rounded-lg border px-2.5 py-2 text-[11px] font-bold ${
                    complete
                      ? "border-emerald-300/20 bg-emerald-400/[0.06] text-emerald-100/70"
                      : current
                        ? view.status === "failed"
                          ? "border-red-300/25 bg-red-400/[0.08] text-red-100/80"
                          : "border-violet-300/25 bg-violet-400/[0.08] text-violet-100/80"
                        : "border-white/8 bg-black/20 text-white/30"
                  }`
                }
              >
                {complete
                  ? "✓ "
                  : current
                    ? "• "
                    : ""}
                {stage}
              </div>
            );
          },
        )}
      </div>

      <div
        className={
          `mt-3 text-xs leading-5 ${
            view.status === "failed"
              ? "text-red-100/70"
              : "text-white/40"
          }`
        }
      >
        {view.message}
      </div>
    </div>
  );
}

export default function VoiceCharactersPanel({
  onBack,
}: {
  onBack: () => void;
}) {
  const [
    characters,
    setCharacters,
  ] = React.useState<
    VoiceCharacterRecord[]
  >([]);

  const [search, setSearch] =
    React.useState("");

  const [busy, setBusy] =
    React.useState(true);

  const [error, setError] =
    React.useState("");

  const [
    jobsByCharacter,
    setJobsByCharacter,
  ] = React.useState<
    Record<
      string,
      VoiceCharacterPipelineJob[]
    >
  >({});

  const [
    actionBusy,
    setActionBusy,
  ] = React.useState<
    Record<string, boolean>
  >({});

  const [
    actionErrors,
    setActionErrors,
  ] = React.useState<
    Record<string, string>
  >({});

  const autoChainInFlight =
    React.useRef(
      new Set<string>(),
    );

  const completedTrainingSeen =
    React.useRef(
      new Set<string>(),
    );

  const refresh =
    React.useCallback(
      async (
        showBusy = true,
      ) => {
        if (showBusy) {
          setBusy(true);
        }

        setError("");

        try {
          const rows =
            await listVoiceCharacters(
              CHARACTER_LIBRARY_ENDPOINT,
            );

          setCharacters(rows);
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load Voice Characters.",
          );
        } finally {
          if (showBusy) {
            setBusy(false);
          }
        }
      },
      [],
    );

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshJobs =
    React.useCallback(
      async () => {
        if (!characters.length) {
          setJobsByCharacter({});
          return;
        }

        const rows =
          await Promise.all(
            characters.map(
              async (character) => {
                try {
                  return [
                    character.id,
                    await listVoiceCharacterJobs(
                      character.id,
                    ),
                  ] as const;
                } catch {
                  return [
                    character.id,
                    null,
                  ] as const;
                }
              },
            ),
          );

        setJobsByCharacter(
          (current) => {
            const next = {
              ...current,
            };

            for (
              const [
                characterId,
                jobs,
              ] of rows
            ) {
              if (jobs) {
                next[characterId] =
                  jobs;
              }
            }

            return next;
          },
        );
      },
      [characters],
    );

  React.useEffect(() => {
    if (!characters.length) {
      return;
    }

    let canceled = false;

    const tick = async () => {
      if (canceled) return;
      await refreshJobs();
    };

    void tick();

    const timer =
      window.setInterval(
        () => {
          void tick();
        },
        2500,
      );

    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [characters.length, refreshJobs]);

  React.useEffect(() => {
    for (const character of characters) {
      const jobs =
        jobsByCharacter[
          character.id
        ] || [];

      const completedTraining =
        jobs.find(
          (job) =>
            job.action === "start_applio_training" &&
            jobStatus(job) === "completed",
        );

      if (
        completedTraining &&
        !completedTrainingSeen.current.has(
          completedTraining.jobId,
        )
      ) {
        completedTrainingSeen.current.add(
          completedTraining.jobId,
        );

        void refresh(false);
      }
    }
  }, [
    characters,
    jobsByCharacter,
    refresh,
  ]);

  React.useEffect(() => {
    for (const character of characters) {
      const jobs =
        jobsByCharacter[
          character.id
        ] || [];

      const completedDataset =
        jobs.find(
          (job) =>
            job.action === "generate_training_dataset" &&
            jobStatus(job) === "completed" &&
            record(job.input)
              .voiceCharactersAutoTrain === true,
        );

      if (!completedDataset) {
        continue;
      }

      const alreadyStarted =
        jobs.some(
          (job) =>
            job.action === "start_applio_training" &&
            text(
              record(job.input)
                .sourceDatasetJobId,
            ) === completedDataset.jobId,
        );

      if (
        alreadyStarted ||
        autoChainInFlight.current.has(
          completedDataset.jobId,
        )
      ) {
        continue;
      }

      const datasetResult =
        record(
          completedDataset.result,
        );

      const manifestPath =
        text(
          datasetResult.manifestPath ||
            datasetResult.datasetManifestPath,
        );

      const manifestUrl =
        text(
          datasetResult.manifestUrl ||
            datasetResult.datasetManifestUrl,
        );

      if (!manifestPath) {
        setActionErrors(
          (current) => ({
            ...current,
            [character.id]:
              "Validated dataset completed without a manifestPath; HQ training was not started.",
          }),
        );
        continue;
      }

      autoChainInFlight.current.add(
        completedDataset.jobId,
      );

      void (async () => {
        try {
          const sampleUrl =
            voiceSampleUrl(
              character,
            );

          await queueVoiceCharacterAction(
            character,
            "start_applio_training",
            {
              sourceDatasetJobId:
                completedDataset.jobId,
              manifestPath,
              manifestUrl,
              datasetManifestPath:
                manifestPath,
              datasetManifestUrl:
                manifestUrl,
              approvedSamplePath:
                character.referenceAudioPath,
              approvedSampleUrl:
                sampleUrl,
              referenceAudioPath:
                character.referenceAudioPath,
              originalReferencePath:
                character.referenceAudioPath,
              originalReferenceUrl:
                sampleUrl,
              trainingQualityPreset:
                "normal",
              voiceCharactersAutoTrain:
                true,
              requestedBy:
                "voice_characters",
            },
          );

          setActionErrors(
            (current) => ({
              ...current,
              [character.id]: "",
            }),
          );

          await refreshJobs();
        } catch (cause) {
          setActionErrors(
            (current) => ({
              ...current,
              [character.id]:
                cause instanceof Error
                  ? cause.message
                  : "Could not start HQ Voice Model training.",
            }),
          );
        } finally {
          autoChainInFlight.current.delete(
            completedDataset.jobId,
          );
        }
      })();
    }
  }, [
    characters,
    jobsByCharacter,
    refreshJobs,
  ]);

  const queueTraining =
    React.useCallback(
      async (
        character: VoiceCharacterRecord,
      ) => {
        setActionBusy(
          (current) => ({
            ...current,
            [character.id]: true,
          }),
        );

        setActionErrors(
          (current) => ({
            ...current,
            [character.id]: "",
          }),
        );

        try {
          const sampleUrl =
            voiceSampleUrl(
              character,
            );

          await queueVoiceCharacterAction(
            character,
            "generate_training_dataset",
            {
              approvedSamplePath:
                character.referenceAudioPath,
              approvedSampleUrl:
                sampleUrl,
              referenceAudioPath:
                character.referenceAudioPath,
              originalReferencePath:
                character.referenceAudioPath,
              originalReferenceUrl:
                sampleUrl,
              voiceCharactersAutoTrain:
                true,
              requestedBy:
                "voice_characters",
            },
          );

          await refreshJobs();
        } catch (cause) {
          setActionErrors(
            (current) => ({
              ...current,
              [character.id]:
                cause instanceof Error
                  ? cause.message
                  : "Could not start HQ Voice Model training.",
            }),
          );
        } finally {
          setActionBusy(
            (current) => ({
              ...current,
              [character.id]: false,
            }),
          );
        }
      },
      [refreshJobs],
    );

  const [testVoiceTexts, setTestVoiceTexts] =
    React.useState<Record<string, string>>({});
  const testVoiceTextsRef =
    React.useRef<Record<string, string>>({});

  const queueTest =
    React.useCallback(
      async (
        character: VoiceCharacterRecord,
      ) => {
        const artifact =
          getReadyHqVoiceArtifact(
            character,
          );

        const speechText = String(
          testVoiceTextsRef.current[
            character.id
          ] || "",
        ).trim();

        if (!artifact || !speechText) return;

        setActionBusy(
          (current) => ({
            ...current,
            [character.id]: true,
          }),
        );

        setActionErrors(
          (current) => ({
            ...current,
            [character.id]: "",
          }),
        );

        try {
          const sampleUrl =
            voiceSampleUrl(
              character,
            );

          await queueVoiceCharacterAction(
            character,
            "test_trained_voice",
            {
              text:
                speechText,
              trainedModelPath:
                artifact.modelPath,
              trainedIndexPath:
                artifact.indexPath,
              trainedArtifactMock: false,
              trainingMock: false,
              artifactMock: false,
              inputAudioPath:
                character.referenceAudioPath,
              inputAudioUrl:
                sampleUrl,
              requestedBy:
                "voice_characters",
            },
          );

          await refreshJobs();
        } catch (cause) {
          setActionErrors(
            (current) => ({
              ...current,
              [character.id]:
                cause instanceof Error
                  ? cause.message
                  : "Could not start the trained Voice test.",
            }),
          );
        } finally {
          setActionBusy(
            (current) => ({
              ...current,
              [character.id]: false,
            }),
          );
        }
      },
      [refreshJobs],
    );

  const visible =
    React.useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      if (!query) {
        return characters;
      }

      return characters.filter(
        (character) =>
          [
            character.name,
            character.voiceEngineUsed,
            character.voiceStatus,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query),
      );
    }, [
      characters,
      search,
    ]);

  return (
    <div
      className="space-y-5"
      data-otg="voice-characters"
    >
      <section className="rounded-[30px] border border-violet-300/20 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.25),transparent_42%),rgba(2,8,16,0.94)] p-5 sm:p-7">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm font-bold text-white/70 hover:bg-white/10"
        >
          ← Characters
        </button>

        <div className="text-xs font-black uppercase tracking-[0.22em] text-violet-200/65">
          Character Voice Training
        </div>

        <h2 className="mt-2 text-3xl font-black text-white">
          Voice Characters
        </h2>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
          Characters appear here only after
          they have an original saved Voice
          Sample. That Voice Sample remains
          the permanent source reference.
          The HQ Voice Model is a separate,
          optional trained model.
        </p>
      </section>

      <section className="rounded-[26px] border border-white/10 bg-black/25 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value,
              )
            }
            placeholder="Search Voice Characters"
            className="min-h-12 rounded-xl border border-white/10 bg-black/45 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-violet-300/40"
          />

          <button
            type="button"
            onClick={() =>
              void refresh()
            }
            disabled={busy}
            className="min-h-12 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-white/70 disabled:opacity-40"
          >
            {busy
              ? "Refreshing..."
              : "Refresh"}
          </button>
        </div>
      </section>

      <section className="rounded-[26px] border border-white/10 bg-black/25 p-4">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
          HQ training stages
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {TRAINING_STAGES.map(
            (stage, index) => (
              <div
                key={stage}
                className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-3"
              >
                <div className="text-[10px] font-black uppercase tracking-[0.15em] text-violet-200/45">
                  Stage{" "}
                  {index + 1}
                </div>

                <div className="mt-1 text-xs font-bold text-white/65">
                  {stage}
                </div>
              </div>
            ),
          )}
        </div>

        <p className="mt-3 text-xs leading-5 text-white/40">
          Each Voice Character now follows
          the durable TEST voice pipeline.
          Live job state is collapsed into
          these seven user-facing stages;
          low-level RVC controls remain hidden.
        </p>
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-300/20 bg-red-400/10 p-4 text-sm font-semibold text-red-100">
          {error}
        </div>
      ) : null}

      {!busy &&
      !error &&
      visible.length === 0 ? (
        <div className="rounded-[26px] border border-white/10 bg-black/25 p-6 text-sm leading-6 text-white/50">
          No saved characters with a Voice
          Sample are available. Create or
          open a character and save its Voice
          Sample first.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {visible.map(
          (character) => {
            const imageUrl =
              characterImageUrl(
                character,
              );

            const sampleUrl =
              voiceSampleUrl(
                character,
              );

            const hqArtifact =
              getReadyHqVoiceArtifact(
                character,
              );

            const jobs =
              jobsByCharacter[
                character.id
              ] || [];

            const activeTrainingFlow =
              jobs.some(
                (job) =>
                  (
                    job.action === "generate_training_dataset" ||
                    job.action === "start_applio_training"
                  ) &&
                  isVoiceCharacterJobActive(job),
              );

            const activeTest =
              jobs.some(
                (job) =>
                  job.action === "test_trained_voice" &&
                  isVoiceCharacterJobActive(job),
              );

            const latestTest =
              latestJob(
                jobs,
                "test_trained_voice",
              );

            const latestTestResult =
              record(
                latestTest?.result,
              );

            const testOutputUrl =
              text(
                latestTestResult.outputAudioUrl,
              );

            const isActionBusy =
              Boolean(
                actionBusy[
                  character.id
                ],
              );

            return (
              <article
                key={character.id}
                className="overflow-hidden rounded-[26px] border border-white/10 bg-black/30"
                data-character-id={
                  character.id
                }
              >
                <div className="grid gap-0 sm:grid-cols-[150px_minmax(0,1fr)]">
                  <div className="flex min-h-[180px] items-center justify-center bg-black/35 p-3">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={
                          character.name
                        }
                        className="max-h-[220px] w-full object-contain"
                      />
                    ) : (
                      <div className="text-center text-xs font-bold text-white/30">
                        No character
                        preview
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 p-4">
                    <div>
                      <div className="text-xl font-black text-white">
                        {character.name}
                      </div>

                      <div className="mt-1 text-xs text-white/40">
                        {character.voiceEngineUsed ||
                          "Saved character voice"}
                      </div>
                    </div>

                    <div className="rounded-xl border border-sky-300/15 bg-sky-400/[0.06] p-3">
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-200/65">
                        Voice Sample
                      </div>

                      <div className="mt-1 text-xs leading-5 text-white/45">
                        Original saved source
                        reference
                      </div>

                      {sampleUrl ? (
                        <audio
                          controls
                          preload="none"
                          src={sampleUrl}
                          className="mt-3 w-full"
                        />
                      ) : null}
                    </div>

                    <HqStatus
                      character={
                        character
                      }
                      isTraining={
                        activeTrainingFlow
                      }
                    />

                    <TrainingProgress
                      character={
                        character
                      }
                      jobs={jobs}
                    />

                    <label
                      className="block"
                      data-otg="voice-test-text-input"
                    >
                      <span className="text-xs font-black uppercase tracking-[0.16em] text-violet-200/65">
                        Test Voice Text
                      </span>

                      <textarea
                        value={testVoiceTexts[character.id] || ""}
                        onChange={(event) => {
                          const value =
                            event.target.value;

                          testVoiceTextsRef.current = {
                            ...testVoiceTextsRef.current,
                            [character.id]: value,
                          };

                          setTestVoiceTexts(
                            (current) => ({
                              ...current,
                              [character.id]: value,
                            }),
                          );

                          setActionErrors(
                            (current) => ({
                              ...current,
                              [character.id]: "",
                            }),
                          );
                        }}
                        rows={3}
                        maxLength={600}
                        placeholder="Type what you want this character to say..."
                        className="mt-2 w-full resize-y rounded-xl border border-violet-300/20 bg-black/40 p-4 text-sm leading-6 text-white outline-none placeholder:text-white/25 focus:border-violet-300/45"
                      />

                      <div className="mt-2 text-[11px] leading-5 text-white/35">
                        Type any sentence to test this trained HQ Voice. The original Voice Sample is not changed.
                      </div>
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void queueTraining(
                            character,
                          )
                        }
                        disabled={
                          isActionBusy ||
                          activeTrainingFlow
                        }
                        title={
                          activeTrainingFlow
                            ? "HQ Voice Model training is already running."
                            : hqArtifact
                              ? "Generate a new validated dataset and retrain the HQ Voice Model."
                              : "Generate a validated dataset and train the HQ Voice Model."
                        }
                        className="min-h-10 rounded-xl border border-violet-300/20 bg-violet-400/10 px-4 text-xs font-black text-violet-100 disabled:opacity-40"
                      >
                        {activeTrainingFlow
                          ? "Training..."
                          : hqArtifact
                            ? "Retrain HQ Voice"
                            : "Train HQ Voice"}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void queueTest(
                            character,
                          )
                        }
                        disabled={
                          isActionBusy ||
                          activeTrainingFlow ||
                          activeTest ||
                          !hqArtifact ||
                          !String(
                            testVoiceTexts[
                              character.id
                            ] || "",
                          ).trim()
                        }
                        title={
                          !hqArtifact
                            ? "Train the HQ Voice Model first."
                            : activeTest
                              ? "Voice test is already running."
                              : "Run a real Applio conversion test with the trained model."
                        }
                        className="min-h-10 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-xs font-black text-white/60 disabled:opacity-40"
                      >
                        {activeTest
                          ? "Testing..."
                          : "Test Voice"}
                      </button>
                    </div>

                    {actionErrors[
                      character.id
                    ] ? (
                      <div className="rounded-xl border border-red-300/20 bg-red-400/[0.08] px-3 py-2 text-xs leading-5 text-red-100/75">
                        {
                          actionErrors[
                            character.id
                          ]
                        }
                      </div>
                    ) : null}

                    {testOutputUrl &&
                    jobStatus(latestTest) === "completed" ? (
                      <div className="rounded-xl border border-emerald-300/15 bg-emerald-400/[0.05] p-3">
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-200/60">
                          Latest Voice Test
                        </div>

                        <audio
                          controls
                          preload="none"
                          src={testOutputUrl}
                          className="mt-3 w-full"
                        />
                      </div>
                    ) : null}

                    <div className="text-[11px] leading-5 text-white/30">
                      The original Voice Sample
                      is not replaced when an
                      HQ Voice Model is trained,
                      retrained, or tested.
                    </div>
                  </div>
                </div>
              </article>
            );
          },
        )}
      </div>
    </div>
  );
}
