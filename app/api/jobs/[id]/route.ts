import { NextRequest } from 'next/server';
import { getOwnerContext } from '@/lib/ownerKey';
import { defaultJobStore } from '@/lib/jobs/jsonJobStore';
import { jsonError, jsonOk, readJsonBody, sessionErrorResponse } from '@/lib/http/routeHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const owner = await getOwnerContext(req);
    const { id } = await ctx.params;
    const job = defaultJobStore.get(id, owner.ownerKey);
    if (!job) return jsonError('Job not found.', { status: 404, code: 'job_not_found' });
    return jsonOk({ job });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError('Could not load job.');
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const owner = await getOwnerContext(req);
    const { id } = await ctx.params;
    const body = await readJsonBody<any>(req);
    if (!body.ok) return jsonError(body.error, { status: body.status });
    const job = defaultJobStore.update(id, owner.ownerKey, body.value || {});
    if (!job) return jsonError('Job not found.', { status: 404, code: 'job_not_found' });
    return jsonOk({ job });
  } catch (error: any) {
    return sessionErrorResponse(error) || jsonError(error?.message || 'Could not update job.');
  }
}
