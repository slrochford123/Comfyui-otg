import Link from "next/link";
import VoiceCreatorPanel from "../components/VoiceCreatorPanel";
import { isAdminSession } from "@/app/api/_lib/comfyTarget";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AudioStudiosPage() {
  const isAdmin = await isAdminSession();

  return (
    <main className="min-h-screen bg-[#07080c] px-3 py-4 pb-24 text-white sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[1480px] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/app" className="rounded-[16px] border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10">
            ← Back to Studios
          </Link>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/40">Character Audio</div>
        </div>
        <VoiceCreatorPanel isAdmin={isAdmin} />
      </div>
    </main>
  );
}
