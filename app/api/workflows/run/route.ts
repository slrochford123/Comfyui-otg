import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { WORKFLOWS } from "@/lib/workflows/manifest";

type WorkflowId = keyof typeof WORKFLOWS;

function isWorkflowId(v: unknown): v is WorkflowId {
  return typeof v === "string" && v in WORKFLOWS;
}

type RunRequestBody = {
  workflowId: unknown;
  inputs?: unknown;
};

export async function POST(req: Request) {
  const body = (await req.json()) as RunRequestBody;

  if (!isWorkflowId(body.workflowId)) {
    return NextResponse.json({ error: "Invalid workflowId" }, { status: 400 });
  }

  const workflowId: WorkflowId = body.workflowId;
  const inputs = (body.inputs ?? {}) as Record<string, any>;

  const config = WORKFLOWS[workflowId];

  const workflowPath = path.join(process.cwd(), "workflows", "comfy", config.file);
  const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf-8"));
  // ---- Patch logic (minimal scaffold) ----
  if (workflowId === "angles") {
    workflow["41"].inputs.image = inputs.image;
    workflow["93"].inputs.horizontal_angle = inputs.horizontal;
    workflow["93"].inputs.vertical_angle = inputs.vertical;
    workflow["93"].inputs.zoom = inputs.zoom;
    workflow["93"].inputs.default_prompts = inputs.defaultPrompts ?? false;
    workflow["93"].inputs.camera_view = inputs.cameraView ?? false;
  }

  if (workflowId.startsWith("storyboard")) {
    workflow["30"].inputs.prompt = inputs.prompt;
  }

  if (workflowId === "voice_design") {
    workflow["76"].inputs.value = inputs.text;
    workflow["77"].inputs.value = inputs.voiceDescription;
  }

  return NextResponse.json({ status: "patched", workflowId });
}
