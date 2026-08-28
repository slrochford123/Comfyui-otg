import { NextRequest } from 'next/server';
import { getOwnerContext } from '@/lib/ownerKey';
import { defaultJobStore } from '@/lib/jobs/jsonJobStore';
import { jsonError, jsonOk, readJsonBody, sessionErrorResponse } from '@/lib/http/routeHelpers';
import type { JobKind } from '@/lib/jobs/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JOB_KINDS = new Set<JobKind>([
  'image-generation',
  'video-generation',
  'tts',
  'voice-dubbing',
  'audio-extraction',
  'music-generation',
  'angles-3d',
  'production-stitch',
]);

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    return jsonOk({ jobs: defaultJobStore.list(owner.ownerKey) });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError('Could not list jobs.');
  }
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = await readJsonBody<any>(req);
    if (!body.ok) return jsonError(body.error, { status: body.status });
    const kind = String(body.value?.kind || '') as JobKind;
    if (!JOB_KINDS.has(kind)) return jsonError('Invalid job kind.', { status: 400, code: 'invalid_job_kind' });

    const job = defaultJobStore.create({
      ownerKey: owner.ownerKey,
      deviceId: owner.deviceId,
      kind,
      title: body.value?.title || null,
      backend: body.value?.backend || null,
      requestPayload: body.value?.requestPayload ?? null,
    });
    return jsonOk({ job }, { status: 201 });
  } catch (error: any) {
    return sessionErrorResponse(error) || jsonError(error?.message || 'Could not create job.');
  }
}
