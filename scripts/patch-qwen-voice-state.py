from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
panel = root / "app" / "app" / "components" / "CharactersPanel.tsx"
backup_dir = root / ".manual-backups" / ("qwen-voice-state-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

if not panel.exists():
    raise FileNotFoundError(panel)

backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(panel, backup_dir / "CharactersPanel.tsx")

text = panel.read_text(encoding="utf-8")

def require(needle: str):
    if needle not in text:
        raise RuntimeError("Missing anchor: " + needle)

require('import React, { useEffect, useMemo, useState } from "react";')
require('const [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE);')
require('const identityBlock = useMemo(() => buildIdentityBlock(details, voice), [details, voice]);')
require('function setVoiceField<K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K])')

if "buildQwenVoiceCandidateInstructions" not in text:
    text = text.replace(
        'import React, { useEffect, useMemo, useState } from "react";',
        '''import React, { useEffect, useMemo, useState } from "react";
import {
  buildQwenVoiceCandidateInstructions,
  defaultAvoidTagsForVoiceType,
  defaultQwenVoiceDesignInput,
  qwenVoiceDesignStorageRecord,
  type QwenTextureTag,
  type QwenVoiceCandidateInstruction,
  type QwenVoiceDesignInput,
  type QwenVoiceType,
} from "../../../lib/characters/qwenVoiceDesign";'''
    )

old_state = '''  const [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [voicePackCreated, setVoicePackCreated] = useState(false);
  const [voicePackRecord, setVoicePackRecord] = useState<any | null>(null);
  const [voicePreview, setVoicePreview] = useState<any | null>(null);'''

new_state = '''  const [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [qwenVoiceDesign, setQwenVoiceDesign] = useState<QwenVoiceDesignInput>(() => defaultQwenVoiceDesignInput());
  const [qwenVoiceCandidates, setQwenVoiceCandidates] = useState<QwenVoiceCandidateInstruction[]>([]);
  const [selectedQwenVoiceCandidateId, setSelectedQwenVoiceCandidateId] = useState("");
  const [qwenVoiceDesignRecord, setQwenVoiceDesignRecord] = useState<any | null>(null);
  const [voicePackCreated, setVoicePackCreated] = useState(false);
  const [voicePackRecord, setVoicePackRecord] = useState<any | null>(null);
  const [voicePreview, setVoicePreview] = useState<any | null>(null);'''

if "const [qwenVoiceDesign, setQwenVoiceDesign]" not in text:
    require(old_state)
    text = text.replace(old_state, new_state)

old_reset = '''    setVoice(DEFAULT_VOICE);
    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setVoicePreview(null);'''

new_reset = '''    setVoice(DEFAULT_VOICE);
    setQwenVoiceDesign(defaultQwenVoiceDesignInput());
    setQwenVoiceCandidates([]);
    setSelectedQwenVoiceCandidateId("");
    setQwenVoiceDesignRecord(null);
    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setVoicePreview(null);'''

if "setQwenVoiceDesign(defaultQwenVoiceDesignInput())" not in text:
    require(old_reset)
    text = text.replace(old_reset, new_reset)

old_identity = '''  const identityBlock = useMemo(() => buildIdentityBlock(details, voice), [details, voice]);'''

new_identity = '''  const identityBlock = useMemo(() => buildIdentityBlock(details, voice), [details, voice]);
  const selectedQwenVoiceCandidate = useMemo(
    () => qwenVoiceCandidates.find((candidate) => candidate.candidateId === selectedQwenVoiceCandidateId) || null,
    [qwenVoiceCandidates, selectedQwenVoiceCandidateId],
  );'''

if "const selectedQwenVoiceCandidate = useMemo" not in text:
    require(old_identity)
    text = text.replace(old_identity, new_identity)

set_voice_block = '''  function setVoiceField<K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) {
    setVoice((current) => ({ ...current, [key]: value }));
  }
'''

qwen_helpers = '''
  function clearQwenVoiceSelection() {
    setQwenVoiceCandidates([]);
    setSelectedQwenVoiceCandidateId("");
    setQwenVoiceDesignRecord(null);
    setVoicePackCreated(false);
    setVoicePackRecord(null);
  }

  function setQwenVoiceField<K extends keyof QwenVoiceDesignInput>(key: K, value: QwenVoiceDesignInput[K]) {
    setQwenVoiceDesign((current) => {
      const next = { ...current, [key]: value };
      if (key === "voiceType") {
        const nextVoiceType = value as QwenVoiceType;
        next.avoidTags = defaultAvoidTagsForVoiceType(nextVoiceType);
      }
      return next;
    });
    clearQwenVoiceSelection();
  }

  function toggleQwenTexture(tag: QwenTextureTag) {
    setQwenVoiceDesign((current) => {
      const exists = current.textureTags.includes(tag);
      const textureTags = exists
        ? current.textureTags.filter((item) => item !== tag)
        : [...current.textureTags, tag].slice(0, 3);
      return { ...current, textureTags };
    });
    clearQwenVoiceSelection();
  }

  function generateQwenVoiceDesignCandidates() {
    const candidates = buildQwenVoiceCandidateInstructions(qwenVoiceDesign);
    setQwenVoiceCandidates(candidates);
    setSelectedQwenVoiceCandidateId(candidates[0]?.candidateId || "");
    setQwenVoiceDesignRecord(null);
    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setMessage(`Generated ${candidates.length} Qwen voice design options. Pick one, then click Create Voice.`);
  }

  function useQwenVoiceCandidate(candidate: QwenVoiceCandidateInstruction) {
    const record = qwenVoiceDesignStorageRecord(qwenVoiceDesign, candidate);
    setSelectedQwenVoiceCandidateId(candidate.candidateId);
    setQwenVoiceDesignRecord(record);
    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setMessage(`${candidate.label} selected. Click Create Voice to save this design metadata.`);
  }
'''

if "function setQwenVoiceField" not in text:
    require(set_voice_block)
    text = text.replace(set_voice_block, set_voice_block + "\n" + qwen_helpers)

required = [
    "buildQwenVoiceCandidateInstructions",
    "defaultQwenVoiceDesignInput",
    "const [qwenVoiceDesign, setQwenVoiceDesign]",
    "selectedQwenVoiceCandidate",
    "function generateQwenVoiceDesignCandidates",
    "function useQwenVoiceCandidate",
]

missing = [item for item in required if item not in text]
if missing:
    raise RuntimeError("Patch verification failed: " + ", ".join(missing))

panel.write_text(text, encoding="utf-8")

print("OK: CharactersPanel Qwen voice state/helpers patched.")
print("Changed:", panel)
print("Backup:", backup_dir)