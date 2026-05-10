"use client";

import { useMemo, useState } from "react";

type SkyrillsSectionId = "avatar" | "refvideo" | "extend";

type Section = {
  id: SkyrillsSectionId;
  label: string;
  title: string;
  subtitle: string;
  model: string;
  bullets: string[];
  defaults: Array<{ k: string; v: string }>;
};

const SECTIONS: Section[] = [
  {
    id: "avatar",
    label: "Avatar",
    title: "Talking Avatar",
    subtitle: "Image + audio → SkyReels V3 talking avatar workflow",
    model: "Wan21-SkyReelsV3-A2V_fp8_scaled_mixed.safetensors",
    bullets: [
      "Admin-only workflow tab. Final API wiring will happen after the tested Comfy workflow is promoted into the repo workflow folder.",
      "Uses WAN 2.1 VAE, UMT5 text encoder, wav2vec embeddings, and the SkyReels V3 A2V model.",
      "Best fit for portrait/talking head generation with uploaded audio or voice-tab output.",
    ],
    defaults: [
      { k: "Resolution", v: "832 × 480" },
      { k: "FPS", v: "25" },
      { k: "Sampler", v: "flowmatch_distill" },
      { k: "Steps", v: "4" },
      { k: "Window", v: "81 frames" },
    ],
  },
  {
    id: "refvideo",
    label: "Reference → Video",
    title: "Reference to Video",
    subtitle: "Multi-subject image references into a SkyReels V3 video",
    model: "Wan21_SkyReelsV3-R2V_fp8_scaled_mixed.safetensors",
    bullets: [
      "Supports multiple image references using the Phantom subject-to-video flow.",
      "Designed for 1–3 character references with explicit prompt labels for each subject.",
      "Ideal for the dedicated Skyrills page instead of the main Generate tab.",
    ],
    defaults: [
      { k: "Resolution", v: "832 × 832" },
      { k: "FPS", v: "24" },
      { k: "Sampler", v: "uni_pc / simple" },
      { k: "Steps", v: "8" },
      { k: "Frames", v: "121" },
    ],
  },
  {
    id: "extend",
    label: "Video Extension",
    title: "V2V Video Extension",
    subtitle: "Extend an existing video with looped V2V SkyReels generation",
    model: "Wan21-SkyReelsV3-V2V_fp8_scaled_mixed.safetensors",
    bullets: [
      "Uses uploaded source video plus overlap frames for continuity.",
      "Loop-based structure is already present in the tested Comfy workflow you uploaded.",
      "Best quality usually comes from shorter extensions rather than long chained loops.",
    ],
    defaults: [
      { k: "Resolution", v: "832 × 480" },
      { k: "FPS", v: "16" },
      { k: "Sampler", v: "flowmatch_pusa" },
      { k: "Steps", v: "8" },
      { k: "Frames", v: "121" },
    ],
  },
];

export default function SkyrillsV3Panel() {
  const [section, setSection] = useState<SkyrillsSectionId>("avatar");
  const current = useMemo(() => SECTIONS.find((x) => x.id === section) || SECTIONS[0], [section]);

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="otg-card">
        <div className="otg-cardTitle">Skyrills V3</div>
        <div className="otg-cardBody">
          <div className="otg-help" style={{ marginTop: 0 }}>
            Admin-only SkyReels V3 workspace. These pages are separated from Generate so each one can run its own dedicated workflow.
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            {SECTIONS.map((item) => {
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={active ? "otg-btnPrimary" : "otg-btnGhost"}
                  style={{ borderRadius: 999, minHeight: 40, paddingInline: 16 }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="otg-card">
        <div className="otg-cardTitle" style={{ marginBottom: 6 }}>{current.title}</div>
        <div className="otg-help" style={{ marginTop: 0 }}>{current.subtitle}</div>

        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <div className="otg-card" style={{ padding: 14 }}>
            <div className="otg-help" style={{ marginTop: 0, opacity: 0.9 }}>Workflow model</div>
            <div style={{ fontWeight: 700, marginTop: 6, wordBreak: "break-word" }}>{current.model}</div>
          </div>

          <div className="otg-card" style={{ padding: 14 }}>
            <div className="otg-help" style={{ marginTop: 0, opacity: 0.9 }}>Implementation notes</div>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {current.bullets.map((text, idx) => (
                <div key={idx} className="otg-help" style={{ marginTop: 0 }}>{text}</div>
              ))}
            </div>
          </div>

          <div className="otg-card" style={{ padding: 14 }}>
            <div className="otg-help" style={{ marginTop: 0, opacity: 0.9 }}>Current tested defaults</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 10 }}>
              {current.defaults.map((item) => (
                <div key={item.k} style={{ borderRadius: 16, padding: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="otg-help" style={{ marginTop: 0 }}>{item.k}</div>
                  <div style={{ fontWeight: 700, marginTop: 6 }}>{item.v}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="otg-card" style={{ padding: 14 }}>
            <div className="otg-help" style={{ marginTop: 0, opacity: 0.9 }}>Status</div>
            <div className="otg-help" style={{ marginTop: 10 }}>
              UI shell is ready. Final submit buttons and file inputs will be wired after the validated Comfy workflow JSON is added to the app workflow folder and converted to the production API payload.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
