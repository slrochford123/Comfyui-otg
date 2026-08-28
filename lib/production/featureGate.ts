import { NextResponse } from "next/server";

function envFlagEnabled(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isProductionFeatureEnabled() {
  return envFlagEnabled(process.env.OTG_ENABLE_PRODUCTION) || envFlagEnabled(process.env.NEXT_PUBLIC_OTG_ENABLE_PRODUCTION);
}

export function productionDisabledResponse() {
  return NextResponse.json(
    {
      ok: false,
      disabled: true,
      error: "Production is temporarily disabled.",
    },
    {
      status: 503,
      headers: { "cache-control": "no-store" },
    }
  );
}
