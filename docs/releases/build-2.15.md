# Build 2.15 — H3 foreground and submission recovery

H3 refreshes its connection, authentication and job status on browser/native foreground events. Returning to the app does not automatically create a video.

The main Create Video action retains an immutable owner-scoped request identity until acceptance is confirmed. Backend receipts recover lost responses without blindly repeating a GPU submission. A separate click after acceptance receives a fresh identity. Synchronous guards prevent double taps and late responses cannot overwrite newer submission state.

Legacy H3 references use staged uploads and reuse verified completed copies of the same selected File. Partial transfers retain their upload identity and repeated final chunks acknowledge completed transfers. Studio references are checked by ID, hash and version. Expired login, network interruption, actual HTTP 413 and cancellation receive distinct messages. The main creation button provides submission recovery rather than requiring a small job Retry control.

The existing checkpoints, samplers, step counts, attention, LoRAs, GPU routing, media, permissions and qualification policy are unchanged. Existing clients without the recovery header retain their request contract.

## Verification and limitations

Recovery contracts cover concurrent clicks, lost responses, immutable replay, owner isolation, cancellation tombstones, reference expiry, native/browser lifecycle cleanup and successive Manual creation. Built-app and standalone mobile-sized browser checks exercise real auth, upload, reference and receipt APIs; generation/status fixtures avoid unnecessary GPU rendering.

Physical Android acceptance is separate from simulated native lifecycle and browser verification. If both a staged server copy and Android's local file access expire, references need selecting again. A process crash leaving an uncertain submission claim requires evidence-based reconciliation; it is never automatically reclaimed into a potentially duplicate generation. Initial Studio media-registration errors retain their explicit registration retry. Separate RefMod training is not changed.

## Promotion

Publication is separate from activation. Packages bind version, commit, build ID and content hashes. Activate the exact release on TEST before guarded PROD promotion. Activation preserves environment, existing accounts, databases, gallery mappings and content; waits for verified idle work; takes backups; and restores only the previous application if required, never stale database snapshots. Unfinished submission receipts must block activation. No worker restart, GPU reset or forced cancellation is part of this release.
