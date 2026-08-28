import fs from 'node:fs';
import path from 'node:path';

export type OtgLogEvent =
  | 'generation.request'
  | 'backend.selected'
  | 'job.transition'
  | 'comfy.prompt_id'
  | 'output.saved'
  | 'route.failure';

const SECRET_KEYS = /(password|token|secret|cookie|authorization|api[_-]?key)/i;

function logsEnabled() {
  return String(process.env.OTG_LOCAL_LOGS || 'true').toLowerCase() !== 'false';
}

function logPath() {
  const root = process.env.OTG_DATA_DIR || path.join(process.cwd(), 'data');
  return path.join(root, 'logs', 'otg.log');
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? '[redacted]' : redact(inner);
    }
    return out;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function logOtgEvent(event: OtgLogEvent, detail: Record<string, unknown> = {}) {
  if (!logsEnabled()) return;
  const file = logPath();
  const safeDetail = asRecord(redact(detail));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    JSON.stringify({ ts: new Date().toISOString(), event, ...safeDetail }) + '\n',
    'utf8',
  );
}

export function logRouteFailure(route: string, error: unknown, detail: Record<string, unknown> = {}) {
  logOtgEvent('route.failure', {
    route,
    error: String((error as any)?.message || error),
    stack: process.env.NODE_ENV === 'production' ? undefined : (error as any)?.stack,
    ...detail,
  });
}
