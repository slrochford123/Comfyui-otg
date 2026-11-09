import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { notFound, redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/sessionUser";
import { timelineEditorEnabled } from "@/lib/timelineEditor/availability";
import TimelineEditorEvaluation from "../components/TimelineEditorEvaluation";

export const dynamic = "force-dynamic";
export default async function TimelineEditorPage() {
  if (!timelineEditorEnabled()) notFound();
  const request = new NextRequest("http://localhost/app/timeline-editor", {
    headers: { cookie: (await cookies()).toString() },
  });
  try {
    await requireSessionUser(request);
  } catch {
    redirect("/app");
  }
  const secureEditorUrl = process.env.OTG_ENV === "test"
    ? "https://shawn-1.tail2c7e2e.ts.net:8443/app/final-export-studio"
    : "https://comf-otg.comfyui-otg.win/app/final-export-studio";
  return <TimelineEditorEvaluation secureEditorUrl={secureEditorUrl} />;
}
