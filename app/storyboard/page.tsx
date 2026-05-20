
import { redirect } from "next/navigation";
import { isProductionFeatureEnabled } from "@/lib/production/featureGate";

export default function StoryboardPage() {
  if (!isProductionFeatureEnabled()) redirect("/app");

  return <div>Storyboard Tab Ready</div>;
}
