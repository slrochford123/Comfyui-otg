import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ServiceKind = 'http' | 'command';
export type ServiceId = 'comfy-image' | 'comfy-video' | 'hunyuan' | 'indextts2' | 'ollama' | 'bg-remove' | 'ffmpeg';

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
};

function trimUrl(value: string | undefined, fallback: string) {
  return String(value || fallback).replace(/\/+$/, '');
}

export function getServiceRegistry(env: NodeJS.ProcessEnv = process.env): Record<ServiceId, ServiceConfig> {
  const comfy = trimUrl(env.COMFY_BASE_URL || env.COMFY_URL, 'http://127.0.0.1:8188');
  return {
    'comfy-image': {
      id: 'comfy-image',
      label: 'Comfy image',
      kind: 'http',
      env: ['COMFY_IMAGE_BASE_URL', 'COMFY_BASE_URL', 'COMFY_URL'],
      baseUrl: trimUrl(env.COMFY_IMAGE_BASE_URL, comfy),
      healthPath: '/system_stats',
      required: true,
    },
    'comfy-video': {
      id: 'comfy-video',
      label: 'Comfy video',
      kind: 'http',
      env: ['COMFY_VIDEO_BASE_URL', 'COMFY_BASE_URL', 'COMFY_URL'],
      baseUrl: trimUrl(env.COMFY_VIDEO_BASE_URL, comfy),
      healthPath: '/system_stats',
      required: true,
    },
    hunyuan: {
      id: 'hunyuan',
      label: 'Hunyuan',
      kind: 'http',
      env: ['HUNYUAN_BASE_URL', 'HUNYUAN_URL'],
      baseUrl: trimUrl(env.HUNYUAN_BASE_URL || env.HUNYUAN_URL, 'http://127.0.0.1:8081'),
      healthPath: env.HUNYUAN_HEALTH_PATH || '/health',
    },
    indextts2: {
      id: 'indextts2',
      label: 'IndexTTS2',
      kind: 'http',
      env: ['INDEXTTS2_BASE_URL', 'INDEXTTS2_URL'],
      baseUrl: trimUrl(env.INDEXTTS2_BASE_URL || env.INDEXTTS2_URL, 'http://127.0.0.1:7860'),
      healthPath: env.INDEXTTS2_HEALTH_PATH || '/health',
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
      baseUrl: trimUrl(env.BG_REMOVE_BASE_URL || env.BG_REMOVE_URL, 'http://127.0.0.1:7000'),
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
}

export async function checkService(service: ServiceConfig, timeoutMs = 1500) {
  const startedAt = Date.now();
  try {
    if (service.kind === 'http') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const url = `${service.baseUrl}${service.healthPath || '/health'}`;
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timer);
      return {
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
      id: service.id,
      label: service.label,
      ok: false,
      status: error?.status || error?.code || 0,
      target: service.kind === 'http' ? service.baseUrl : service.command,
      error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error),
      ms: Date.now() - startedAt,
    };
  }
}

export async function checkAllServices(registry = getServiceRegistry()) {
  return Promise.all(Object.values(registry).map((service) => checkService(service)));
}
