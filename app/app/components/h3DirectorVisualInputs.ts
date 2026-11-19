export type H3DirectorStill = { label: string; dataUrl: string };
export type H3DirectorVisualSource = {
  label: string;
  url: string;
  videoTime?: number;
};

function loaded(
  element: HTMLElement,
  event: string,
  start: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    function finish(error?: Error) {
      window.clearTimeout(timeout);
      element.removeEventListener(event, success);
      element.removeEventListener("error", failure);
      if (error) reject(error);
      else resolve();
    }

    const success = () => finish();
    const failure = () => finish(new Error("A selected reference could not be decoded."));
    const timeout = window.setTimeout(failure, 8000);
    element.addEventListener(event, success, { once: true });
    element.addEventListener("error", failure, { once: true });
    start();
  });
}

function still(
  source: CanvasImageSource,
  width: number,
  height: number,
  label: string,
): H3DirectorStill {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 512 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not prepare the reference.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { label, dataUrl: canvas.toDataURL("image/jpeg", 0.78) };
}

async function readStill(source: H3DirectorVisualSource): Promise<H3DirectorStill> {
  if (source.videoTime === undefined) {
    const image = new Image();
    await loaded(image, "load", () => { image.src = source.url; });
    return still(image, image.naturalWidth, image.naturalHeight, source.label);
  }

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await loaded(video, "loadeddata", () => { video.src = source.url; });
    const time = Math.max(0, Math.min(source.videoTime, video.duration - 0.05));
    if (Math.abs(video.currentTime - time) > 0.01) {
      await loaded(video, "seeked", () => { video.currentTime = time; });
    }
    return still(video, video.videoWidth, video.videoHeight, source.label);
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

export async function prepareH3DirectorStills(sources: H3DirectorVisualSource[]) {
  const results = await Promise.allSettled(sources.slice(0, 3).map(readStill));
  return results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
}
