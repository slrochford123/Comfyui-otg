"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type VideoSnapshotResult = {
  file: File;
  sourceVideoName: string;
  timestampSeconds: number;
  displayTimestamp: string;
  width: number;
  height: number;
  captureDurationMs: number;
  encodeDurationMs: number;
};

type VideoSnapshotPickerProps = {
  open: boolean;
  onClose: () => void;
  onSnapshot: (
    result: VideoSnapshotResult,
  ) => void | Promise<void>;
};

type VideoWithFrameCallback =
  HTMLVideoElement & {
    requestVideoFrameCallback?: (
      callback: (
        now: number,
        metadata: unknown,
      ) => void,
    ) => number;
    cancelVideoFrameCallback?: (
      handle: number,
    ) => void;
  };

const SNAPSHOT_FRAME_WAIT_TIMEOUT_MS = 250;
const SNAPSHOT_MAX_DIMENSION = 1536;
const SNAPSHOT_MIME_TYPE = "image/jpeg";
const SNAPSHOT_EXTENSION = ".jpg";
const SNAPSHOT_JPEG_QUALITY = 0.92;

function clamp(
  value: number,
  min: number,
  max: number,
) {
  return Math.min(
    Math.max(value, min),
    max,
  );
}

function formatTime(
  seconds: number,
) {
  const safe =
    Number.isFinite(seconds)
      ? Math.max(0, seconds)
      : 0;

  const minutes =
    Math.floor(safe / 60);

  const remaining =
    safe - minutes * 60;

  const wholeSeconds =
    Math.floor(remaining);

  const milliseconds =
    Math.floor(
      (remaining - wholeSeconds)
      * 1000,
    );

  return [
    String(minutes).padStart(2, "0"),
    String(wholeSeconds).padStart(2, "0"),
  ].join(":")
    + "."
    + String(milliseconds).padStart(3, "0");
}

function filenameTimestamp(
  seconds: number,
) {
  return formatTime(seconds)
    .replace(":", "-")
    .replace(".", "-");
}

function safeSourceName(
  name: string,
) {
  const withoutExtension =
    name.replace(
      /\.[^.]+$/,
      "",
    );

  return (
    withoutExtension
      .trim()
      .replace(
        /[^a-zA-Z0-9_-]+/g,
        "-",
      )
      .replace(
        /^[-_]+|[-_]+$/g,
        "",
      )
    || "video"
  );
}

async function waitForDisplayedFrame(
  video: HTMLVideoElement,
) {
  const enhanced =
    video as VideoWithFrameCallback;

  if (
    typeof enhanced.requestVideoFrameCallback
    === "function"
  ) {
    await new Promise<void>(
      (resolve) => {
        let settled = false;
        let handle = 0;

        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        };

        const timeout = window.setTimeout(
          () => {
            if (
              handle
              && typeof enhanced.cancelVideoFrameCallback
              === "function"
            ) {
              enhanced.cancelVideoFrameCallback(
                handle,
              );
            }

            finish();
          },
          SNAPSHOT_FRAME_WAIT_TIMEOUT_MS,
        );

        handle =
          enhanced.requestVideoFrameCallback!(
            () => finish(),
          );
      },
    );

    return;
  }

  await new Promise<void>(
    (resolve) => {
      requestAnimationFrame(
        () => resolve(),
      );
    },
  );
}

async function canvasPng(
  canvas: HTMLCanvasElement,
) {
  return await new Promise<Blob>(
    (resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }

          reject(
            new Error(
              "Could not create the snapshot image.",
            ),
          );
        },
        SNAPSHOT_MIME_TYPE,
        SNAPSHOT_JPEG_QUALITY,
      );
    },
  );
}

function downloadFile(
  file: File,
) {
  const url =
    URL.createObjectURL(
      file,
    );

  const anchor =
    document.createElement(
      "a",
    );

  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = "noopener";
  document.body.appendChild(
    anchor,
  );
  anchor.click();
  anchor.remove();

  window.setTimeout(
    () => {
      URL.revokeObjectURL(
        url,
      );
    },
    0,
  );
}

function snapshotDimensions(
  width: number,
  height: number,
) {
  if (
    width <= 0
    || height <= 0
  ) {
    return {
      width: 0,
      height: 0,
    };
  }

  const scale =
    Math.min(
      1,
      SNAPSHOT_MAX_DIMENSION
      / Math.max(
        width,
        height,
      ),
    );

  return {
    width: Math.max(
      1,
      Math.round(
        width * scale,
      ),
    ),
    height: Math.max(
      1,
      Math.round(
        height * scale,
      ),
    ),
  };
}

export default function VideoSnapshotPicker({
  open,
  onClose,
  onSnapshot,
}: VideoSnapshotPickerProps) {
  const videoRef =
    useRef<HTMLVideoElement | null>(
      null,
    );

  const [sourceFile, setSourceFile] =
    useState<File | null>(
      null,
    );

  const [sourceUrl, setSourceUrl] =
    useState("");

  const [duration, setDuration] =
    useState(0);

  const [currentTime, setCurrentTime] =
    useState(0);

  const [ready, setReady] =
    useState(false);

  const [seeking, setSeeking] =
    useState(false);

  const [capturing, setCapturing] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const frameStepSeconds =
    useMemo(
      () => 1 / 30,
      [],
    );

  useEffect(
    () => {
      if (!sourceFile) {
        setSourceUrl("");
        return;
      }

      const url =
        URL.createObjectURL(
          sourceFile,
        );

      setSourceUrl(url);

      return () => {
        URL.revokeObjectURL(
          url,
        );
      };
    },
    [sourceFile],
  );

  useEffect(
    () => {
      if (open) return;

      setSourceFile(null);
      setDuration(0);
      setCurrentTime(0);
      setReady(false);
      setSeeking(false);
      setCapturing(false);
      setMessage("");
    },
    [open],
  );

  useEffect(
    () => {
      if (!open) return;

      const onKeyDown =
        (event: KeyboardEvent) => {
          if (
            event.key === "Escape"
            && !capturing
          ) {
            onClose();
          }
        };

      window.addEventListener(
        "keydown",
        onKeyDown,
      );

      return () => {
        window.removeEventListener(
          "keydown",
          onKeyDown,
        );
      };
    },
    [
      open,
      capturing,
      onClose,
    ],
  );

  function chooseVideo(
    file: File,
  ) {
    if (
      !file.type.startsWith(
        "video/",
      )
    ) {
      setMessage(
        "Choose a video file.",
      );
      return;
    }

    setMessage("");
    setReady(false);
    setDuration(0);
    setCurrentTime(0);
    setSourceFile(file);
  }

  function seekTo(
    requested: number,
  ) {
    const video =
      videoRef.current;

    if (
      !video
      || !ready
      || !Number.isFinite(duration)
      || duration <= 0
    ) {
      return;
    }

    video.pause();

    const maximum =
      Math.max(
        0,
        duration - 0.001,
      );

    const next =
      clamp(
        requested,
        0,
        maximum,
      );

    setCurrentTime(next);

    if (
      Math.abs(
        video.currentTime - next,
      )
      < 0.0005
    ) {
      setSeeking(false);
      return;
    }

    setSeeking(true);
    video.currentTime = next;
  }

  async function captureFrame() {
    const video =
      videoRef.current;

    if (
      !video
      || !sourceFile
      || !ready
      || seeking
      || capturing
    ) {
      return null;
    }

    setMessage("");
    setCapturing(true);
    const captureStartedAt =
      performance.now();

    try {
      video.pause();

      await waitForDisplayedFrame(
        video,
      );

      const width =
        video.videoWidth;

      const height =
        video.videoHeight;

      if (
        !width
        || !height
      ) {
        throw new Error(
          "The selected video frame is not ready yet.",
        );
      }

      const canvas =
        document.createElement(
          "canvas",
        );

      const output =
        snapshotDimensions(
          width,
          height,
        );

      canvas.width =
        output.width;

      canvas.height =
        output.height;

      const context =
        canvas.getContext(
          "2d",
        );

      if (!context) {
        throw new Error(
          "The browser could not prepare the snapshot canvas.",
        );
      }

      context.drawImage(
        video,
        0,
        0,
        output.width,
        output.height,
      );

      const encodeStartedAt =
        performance.now();

      const blob =
        await canvasPng(
          canvas,
        );

      const encodedAt =
        performance.now();

      const timestampSeconds =
        video.currentTime;

      const displayTimestamp =
        formatTime(
          timestampSeconds,
        );

      const file =
        new File(
          [blob],
          [
            "snapshot_",
            safeSourceName(
              sourceFile.name,
            ),
            "_",
            filenameTimestamp(
              timestampSeconds,
            ),
            SNAPSHOT_EXTENSION,
          ].join(""),
          {
            type: SNAPSHOT_MIME_TYPE,
            lastModified: Date.now(),
          },
        );

      const captureDurationMs =
        Math.round(
          encodedAt - captureStartedAt,
        );

      const encodeDurationMs =
        Math.round(
          encodedAt - encodeStartedAt,
        );

      return {
        file,
        sourceVideoName:
          sourceFile.name,
        timestampSeconds,
        displayTimestamp,
        width: output.width,
        height: output.height,
        captureDurationMs,
        encodeDurationMs,
      };
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not capture the video frame.",
      );

      return null;
    } finally {
      setCapturing(false);
    }
  }

  async function useSnapshot() {
    const result =
      await captureFrame();

    if (!result) {
      return;
    }

    setMessage(
      `Captured frame in ${result.captureDurationMs} ms. Saving snapshot...`,
    );

    await onSnapshot(result);

    onClose();
  }

  async function downloadSnapshot() {
    const result =
      await captureFrame();

    if (!result) {
      return;
    }

    downloadFile(
      result.file,
    );

    setMessage(
      `Downloaded snapshot ${result.file.name}.`,
    );
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Snapshot from Video"
      data-otg="video-snapshot-picker"
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-sm font-black text-white">
              Snapshot from Video
            </div>

            <div className="mt-0.5 text-[11px] text-zinc-500">
              Scrub to a frame, then use it as the H3 image.
            </div>
          </div>

          <button
            type="button"
            disabled={capturing}
            onClick={onClose}
            aria-label="Close Snapshot"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-lg font-bold text-zinc-300 transition hover:border-white/25 hover:text-white disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 p-4">
          {!sourceFile ? (
            <label className="flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-black/30 px-5 text-center transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.03]">
              <span className="text-sm font-black text-zinc-200">
                Choose Video
              </span>

              <span className="mt-1 text-xs text-zinc-500">
                Select a local video and scrub to the frame you want.
              </span>

              <input
                hidden
                type="file"
                accept="video/*"
                onChange={(event) => {
                  const file =
                    event.currentTarget
                      .files?.[0];

                  if (file) {
                    chooseVideo(file);
                  }

                  event.currentTarget.value =
                    "";
                }}
              />
            </label>
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-white/10 bg-black">
                <video
                  ref={videoRef}
                  src={sourceUrl}
                  playsInline
                  preload="auto"
                  className="aspect-video max-h-[55vh] w-full bg-black object-contain"
                  onLoadedMetadata={(event) => {
                    const video =
                      event.currentTarget;

                    const nextDuration =
                      Number.isFinite(
                        video.duration,
                      )
                        ? video.duration
                        : 0;

                    video.pause();

                    setDuration(
                      nextDuration,
                    );

                    setCurrentTime(
                      video.currentTime || 0,
                    );

                    setReady(
                      Boolean(
                        video.videoWidth
                        && video.videoHeight
                        && nextDuration > 0,
                      ),
                    );
                  }}
                  onSeeked={(event) => {
                    setCurrentTime(
                      event.currentTarget
                        .currentTime,
                    );

                    setSeeking(false);
                  }}
                  onTimeUpdate={(event) => {
                    if (!seeking) {
                      setCurrentTime(
                        event.currentTarget
                          .currentTime,
                      );
                    }
                  }}
                />
              </div>

              <div>
                <input
                  type="range"
                  aria-label="Snapshot video position"
                  min={0}
                  max={
                    duration > 0
                      ? Math.max(
                          0,
                          duration - 0.001,
                        )
                      : 0
                  }
                  step={0.001}
                  value={
                    Math.min(
                      currentTime,
                      Math.max(
                        0,
                        duration - 0.001,
                      ),
                    )
                  }
                  disabled={!ready || capturing}
                  onChange={(event) => {
                    seekTo(
                      Number(
                        event.target.value,
                      ),
                    );
                  }}
                  className="w-full accent-cyan-300"
                />

                <div className="mt-1 flex items-center justify-between text-[11px] font-bold tabular-nums text-zinc-500">
                  <span>
                    {formatTime(
                      currentTime,
                    )}
                  </span>

                  <span>
                    {formatTime(
                      duration,
                    )}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={!ready || seeking || capturing}
                  onClick={() =>
                    seekTo(
                      currentTime
                      - frameStepSeconds,
                    )
                  }
                  className="min-h-9 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-zinc-300 transition hover:border-white/25 hover:text-white disabled:opacity-35"
                >
                  ◀ Frame
                </button>

                <button
                  type="button"
                  disabled={!ready || seeking || capturing}
                  onClick={() =>
                    seekTo(
                      currentTime
                      + frameStepSeconds,
                    )
                  }
                  className="min-h-9 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-zinc-300 transition hover:border-white/25 hover:text-white disabled:opacity-35"
                >
                  Frame ▶
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-4">
                <label className="min-h-9 cursor-pointer rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-300 transition hover:border-white/25 hover:text-white">
                  Replace Video

                  <input
                    hidden
                    type="file"
                    accept="video/*"
                    onChange={(event) => {
                      const file =
                        event.currentTarget
                          .files?.[0];

                      if (file) {
                        chooseVideo(file);
                      }

                      event.currentTarget.value =
                        "";
                    }}
                  />
                </label>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={capturing}
                    onClick={onClose}
                    className="min-h-9 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-zinc-300 transition hover:border-white/25 hover:text-white disabled:opacity-35"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={!ready || seeking || capturing}
                    onClick={() => void downloadSnapshot()}
                    aria-label="Download Snapshot"
                    className="min-h-9 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-zinc-300 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    Download Snapshot
                  </button>

                  <button
                    type="button"
                    disabled={!ready || seeking || capturing}
                    onClick={() => void useSnapshot()}
                    className="min-h-9 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-4 text-xs font-black text-cyan-100 transition hover:border-cyan-200/55 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {capturing
                      ? "Capturing..."
                      : "Use Snapshot"}
                  </button>
                </div>
              </div>
            </>
          )}

          {message ? (
            <div
              role="status"
              className="rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-xs font-bold text-amber-100"
            >
              {message}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
