import { NextRequest } from "next/server";
import { executeH3Studio } from "@/lib/h3StudioExecution";
import {recoverableH3Submission} from "@/lib/h3SubmissionRecovery";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { return recoverableH3Submission(request, "studio-execute", executeH3Studio); }
