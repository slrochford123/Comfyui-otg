SLR Studios: Google Play internal-testing publisher
================================================

Purpose
-------
This command-line tool runs on the Ubuntu 3090 host. It uploads only the
com.slr.otg package to an owned internal-track draft. With explicit approval it
can also submit that exact candidate to the existing internal testers. It cannot
publish to production, edit tester lists, change billing, rotate
signing keys, or grant account permissions. It does not require sudo or Chrome.

Google account authorization is separate from the Android upload keystore.
The existing Android signing key is not a Google API service-account key.

One-time owner setup
--------------------
1. In Google Cloud Console, select an appropriate existing project or create
   one for SLR Studios. Enable Google Play Android Developer API
   (androidpublisher.googleapis.com).
2. Create a service account named slr-play-uploader. No Google Cloud project
   Owner, Editor or billing role is needed for this uploader. Do not enable
   domain-wide delegation.
3. In Google Play Console > Users and permissions, invite that service
   account's full email address. Limit access to SLR Studios (com.slr.otg).
   Grant only View app information (read-only) and Release apps to testing
   tracks. Do not grant production release, account admin, financial, signing,
   store-presence or tester-list permissions. Read access to production track
   metadata is needed only to prove that it is left unchanged.
4. In Google Cloud Console > Service accounts > the new account > Keys,
   create a JSON key if your organization permits long-lived keys. If key
   creation is disabled, do not weaken organization policy; stop and discuss
   workload identity or service-account impersonation instead.
5. Save the downloaded JSON on the 3090, outside all Git repositories.
   Suggested location:
   /home/shawn-rochford/Downloads/slr-play-service-account.json
   Do not paste the key into chat, send it by email, or commit it to GitHub.
6. Tell Codex the file is ready. Codex can import it, restrict both copies to
   mode 600, and verify Google permissions without publishing anything.

Google references
-----------------
https://developers.google.com/android-publisher/getting_started
https://support.google.com/googleplay/android-developer/answer/9844686
https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit

Local runtime installation
--------------------------
Use Node.js 22. Install this directory's package.json and package-lock.json in
~/.local/share/slr-play-publisher with npm ci --ignore-scripts --no-audit.
Keep that directory mode 700. It is independent of the web app dependencies.
Credentials are stored only in:
~/.config/otg-android/play-publisher/service-account.json
Private receipts are stored in that directory's receipts/ subdirectory.

Commands (run from the repository root)
---------------------------------------
node scripts/android/play-publisher.cjs status
node scripts/android/play-publisher.cjs import-key --from /absolute/key.json
node scripts/android/play-publisher.cjs plan --manifest /absolute/candidate.json
node scripts/android/play-publisher.cjs probe
node scripts/android/play-publisher.cjs stage --manifest /absolute/candidate.json --execute
node scripts/android/play-publisher.cjs save-draft --receipt /absolute/receipt.json --execute
node scripts/android/play-publisher.cjs release-internal --receipt /absolute/receipt.json --automatic-review --execute

plan performs local checks only. probe creates, reads and deletes only its own
temporary metadata edit; it does not upload or commit. stage uploads a hash-
pinned AAB, validates an internal draft, and leaves an expiring open edit.
save-draft is a separate operation. It saves only that draft; the candidate is
not served to testers or public users. There is no public-rollout command.

release-internal is a separately authorized operation. It replaces only the
active internal-test release with the pinned, validated candidate and allows
Google's normal review processing. It never targets production or other tracks,
changes tester membership, or requests deletion of old artifacts. The edit's
current-bundle list is not used as proof of historical archive availability.
The owner approved only internal testing on November 2, 2026. Obtain explicit
owner authorization before future release runs; this is not a recurring job.

The first successful probe checks currently visible version codes. Google's
successful upload receipt, not a local estimate, proves version acceptance.
The previous Android upload certificate remains separately documented and
must be checked against the current Play record when possible. A wrong
upload certificate must be corrected, not bypassed or replaced automatically.

Safety and recovery
--------------------
Existing internal drafts or unfinished internal rollouts stop staging. Existing
completed internal releases and every non-internal track are preserved.
Commit explicitly uses ERROR_IF_IN_REVIEW so a review already in progress is
not canceled. The tool never falls back to a different commit policy.

For com.slr.otg, the first real upload and validation of build 37 succeeded,
but saving the draft returned HTTP 400: Google says changes are sent for
review automatically and changesNotSentForReview must not be set. The draft
was NOT committed. The owner subsequently approved an INTERNAL tester update
for corrected purple-icon build 38. release-internal omits only the inapplicable
changesNotSentForReview hold, while retaining ERROR_IF_IN_REVIEW. save-draft
still retains the hold; neither command automatically retries or falls back to
a review-cancellation policy. Do not retry the old build-37 receipt.
Bounded, redacted Google error details are retained in private failure receipts;
OAuth tokens, raw response headers and service-account keys are never logged.

There are no automatic write retries. If an upload or commit times out, retain
the private receipt and reconcile its owned edit in Play before retrying.
Uncommitted edits expire; do not assume timeout means an upload never arrived.
Do not delete another operator's drafts or change live releases to clear errors.

The API is not a bypass for Google reviews, declarations, content policies or
Android device qualification. These gates remain required before any rollout.
The current H3 NSFW/content-policy question is not resolved by this setup.
