import { createRoot } from "react-dom/client";
import { Editor } from "./components/Editor";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastHost } from "./components/Toast";
import { startOtgBridge } from "./otg-bridge";
import "./tailwind.css";

void startOtgBridge()
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <ErrorBoundary>
        <ToastHost />
        <Editor />
      </ErrorBoundary>,
    );
  })
  .catch((error) => {
    parent.postMessage(
      {
        channel: "otg-sequence-v1",
        type: "load-error",
        message:
          error instanceof Error
            ? error.message
            : "The project could not open.",
      },
      location.origin,
    );
    document.getElementById("root")!.textContent =
      error instanceof Error
        ? error.message
        : "The editor could not open.";
  });
