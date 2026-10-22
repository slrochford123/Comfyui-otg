import OpenAIBillingClient from "./OpenAIBillingClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function OpenAIBillingPage() {
  return <OpenAIBillingClient />;
}

