import type * as React from "react";

type ModelViewerElementProps = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement> & {
    src?: string;
    alt?: string;
    poster?: string;
    loading?: "auto" | "lazy" | "eager" | string;
    reveal?: "auto" | "interaction" | "manual" | string;
    "camera-controls"?: boolean | string;
    "auto-rotate"?: boolean | string;
    "disable-zoom"?: boolean | string;
    "touch-action"?: string;
    exposure?: number | string;
    "shadow-intensity"?: number | string;
    "environment-image"?: string;
    "camera-orbit"?: string;
    "field-of-view"?: string;
    ar?: boolean | string;
    "ar-modes"?: string;
  },
  HTMLElement
>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerElementProps;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerElementProps;
    }
  }
}

export {};