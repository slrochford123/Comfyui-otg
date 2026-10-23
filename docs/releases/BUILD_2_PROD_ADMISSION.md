# Build 2: ordinary PROD H3 Studio generation

Build 2 is the owner-facing release identity. Subsequent updates use the strings
2.01, 2.02 and so on. Software tags v2.0.0 and v2.0.1 remain immutable.

PROD Auto, Manual and simple Edit Video use the existing authenticated H3 direct
engine, pinned to RTX 3090. Create Video starts one local generation. PROD does
not read TEST qualification, experimental permission or local inventory-receipt
files. It does not need a local mount of the remote render host's model library.
No acceptance checkbox, measurement or physical qualification record is required
for ordinary PROD content creation. Optional plan inspection remains available.

The server still validates exact authorized references and their content, strict
workflow settings, canonical LoRA policy, exact loader filenames and nodes from
the 3090 worker, live GPU identity, concurrency and cancellation. A server-created
single-use execution receipt protects against stale graphs; it is not a user
approval or a qualification certificate. Unknown deployment environments remain
disabled. The qualification harness and experimental permission remain TEST-only.

Installed Stage 1C definitions are versioned source metadata, not user data,
permissions or qualification evidence. Existing Admin catalog settings override
defaults, including disabled entries. Absent files cannot execute. Acceleration
adapters are used only by their matching profile, not as optional style LoRAs.
Unavailable Civitai versions remain unavailable. No output-quality testing is
claimed by this release.

The optional paid OpenAI Director retains quotation, budget and explicit API-call
and external-media-sharing consent. Local Create Video never calls it implicitly.
Its strict registered capability schema is retained; no arbitrary graphs, paths
or model names are accepted. See the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

Deployment must retain all PROD environment, secrets, users, databases and media,
use Node 22.23.4 and a fresh protected backup, rehearse additive migrations, verify
the final systemd ExecStart and live process executable, and retain the old release.
Application rollback must never restore stale databases over subsequent activity.
The final immutable SHA and artifact hash are recorded outside the commit in the
release provenance and owner activation transaction.
