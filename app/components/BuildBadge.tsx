"use client";

import React from "react";
import { OTG_BUILD } from "@/lib/build";

export default function BuildBadge() {
  if (!OTG_BUILD) return null;
  return (
    <div
      className="otg-buildBadge"
      aria-label={`Build ${OTG_BUILD}`}
      title={`Build ${OTG_BUILD}`}
    >
      Build {OTG_BUILD}
    </div>
  );
}
