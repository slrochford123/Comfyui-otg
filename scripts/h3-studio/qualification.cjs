/* Local owner procedure. With no --execute this only compiles a proposal from local files.
 * node scripts/h3-studio/qualification.cjs --proposal /absolute/mode600/proposal.json
 * OTG_ENV=test node scripts/h3-studio/qualification.cjs --proposal ... --approval ... --execute
 * Approval: mode600, current UID, single regular file in a mode700 directory;
 * copy the printed approval fields, choose approvalId (16+ chars), UUID, expiry <=1h.
 * Do not expose this through an API/admin route. Do not pre-acknowledge Android playback.
 * The existing runner owns the physical mutex, idle/GPU recheck, cancellation and
 * submitH3Prompt(..., { releasePeer: false }) behavior for admitted jobs.
 */
require("../register-ts-worker.cjs");
if (require.main === module) require("./qualification").qualificationCli(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
});
