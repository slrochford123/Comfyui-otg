import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const deviceId = searchParams.get('deviceId');
  if (!deviceId) {
    return NextResponse.json({ error: 'deviceId required' }, { status: 400 });
  }

  const root =
    process.env.OTG_DEVICE_OUTPUT_ROOT ||
    process.env.OTG_DATA_DIR ||
    path.join(process.cwd(), 'data');

  const jobsFile = path.join(root, 'device_jobs', `${deviceId}.jsonl`);

  try {
    if (!fs.existsSync(jobsFile)) {
      return NextResponse.json({ latestCompleted: null });
    }

    const raw = fs.readFileSync(jobsFile, 'utf-8').trim();
    if (!raw) return NextResponse.json({ latestCompleted: null });

    const lines = raw.split('\n');
    const last = JSON.parse(lines[lines.length - 1]);

    const status = last.status || last.state;
    const prompt_id = last.prompt_id || last.promptId;
    const completed_at = last.completed_at || last.completedAt || last.updated_at || last.updatedAt;

    if (status !== 'completed') {
      return NextResponse.json({ latestCompleted: null });
    }

    return NextResponse.json({
      latestCompleted: { prompt_id, completed_at },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'render-status failed', details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
