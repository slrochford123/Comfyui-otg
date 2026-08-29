import { redirect } from "next/navigation";

export default function LegacyAnglesRedirectPage() {
  redirect("/app?tab=machine");
}
