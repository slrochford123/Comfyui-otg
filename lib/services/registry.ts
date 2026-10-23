import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

const execFileAsync = promisify(execFile);

export type ServiceKind = 'http' | 'command' | 'runtime';
export type ServiceId = 'comfy-image' | 'comfy-video' | 'hunyuan' | 'indextts2' | 'omnivoice' | 'ollama' | 'bg-remove' | 'ffmpeg';

export type ServiceConfig = {
  id: ServiceId;
  label: string;
  kind: ServiceKind;
  env: string[];
  baseUrl?: string;
  healthPath?: string;
  command?: string;
  args?: string[];
  required?: boolean;
  configured?: boolean;
  enabled?: boolean;
};
export type ServiceHealthState = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'NOT CONFIGURED' | 'DISABLED';

function trimUrl(value: string | undefined, fallback: string) {
  return String(value || fallback).replace(/\/+$/, '');
}

export function getServiceRegistry(env: NodeJS.ProcessEnv = process.env): Record<ServiceId, ServiceConfig> {
  const comfy = trimUrl(env.COMFYUI_URL || env.COMFY_BASE_URL || env.COMFY_URL, 'http://127.0.0.1:8188');
  const registry: Record<ServiceId, ServiceConfig> = {
    'comfy-image': {
      id: 'comfy-image',
      label: 'Comfy image',
      kind: 'http',
      env: ['COMFYUI_IMAGE_URL', 'COMFY_IMAGE_BASE_URL', 'COMFY_BASE_URL', 'COMFY_URL'],
      baseUrl: trimUrl(env.OTG_IMAGE_COMFY_BASE_URL || env.COMFYUI_IMAGE_URL || env.COMFY_IMAGE_BASE_URL || comfy, comfy),
      healthPath: '/system_stats',
      required: true,
    },
    'comfy-video': {
      id: 'comfy-video',
      label: 'Comfy video',
      kind: 'http',
      env: ['COMFYUI_VIDEO_URL', 'COMFY_VIDEO_BASE_URL', 'COMFYUI_URL', 'COMFY_BASE_URL', 'COMFY_URL'],
      baseUrl: trimUrl(env.OTG_VIDEO_PRIMARY_COMFY_URL || env.COMFYUI_VIDEO_PRIMARY_URL || env.OTG_VIDEO_COMFY_BASE_URL || env.COMFYUI_VIDEO_URL || env.COMFY_VIDEO_BASE_URL, comfy),
      healthPath: '/system_stats',
      required: true,
    },
    hunyuan: {
      id: 'hunyuan',
      label: 'Hunyuan',
      kind: 'http',
      env: ['HUNYUAN_BASE_URL', 'HUNYUAN_URL'],
      baseUrl: trimUrl(env.HUNYUAN_BASE_URL || env.HUNYUAN_URL, ''),
      healthPath: env.HUNYUAN_HEALTH_PATH || '/health',
    },
    indextts2: {
      id: 'indextts2',
      label: 'IndexTTS2',
      kind: 'http',
      env: ['INDEXTTS2_BASE_URL', 'INDEXTTS2_URL'],
      baseUrl: trimUrl(env.INDEXTTS2_BASE_URL || env.INDEXTTS2_URL, ''),
      healthPath: env.INDEXTTS2_HEALTH_PATH || '/health',
    },
    omnivoice: {
      id: 'omnivoice',
      label: 'OmniVoice',
      kind: 'http',
      env: ['OMNIVOICE_BASE_URL', 'OMNIVOICE_URL', 'OMNIVOICE_TTS_URL'],
      baseUrl: trimUrl(env.OMNIVOICE_BASE_URL || env.OMNIVOICE_URL || env.OMNIVOICE_TTS_URL, ''),
      healthPath: env.OMNIVOICE_HEALTH_PATH || '/health',
    },
    ollama: {
      id: 'ollama',
      label: 'Ollama',
      kind: 'http',
      env: ['OLLAMA_BASE_URL', 'OLLAMA_URL'],
      baseUrl: trimUrl(env.OLLAMA_BASE_URL || env.OLLAMA_URL, 'http://127.0.0.1:11434'),
      healthPath: '/api/tags',
    },
    'bg-remove': {
      id: 'bg-remove',
      label: 'bg-remove',
      kind: 'http',
      env: ['BG_REMOVE_BASE_URL', 'BG_REMOVE_URL'],
      baseUrl: trimUrl(env.BG_REMOVE_BASE_URL || env.BG_REMOVE_URL, ''),
      healthPath: env.BG_REMOVE_HEALTH_PATH || '/health',
    },
    ffmpeg: {
      id: 'ffmpeg',
      label: 'ffmpeg',
      kind: 'command',
      env: ['FFMPEG_PATH'],
      command: env.FFMPEG_PATH || 'ffmpeg',
      args: ['-version'],
      required: true,
    },
  };
  for (const service of Object.values(registry)) {
    if (service.id === 'indextts2' && !service.baseUrl && env.INDEX_TTS_PYTHON) { service.kind = 'runtime'; service.command = env.INDEX_TTS_PYTHON; }
    const enabledKey = `OTG_SERVICE_${service.id.replace(/-/g, '_').toUpperCase()}_ENABLED`;
    service.enabled = !['false', '0', 'disabled'].includes(String(env[enabledKey] || '').toLowerCase());
    service.configured = service.kind !== 'http' || Boolean(service.baseUrl);
  }
  return registry;
}

export async function checkService(service: ServiceConfig, timeoutMs = 1500) {
  const startedAt = Date.now();
  const base = { id: service.id, label: service.label, required: Boolean(service.required), configured: service.configured !== false, enabled: service.enabled !== false };
  if (!base.enabled || !base.configured) return { ...base, ok: false, state: (!base.enabled ? 'DISABLED' : 'NOT CONFIGURED') as ServiceHealthState, ms: 0, status: 0, target: service.baseUrl, error: undefined, version: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (service.kind === 'runtime') {
      await access(service.command || '', constants.X_OK);
      return { ...base, state: 'DEGRADED' as ServiceHealthState, ok: false, status: 0, target: service.command, ms: Date.now() - startedAt, error: 'Local CLI interpreter is configured. Model initialization and synthesis are not verified by this health probe.', version: null };
    }
    if (service.kind === 'http') {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const url = `${service.baseUrl}${service.healthPath || '/health'}`;
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timer);
      return {
        ...base,
        state: (res.ok ? 'HEALTHY' : res.status >= 500 ? 'DOWN' : 'DEGRADED') as ServiceHealthState,
        id: service.id,
        label: service.label,
        ok: res.ok,
        status: res.status,
        target: service.baseUrl,
        ms: Date.now() - startedAt,
      };
    }

    const { stdout } = await execFileAsync(service.command || service.id, service.args || ['--version'], { timeout: timeoutMs });
    return {
      ...base,
      state: 'HEALTHY' as ServiceHealthState,
      id: service.id,
      label: service.label,
      ok: true,
      status: 0,
      target: service.command,
      version: stdout.split('\n')[0]?.trim() || null,
      ms: Date.now() - startedAt,
    };
  } catch (error: any) {
    return {
      ...base,
      state: 'DOWN' as ServiceHealthState,
      id: service.id,
      label: service.label,
      ok: false,
      status: error?.status || error?.code || 0,
      target: service.kind === 'http' ? service.baseUrl : service.command,
      error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error),
      ms: Date.now() - startedAt,
    };
  } finally { if (timer) clearTimeout(timer); }
}

export async function checkAllServices(registry = getServiceRegistry()) {
  return Promise.all(Object.values(registry).map((service) => checkService(service)));
}
