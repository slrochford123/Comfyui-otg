# Owner-facing SLR Studios build tracking

This release is **Build 2**. The owner-facing build label is separate from the application package's existing semantic version and immutable Git tags. Labels are strings, preserving two-digit updates such as `2.01` rather than rounding them as decimal numbers. The exact future numbering sequence remains an owner choice; the release tool requires an explicit new value.

## Settings

The bottom of Settings shows `SLR Studios · Build 2`. Its expandable release details show the immutable packaged Git revision/release name when present, plus recorded build history. The label remains available offline. The authenticated `/api/app/build` endpoint is private/no-store and returns only an explicit public identity allowlist; no environment values, secrets or disk paths are serialized.

`config/build-history.json` is append-only source history. A new entry records its label, date, concise summary and source base commit. The package's `RELEASE_PROVENANCE.json` then binds the build label to the exact final Git commit, release name, build time and build artifacts. Self-referential commit hashes are not stored in the commit that they identify. Runtime metadata with a different build label is ignored.

## Recording a future update

After choosing the next label, run in the source checkout:

```sh
node scripts/release/record-build.cjs --record --version 2.01 --summary "Concise update summary"
```

The example label is explicit, not an automatic upgrade. The tool refuses duplicate/older numeric labels, ambiguous fractional digits and symlinked history files. It only appends source history; it does not build, publish or deploy. Commit the update, validate/build that source, and package the exact Git revision with matching `buildVersion` metadata. Rollback switches to an older immutable application package; its own label and commit should then appear in Settings. Never rewrite history or overwrite existing Git tags to simulate rollback.

## Deployment separation

This feature does not change H3 owner permissions, qualification evidence or environment gates. It does not apply the separately staged transcription repair. Neither GitHub publication nor this document authorizes a live activation command without a complete reviewed package/rollback transaction.
