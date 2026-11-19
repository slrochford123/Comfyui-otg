# H3 character tools and private media integration

H3 generates native dialogue and environmental audio by default. Saved character images and visual-only conditioning retain appearance; saved voices are suggested for optional post-generation Change Voice.

The existing H3 interface adds Snapshot Edit Frame through the installed Fibo Turbo pipeline, Choose Character in the Reference Deck, shared Change Voice with scene matching and cue-level fine-tuning, and eligible H3/LTX Text-to-Video character extraction. NSFW shares the H3 controls and has private user/admin Gallery collections.

Production uses separate `OTG_H3_CHARACTER_DEVELOPMENT_ENABLED` and `OTG_H3_CHANGE_VOICE_ENABLED` deployment switches. The existing administrator checks remain in force for extraction and voice correction. These flags do not enable Testing routes. The release-local bootstrap reuses installed inference executables and model artifacts; user data, outputs, sessions and Gallery records remain under the production roots. No TEST account data or media is migrated.

The character-development sequence supports a basic saved image, a reviewed reconstructed default, five separately approved views, a stitched sheet, and an optional visual RefMod and saved voice. Identity reconstruction and conversion quality still require listening/visual review.

Level, Distance and Room/Echo changes rebuild from saved converted takes without another conversion. Originals remain available. Unsafe overlaps or unreliable isolation retain the original interval.

Unsupported checkpoint/mode combinations remain disabled. An offline graph or a visible control is not model qualification. Imported audio requires explicit Advanced opt-in; combined RefMods cannot silently contribute audio in the native-audio flow.

Verification includes TypeScript, a full standalone build, focused regressions, CPU audio/graph fixtures, authenticated phone/desktop browser flows, account and NSFW permission checks, preview save/reopen, and rollback checks. No GPU inference or paid calls are part of this promotion.

Deployment must retain the previous immutable production release, configuration snapshots and SQLite backups, check the existing drain/admission guards, verify PID/cwd plus local/public health, and restore the previous code/configuration on critical failure. Routine code rollback must not restore old user databases or remove new user media.
