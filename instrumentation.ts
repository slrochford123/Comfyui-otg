/*
 * OTG_QWEN_NEXT_STARTUP_RECOVERY_V1
 * OTG_PRODUCTION_V2_PROMPT_STARTUP_RECOVERY_V1
 *
 * Node-only durable queue/orchestration startup recovery.
 */

export async function register() {
  if (
    process.env.NEXT_RUNTIME
    !== "nodejs"
  ) {
    return;
  }

  const {
    bootstrapQwenDurableScheduler,
  } =
    await import(
      "./lib/workers/qwenDurableBootstrap"
    );

  /*
   * Recover raw Qwen jobs first so any pre-crash running child is
   * resolved as ambiguous failure before parent operations inspect it.
   */
  bootstrapQwenDurableScheduler();

  const {
    bootstrapProductionV2PromptOperationScheduler,
  } =
    await import(
      "./lib/production/v2PromptOperations"
    );

  bootstrapProductionV2PromptOperationScheduler();
}
