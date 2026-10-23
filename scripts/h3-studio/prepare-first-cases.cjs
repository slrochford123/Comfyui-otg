/* Local planning only. Never hashes model weights, fetches services or starts jobs.
 * node scripts/h3-studio/prepare-first-cases.cjs --owner OWNER_KEY --research-root /absolute/private/research/path [--models-root /absolute/ComfyUI/models]
 * --prepare/--execute are intentionally not accepted by this script.
 */
require("../register-ts-worker.cjs");
if (require.main === module) require("./qualification-first-cases.ts").prepareFirstCasesCli(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
});
