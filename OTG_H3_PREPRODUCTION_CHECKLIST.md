# OTG H3 Production Reference Upgrade

## Phase A - Pre-Production

- [x] PP-01 Lock H3 technical baseline
- [x] PP-02 Character Card vs individual-view benchmark
- [x] PP-03 Character Reference Pack audit
- [x] PP-04 Background Reference Pack audit
- [x] PP-05 Asset Reference Pack audit
- [ ] PP-06 Gallery reliability closure
- [ ] PP-07 Canonical Entity Pack contract
- [ ] PP-08 Pre-Production acceptance test

## Phase B - Production

- [ ] PR-01 Extend Production entity snapshots
- [ ] PR-02 Build Reference Resolver V2
- [ ] PR-03 Multi-character support
- [ ] PR-04 Voice binding
- [ ] PR-05 R2V prompting upgrade
- [ ] PR-06 H3 R2V workflow adapter
- [ ] PR-07 I2V Scene Starting Frame
- [ ] PR-08 Production UI simplification
- [ ] PR-09 Fingerprint / stale-prompt protection
- [ ] PR-10 Production contract tests
- [ ] PR-11 TEST acceptance
- [ ] PR-12 PROD readiness review

## Locked design goals

- Best practical H3 quality.
- Lowest practical generation time.
- Simple entity-based UI.
- No normal-user angle management.
- One visible Character/Background/Asset entry with hidden reference packs.
- H3 native generation remains 1024x576 at 24 fps unless later benchmark evidence justifies a change.
- H3 R2V normally uses ref_image_size=match.
- Up to 9 visual image references.
- Up to 3 speaking Character voice references.
- One stable Subject per entity.
- Multiple Pictures may define one Subject when justified.
- I2V uses one finished 1024x576 scene starting frame.
- R2V uses the smallest useful automatically resolved image-reference set.
- No reference is silently dropped or reassigned.
- TEST must pass before any PROD deployment.

## PP-02 Locked Character R2V Policy

Benchmark result on local RTX 3090:

- Character Card: 134.4s
- Front only: 134.1s
- Front + Side: 148.5s
- Front + Side + Back: 160.1s
- Visual review: all four outputs appeared effectively the same.

Production policy:

- Default MiniMax H3 R2V Character reference = one Character Card per Character.
- Do not routinely send separate Front/Side/Back images to H3.
- Preserve individual canonical Character views inside the Character Pack.
- Individual views remain available for image composition, editing, future models, diagnostics, or explicitly proven special cases.
- One Character Card consumes one H3 Picture slot.
- This policy maximizes reference-slot efficiency and avoids unnecessary R2V compute.

## PP-03 Character Pack Audit Result

- 8 completed Character Packs audited.
- 8/8 visual packs passed.
- Every pack contains a valid 1080x1920 Character Card.
- Every pack contains valid Front, Back, Left Profile, and Right Profile references.
- 6 Characters have saved voice references and all 6 files are valid.
- Characters without voices remain valid silent Characters.
- Default H3 R2V policy is one Character Card per selected Character.

## PP-04 Background Pack Audit Result

- Current TEST Background records: 52.
- Production-ready complete six-view packs: 1.
- Legacy Backgrounds with a valid Master but incomplete canonical views: 1.
- Broken legacy Backgrounds with no usable Master: 50.
- Production V2 now receives only production-ready Backgrounds.
- Needs-upgrade Backgrounds remain preserved but are excluded from Production.
- Broken Background JSON records remain preserved on disk but are hidden from normal Background selection.
- No legacy Background was automatically deleted.
- No missing angle pack was automatically regenerated.
- Canonical Production views remain Front, Back, Left, Right, Up, and Down.

## PP-05 Asset Pack Audit Result

- Real TEST Asset Pack created through the application's saveAsset() store.
- Saved Asset records: 1.
- Passing Asset Packs: 1.
- Broken default images: 0.
- Remote-only default images: 0.
- Broken optional perspectives: 0.
- Canonical Asset default/master image is mandatory.
- Asset perspectives remain optional and are not fabricated when no verified alternate view exists.
- Krea2 candidate save-output persistence marker verified.
- Asset Edit uses Asset-specific object identity preservation instructions.
- Validation Asset record: /home/shawn-rochford/AI/runtime/test/data/assets/slrochford12308/pp05-sword-reference-pack.json.
