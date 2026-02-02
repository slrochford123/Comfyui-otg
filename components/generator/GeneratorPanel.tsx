'use client';

import React, { useMemo, useRef, useState } from 'react';
import { WorkflowSelect } from './WorkflowSelect';
import { VideoProfilePicker } from './VideoProfilePicker';
import { DurationPicker } from './DurationPicker';
import { EnhancePanel } from './EnhancePanel';
import type { EnhanceLevel, Ratio, Size, Seconds } from "../../lib/generator/types";


export type ComfyPreset = {
  name: string;
  label?: string;
  description?: string;
  img2img?: boolean;
};

export type VideoProfileSelection = {
  ratio: Exclude<Ratio, 'auto'>;
  size: Size;
};

export function GeneratorPanel(props: {
  presets: ComfyPreset[];
  selectedPreset: string;
  setSelectedPreset: (v: string) => void;

  positivePrompt: string;
  setPositivePrompt: (v: string) => void;
  negativePrompt: string;
  setNegativePrompt: (v: string) => void;

  refreshWorkflows: () => Promise<void> | void;
  onGenerate: (opts: { video: VideoProfileSelection; seconds: number }) => Promise<void> | void;

  sending: boolean;
  canRun: boolean;

  // Image-to-Video (img2img)
  willUseImg2Img?: boolean;
  uploadingImage?: boolean;
  pickedFileName?: string;
  pickedFilePreview?: string;
  uploadedImagePath?: string;
  onPickImage?: (file: File) => Promise<void> | void;
  onClearImage?: () => void;

}) {
  const {
    presets,
    selectedPreset,
    setSelectedPreset,
    positivePrompt,
    setPositivePrompt,
    negativePrompt,
    setNegativePrompt,
    refreshWorkflows,
    onGenerate,
    sending,
    canRun,
  } = props;

  const fileRef = useRef<HTMLInputElement | null>(null);


  const [enhanceLevel, setEnhanceLevel] = useState<EnhanceLevel>('medium');
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceMsg, setEnhanceMsg] = useState<string | null>(null);

  // IMPORTANT: Ratio includes "auto" so VideoProfilePicker can be typed consistently.
  const [ratio, setRatio] = useState<Ratio>('auto');
  const [size, setSize] = useState<Size>(512);

  const [seconds, setSeconds] = useState<Seconds>(5);

  const workflowOptions = useMemo(
    () =>
      (presets || []).map((p) => ({
        id: p.name,
        // Prefer a friendly label, but keep IDs stable. If a label contains spaces,
        // show a kebab-case UI label to match your "text-to-video" naming.
        label: (() => {
          const raw = (p.label || p.name || '').trim();
          if (!raw) return p.name;
          // Special-case the one you asked for.
          if (raw.toLowerCase() === 'text to video') return 'text-to-video';
          // If it looks like a title, kebab it; otherwise keep it.
          if (raw.includes(' ')) return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          return raw;
        })(),
        description: p.description || '',
      })),
    [presets],
  );

  async function handleEnhance() {
    const text = (positivePrompt || '').trim();
    if (!text) {
      setEnhanceMsg('Enter a positive prompt first.');
      return;
    }

    setEnhancing(true);
    setEnhanceMsg(null);
    try {
      const r = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, level: enhanceLevel }),
      });
      const j = await r.json().catch(() => null);
      const out = String(j?.text || j?.result || j?.enhanced || '');
      if (!r.ok) {
        setEnhanceMsg(String(j?.error || `Enhance failed (${r.status})`));
        return;
      }
      if (out) {
        setPositivePrompt(out);
        setEnhanceMsg(j?.fallback ? 'Enhanced (local fallback).' : 'Enhanced.');
      } else {
        setEnhanceMsg('Enhance returned empty text.');
      }
    } finally {
      setEnhancing(false);
    }
  }

  function handleSelectWorkflow(id: string) {
    setSelectedPreset(id);
    // Auto-set ratio based on workflow type.
    // "text-to-video" defaults wide; "picture" defaults square.
    const n = String(id || '').toLowerCase();
    if (n.includes('text') || n.includes('t2v') || n.includes('video')) {
      setRatio('16:9');
    } else if (n.includes('image') || n.includes('img') || n.includes('picture') || n.includes('photo')) {
      setRatio('1:1');
    }
  }

  return (
    <div className="otg-stack" style={{ padding: 16, maxWidth: 520, margin: '0 auto' }}>
      {/* Prompts (match Storybook layout) */}
      <div className="otg-card">
        <div className="otg-cardTitle">Prompts</div>

        <div className="otg-cardSubtitle">Positive</div>
        <textarea
          className="otg-textarea"
          placeholder="Describe what you want..."
          value={positivePrompt}
          onChange={(e) => setPositivePrompt(e.target.value)}
        />

        <div className="otg-cardSubtitle" style={{ marginTop: 10 }}>
          Negative (optional)
        </div>
        <textarea
          className="otg-textarea"
          placeholder="Things you don't want... (optional)"
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
        />
      </div>

      {/* Enhance (Storybook-style) */}
      <EnhancePanel
        level={enhanceLevel}
        onChangeLevel={setEnhanceLevel}
        onEnhance={handleEnhance}
        disabled={sending}
        busy={enhancing}
      />
      {enhanceMsg ? (
        <div className="otg-muted" style={{ marginTop: -8 }}>{enhanceMsg}</div>
      ) : null}
      {/* Image (only for Image-to-Video / img2img workflows) */}
      {props.willUseImg2Img ? (
        <div className="otg-card">
          <div className="otg-cardTitle">Image</div>
          <div className="otg-muted" style={{ marginTop: -6, marginBottom: 10 }}>
            Choose an input image for Image-to-Video.
          </div>

          <div className="otg-row otg-between otg-center" style={{ gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="otg-btn"
              disabled={props.sending || props.uploadingImage || !props.onPickImage}
              onClick={() => fileRef.current?.click()}
            >
              {props.uploadingImage ? "Uploading..." : "Choose Image"}
            </button>

            {props.pickedFileName ? (
              <div className="otg-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}>
                {props.pickedFileName}
              </div>
            ) : (
              <div className="otg-muted">No image selected.</div>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f || !props.onPickImage) return;
              props.onPickImage(f);
              e.currentTarget.value = "";
            }}
          />

          {props.pickedFilePreview ? (
            <div style={{ marginTop: 12 }}>
              <img
                src={props.pickedFilePreview}
                alt="Selected"
                style={{ width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 12 }}
              />
            </div>
          ) : null}

          {props.uploadedImagePath ? (
            <div className="otg-muted" style={{ marginTop: 10 }}>
              Uploaded to ComfyUI: <span className="otg-mono">{props.uploadedImagePath}</span>
            </div>
          ) : (
            <div className="otg-muted" style={{ marginTop: 10 }}>
              Upload required before Generate.
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="otg-btn"
              disabled={props.sending || props.uploadingImage || !props.onClearImage}
              onClick={() => props.onClearImage?.()}
            >
              Remove Image
            </button>
          </div>
        </div>
      ) : null}


      {/* Workflow (kept, but styled as a normal card so it matches Storybook) */}
      <div className="otg-card">
        <div className="otg-cardTitle">Workflow</div>
        <WorkflowSelect
          workflows={workflowOptions}
          value={selectedPreset}
          onChange={handleSelectWorkflow}
          onSync={refreshWorkflows}
          syncing={sending}
        />
      </div>

      <VideoProfilePicker ratio={ratio} size={size} onChangeRatio={setRatio} onChangeSize={setSize} />
      <DurationPicker value={seconds} onChange={setSeconds} />

      {/* Generate (Storybook-style) */}
      <div className="otg-card">
        <div className="otg-cardTitle">Generate</div>
        <button
          className="otg-btn otg-btnPrimary"
          disabled={sending || !canRun}
          onClick={() => {
            // If "auto" is selected, default to 16:9 when submitting.
            const safeRatio: Exclude<Ratio, 'auto'> = ratio === 'auto' ? '16:9' : ratio;
            onGenerate({ video: { ratio: safeRatio, size }, seconds });
          }}
          type="button"
        >
          {sending ? 'Sending...' : 'Generate'}
        </button>

        <div className="otg-muted" style={{ marginTop: 8 }}>
          {selectedPreset ? (
            <>
              Selected: <span className="otg-mono">{selectedPreset}</span>
            </>
          ) : (
            'Select a workflow to generate.'
          )}
        </div>
      </div>
    </div>
  );
}
