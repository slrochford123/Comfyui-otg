# H3 Phase 3 model batches and TEST recovery packaging

Generated offline by `scripts/h3-studio/model-batches.cjs --write-docs`; do not edit the generated JSON/Markdown by hand.

Inventory and provenance snapshot: **2026-10-23T11:02:24.454Z**. This is historical filename/byte metadata, not current worker state or physical qualification.

Retained decisions: 60 SELECT, 4 MAYBE, 76 SKIP, 13 UNDECIDED (153 unique versions). Proposal: **53 unique downloads / 15200132452 declared bytes**, plus **one PBR transfer / 155110376 bytes** from 5060 Ti to 3090. Seven distinct selected versions were located across the two workers.

SELECT is a retained owner choice, not a download, license, hash, installation or runtime grant. Permission flags and the owner attestation do not grant all licenses or establish upstream rights. Every entry requires its own review, including dependencies. MAYBE/SKIP/UNDECIDED are not an install queue; SKIP never authorizes removal.

All rows below have rights status `review-required`, local hash status `unverified`, runtime qualification `false`, and execution approval `false`. The JSON preserves each exact permission flag, declared source SHA256, all upstream files, worker filename matches and original non-SELECT decisions. Alternate files/training ZIPs are metadata only; each download proposes exactly the upstream primary safetensors file.

## Category batches

| Batch | Owner category | Unique downloads | Declared bytes |
|---|---|---:|---:|
| category-01 | Anime & 2D Animation | 5 | 1230906840 |
| category-02 | 3D Animation & CGI | 2 | 608430504 |
| category-03 | Cinematic Styles | 5 | 1105177656 |
| category-04 | Photorealism | 1 | 596450960 |
| category-05 | Camera Movement & Editing | 6 | 996273552 |
| category-06 | Human Motion | 8 | 1025661956 |
| category-07 | Combat & Action | 2 | 406916944 |
| category-08 | Vehicles & Chase Sequences | 0 | 0 |
| category-09 | Superpowers & Visual Effects | 2 | 1315089328 |
| category-10 | Fantasy & Science Fiction | 3 | 1055785464 |
| category-11 | Character Consistency & Anatomy | 4 | 984223560 |
| category-12 | Quality Repair & Enhancement | 2 | 745616856 |
| category-13 | Speed & Performance Optimization | 1 | 1956193000 |
| category-14 | Horror & Specialized Genres | 4 | 1002142160 |
| category-15 | Artistic & Experimental Styles | 7 | 1861093600 |
| category-16 | Environment & World Styles | 1 | 310170072 |

Batch numbers retain all 16 owner review categories. Each version appears in one owner category download batch; cross-listed selections remain in JSON. Category 8 has no new download: Extreme Enduro remains in Category 5. Empty categories introduce no download. Run batches sequentially only after separate approval, fresh storage checks, conflict resolution, license review and authorized hash verification. Reserve batch-sized temporary space plus 20 GiB operational headroom; count shared NFS capacity once.

## 53 proposed downloads (no execution)

| Category / model | Exact Civitai version | Upstream primary filename | Declared bytes | Declared SHA256 |
|---|---|---|---:|---|
| Anime & 2D Animation / [MMH3] Cel Shading Style | [3360700](https://civitai.com/models/2966038?modelVersionId=3360700) | MMH3-CelShadingStyle-V1.safetensors | 37856312 | `4887170FD9BCEFCA4B05EDF9E27FD3694A94D2D2D93BC686970D1597FA0E8532` |
| Anime & 2D Animation / Environmental Anime Style Mix (Makoto Shinkai) - H3 / LTX 2.3 | [3302128](https://civitai.com/models/2650155?modelVersionId=3302128) | YOURNAME_H3_V1-step00009900.safetensors | 298262032 | `19A7525A482F770668A7517C2D176B143998E6AC76AD10F887A61E99B75BB4E6` |
| Anime & 2D Animation / Cyberpunk Edgerunners Style Lora - H3 / LTX 2.3 | [3392712](https://civitai.com/models/2634377?modelVersionId=3392712) | EDGERUNNERS_H3_V1-step00001950.safetensors | 298263824 | `AB18826E69E586A6AF362ED3878DFD7525E8C3249CD237D1076CA489449D07CB` |
| Anime & 2D Animation / Retro 90's Anime / Golden Boy Style Lora - H3 | [3290242](https://civitai.com/models/2909069?modelVersionId=3290242) | GOLDENBOY_H3_V1-step00012000.safetensors | 298260856 | `E7DF606C27F5CB6276ACF07CB7DFBB217F759FCE5A678B36D36F9AB336AD01ED` |
| Anime & 2D Animation / Re:Zero Anime Style / Character Lora - H3 | [3398520](https://civitai.com/models/2949009?modelVersionId=3398520) | REZERO_H3_V3-step00002250.safetensors | 298263816 | `ED30172AFCF776A779836AFC46BD5BF4DE10A486B830626910FA9A11E3611D77` |
| 3D Animation & CGI / Clanimated | [3360728](https://civitai.com/models/2966062?modelVersionId=3360728) | YPQB863YC0APF30PQH1Q3327K0.safetensors | 310170080 | `4EAB4F3C3525BB7C3138B3CED33DD4B41E2C73AB03CDEA679CA9C61592071C53` |
| 3D Animation & CGI / 3D Animation Style | [3361017](https://civitai.com/models/2895989?modelVersionId=3361017) | 3dsrx_minimax_h3.safetensors | 298260424 | `28B56D2240990436FBA8D9A1FA06310C971A7EF95D3046059118445E0C0A4EF0` |
| Cinematic Styles / [MMH3] Afterlight | [3364782](https://civitai.com/models/2969395?modelVersionId=3364782) | MMH3-AfterlightStyle-V1.safetensors | 103241096 | `00AE8742481F9A5DF914BC603D1ADCAB764048333ADB32FB725933438EB0B60E` |
| Cinematic Styles / Minimax H3 Authentic cinematic texture | [3267949](https://civitai.com/models/2890588?modelVersionId=3267949) | Minimax H3真实电影质感.safetensors | 309965208 | `51DDA79218EA126CBB2E08F3A6D9CC595E2224F4977D7618061954043A8BAFCF` |
| Cinematic Styles / Chiaroscuro Lighting Style | [3361782](https://civitai.com/models/2750529?modelVersionId=3361782) | MM-H3 - Chiaroscuro Lighting.safetensors | 71632504 | `F965067C99AE254A8926EF55C5A3CD3C66261934467B9290FBCD11DCC7229E66` |
| Cinematic Styles / Film Noir Movie with optional selective colors | [3321880](https://civitai.com/models/2934763?modelVersionId=3321880) | Minimax-h3-film-noir.safetensors | 310168768 | `1D1A4EA88B606BD0F6E0CE91F157C47CFDB32DE14BDFAB490138105A26E8FA00` |
| Cinematic Styles / Nostalgic Cinema | [3362035](https://civitai.com/models/2143490?modelVersionId=3362035) | retro_minimaxh3_3361247_epoch_10.safetensors | 310170080 | `83CE18886426DBE60EEC89D96748A58EFD93C9C0F416C61E0BA571D4912489EC` |
| Photorealism / Minimax H3 Photorealistic Image Generator (LORA + Workflow) | [3260165](https://civitai.com/models/2884206?modelVersionId=3260165) | h3_photoreal_ph0t0r34l_1024-step00003780.safetensors | 596450960 | `446F508A699A0DFE53EC97367EB52E802A88643ABEC6FB1BC63A5A5B93B7747D` |
| Camera Movement & Editing / Shaky, handheld camera | [3343481](https://civitai.com/models/2592748?modelVersionId=3343481) | handheld_h3_100.safetensors | 77580048 | `D56360BC9DE18ABEC4298518ED630167EE4A3F64A7DBBC8BC0C2259D33F74069` |
| Camera Movement & Editing / Crash Zoom \| Minimax H3 **CONFLICT HOLD** | [3294020](https://civitai.com/models/2912041?modelVersionId=3294020) | 7Q8XQ01KW0HZ1Q97N543ZVZ1J0.safetensors | 310170000 | `E02937650C695E803F0952A03ECB9D86605074E9E7C7139B2611295B89AC991C` |
| Camera Movement & Editing / Headmounted camera / Headbob | [3357779](https://civitai.com/models/2838538?modelVersionId=3357779) | fpv_headbob_h3_50.safetensors | 77580048 | `EABADE655732836B339E25C9BB9101967E36FEBFF9ADA6541FA54BB2593B6AC2` |
| Camera Movement & Editing / Drone Shot | [3226987](https://civitai.com/models/2857065?modelVersionId=3226987) | dr0nesh0t_aerial_flyover_000000500.safetensors | 155110312 | `88CACEA2D32B7B453382D7C892EC2EA73BC245BD0E13176E84880CF40CAFD7FB` |
| Camera Movement & Editing / MMH3 - Locked Stabilization (Camera locked to target) | [3372549](https://civitai.com/models/2975645?modelVersionId=3372549) | MMH3-LOCKSTAB-MORE.safetensors | 65663080 | `D77E1746407C8F00DFCF70755318DB992711A2D4CC10EA7FD76904EDDED31F53` |
| Camera Movement & Editing / Extreme Enduro - Better Bike POVs and Motion **CONFLICT HOLD** | [3390388](https://civitai.com/models/2989996?modelVersionId=3390388) | YM79198DCX3K8X5GENDPWJBTK0.safetensors | 310170064 | `B47F9B0640679690D7466B8DEBD6D9392A250BAB77EF575000A14A43276597E3` |
| Human Motion / Motion-Speed-MMH3-SLIDER | [3389300](https://civitai.com/models/2985458?modelVersionId=3389300) | motion_speed_slider_mmh3_v1.1.safetensors | 187384 | `E5970E97F8A5AA69E3DDC8D2EC4018E6C493CF8C7D0F1F1AA5C17D16E01270B1` |
| Human Motion / Dramatic Implied Movement Style \| MH3 + Anima + Flux + Pony + ILL | [3386211](https://civitai.com/models/897102?modelVersionId=3386211) | TeeKaysMisc_DramaticImpliedMovementStyle_MH3.safetensors | 310170080 | `BE1D258587AE38F7B8A392DF0851830E8B3E8D8F48E9AD23119EF6436F34B866` |
| Human Motion / Better Human Motion Minimax H3 | [3256084](https://civitai.com/models/2734359?modelVersionId=3256084) | mvmt_h3_lora_v1_500.safetensors | 310168816 | `285F9ED3FBB735C3625FCA0D22166C7450AD7ACB552A869FCBBD8E86E79D1F4C` |
| Human Motion / Acceleration Slider MMH3: Rapid changes in movement speed | [3391949](https://civitai.com/models/2991220?modelVersionId=3391949) | acceleration_slider_v1.0.safetensors | 562008 | `F46E5126A6B3FD09879BE45E8F02F7CE9A30BD137795DE2A58E0EE2CB2B67022` |
| Human Motion / Progressive Acceleration MMH3 Slider: Smoothly accelerates the speed of any action or motion over time. | [3395787](https://civitai.com/models/2994324?modelVersionId=3395787) | progressive_acceleration_slider_v1.0.safetensors | 9741320 | `24EEDB8F53FF632C179D5359B05B3D2657FF3416843D6D89DCC37ECDC4C21334` |
| Human Motion / ✦ Motion speed slider for H3 MiniMax - by FoS 🪵🐸🪵 | [3342524](https://civitai.com/models/2951265?modelVersionId=3342524) | H3_speed_slider_1.1.safetensors | 10093356 | `593B074E8EB17BF9F858C3586FC12F53038DBFDD9634E146FE34A17E2661CA40` |
| Human Motion / Zombie Walk | [3346908](https://civitai.com/models/2815485?modelVersionId=3346908) | zombie_walk_h3_550.safetensors | 310168376 | `FF76E64E5C428E959C3E63532E7026A6A26CA3E5AE9D6FF1929D099CB1D1B0C8` |
| Human Motion / FrameRush | [3301234](https://civitai.com/models/2868380?modelVersionId=3301234) | FrameRush-Minimax-V2_c2-st1500.safetensors | 74570616 | `7B7CA90A9CE93BE810876E13A62717180D15DB7C2339699D6EA80A992B52A5E1` |
| Combat & Action / Minimax H3 Motion Combat Reasoning \| REF2VA \| FL2VA \| Hybrid | [3377709](https://civitai.com/models/2979777?modelVersionId=3377709) | DaSiWa-MMH3-Motion-Combat-Reasoning_r128.safetensors | 332346328 | `76E38D290668EEAF6282C38E7566A0B91CA863A9D011E379A58E351921D77D24` |
| Combat & Action / FrameRush | [3280337](https://civitai.com/models/2868380?modelVersionId=3280337) | FrameRush-MiniMax-H3_c1-st1300.safetensors | 74570616 | `9CA413AB272103D2AC76E28D58F29A83E3DECBCF99F9CF132F7B3D19EC19136F` |
| Superpowers & Visual Effects / VFX-Edit | [3346199](https://civitai.com/models/2954203?modelVersionId=3346199) | minimax_h3_vfx_edit_v1.0_r128_ffp.safetensors | 1240518720 | `995FABEAFA3626477092C3F9BAF30DEDEDBF18649B2A53E6FE26EE28F07396C8` |
| Superpowers & Visual Effects / RedCraft & Dark Beast LoRAs | [3378342](https://civitai.com/models/964312?modelVersionId=3378342) | H3 Exploded View Diagram AiMetatron.safetensors | 74570608 | `3C2C75BB0CA0431FCB280E08143C851D8A9BD2000CCDAE823281AD790D3B80B6` |
| Fantasy & Science Fiction / Minimax H3 Forgotten World's Retro Fantasy | [3388934](https://civitai.com/models/2988830?modelVersionId=3388934) | retro-fantasy-step00003750.safetensors | 596449424 | `48C13545A56900A9FCA39A95795B3971E0E01A75D2E8F61F1E9BD1DC98F2FB47` |
| Fantasy & Science Fiction / Space Worlds : Planets - MiniMax H3 | [3357677](https://civitai.com/models/2963584?modelVersionId=3357677) | SW_Planets_04_MinimaxH3.safetensors | 310170072 | `E6261C1076C432544C8E21528D040AB28D19B545DBADB11C7489306C33B6FF59` |
| Fantasy & Science Fiction / Cinematic Fantasy | [3350636](https://civitai.com/models/2957855?modelVersionId=3350636) | Cinematic_Fantasy_rank16_v1_H3-lora.safetensors | 149165968 | `225B50B1470F357C5311669BEF12DCE211B147CB98920323929EC2E2D8818D63` |
| Character Consistency & Anatomy / FaceSwap — MiniMax REF2VA | [3329609](https://civitai.com/models/2940916?modelVersionId=3329609) | SS_FaceSwap_MiniMax_H3_REF2VA.safetensors | 65623904 | `1E032CF519CC143F434E67516D8AD0AACF4C6E146315B2DCC3B1C2800470326D` |
| Character Consistency & Anatomy / Re:Zero V1 | [3339742](https://civitai.com/models/2949009?modelVersionId=3339742) | REZERO_H3_V1-step00015750.safetensors | 298262024 | `2469EE593DFA5AB3B39550243C1EB1833C5A604E28B84B13A550030A9562CE9B` |
| Character Consistency & Anatomy / Natural Face & Speech V2 | [3339123](https://civitai.com/models/2925394?modelVersionId=3339123) | nafasp_h3_lora_v2_500.safetensors | 310168816 | `40B1AF6134DDF8597E6B9BFED1B97FC782BAC6917E498F954EFFD34681AB881B` |
| Character Consistency & Anatomy / Natural Face & Speech V1 | [3310245](https://civitai.com/models/2925394?modelVersionId=3310245) | nafasp_lora_v1_500.safetensors | 310168816 | `74150D1D047FE8FB97C861CAFB887CE1D030B11055F50F91EB93A0B169DA297F` |
| Quality Repair & Enhancement / Restore Enhance Improve | [3389308](https://civitai.com/models/2989135?modelVersionId=3389308) | Restore_Enhance_Improve_rank16_v1_H3-lora.safetensors | 149165944 | `04068FCCC4F7C14C3F42D0C1DC1A408EB335FA9C31149D068174E702EAB47296` |
| Quality Repair & Enhancement / MiniMax H3 Image Upscaler | [3309188](https://civitai.com/models/2924512?modelVersionId=3309188) | h3_upscale_1920.safetensors | 596450912 | `41B9ABB979A492572916F748696CE2F12659A68FBB7DD2A21E1AF51E0258F22B` |
| Speed & Performance Optimization / LightX2V 4-Step 768p V1.2 | [3297123](https://civitai.com/models/2837571?modelVersionId=3297123) | minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors | 1956193000 | `C8168EBC17BBACC4296103DDA2FEC1BA85B24392FA08CF2BFBCEF0CFF0DC3CC8` |
| Horror & Specialized Genres / Strange Reverie | [3337665](https://civitai.com/models/2930675?modelVersionId=3337665) | Strange_Reverie_H3_minimaxh3_3332682_epoch_8.safetensors | 310170064 | `12A1FE5917EBB9341B98476413F2A47D6CAD02196F705AC30D20F4E687541767` |
| Horror & Specialized Genres / Something's Off | [3347985](https://civitai.com/models/2955672?modelVersionId=3347985) | H3_STYLE_Somethings_Off_-_by_FoS.safetensors | 310169552 | `7EEC29C85B0C02E41F1DCC6CE95AD341BB9320DA2F758ED8E5B99E258387D6CB` |
| Horror & Specialized Genres / Dark and Moody Lighting | [3354289](https://civitai.com/models/2960837?modelVersionId=3354289) | MM-H3 - Dark and Moody.safetensors | 71632480 | `6DF7CC37DDD2AFA0F6BC9D4512A092AD4277A907052711E4BC29E0ACD3FAEF12` |
| Horror & Specialized Genres / Dark Cinematic Video | [3363310](https://civitai.com/models/2771200?modelVersionId=3363310) | dark_video_h3_1_0.safetensors | 310170064 | `581C991CB630487A739B08F69A6CFF003659B93C8A522585B3CC3401D463246B` |
| Artistic & Experimental Styles / Golden Sun Style V2 | [3366127](https://civitai.com/models/2961726?modelVersionId=3366127) | _H3__Golden_Sun_Style_minimaxh3_3364911_epoch_18.safetensors | 310170064 | `0249032DFBA6012878E4A42DF3F8E9764A1833FDA73153798445EBACC9271BDA` |
| Artistic & Experimental Styles / Kyhu Artist Style | [3389642](https://civitai.com/models/1890171?modelVersionId=3389642) | KyhuStyle_h3_v2.safetensors | 310170072 | `781C7F7149006C1544311383DE9083C975563698C01E92EBD9A2396F788A7C41` |
| Artistic & Experimental Styles / Dark Life Style | [3355337](https://civitai.com/models/2961693?modelVersionId=3355337) | Dark_Life_Style__H3__minimaxh3_3350023_epoch_10.safetensors | 310170064 | `925178C4FEB25D361C4DC4A2A8DCA2D611C0F16AA788FCDFC77F9B7890CEA31F` |
| Artistic & Experimental Styles / Hyperdetailed Colored Pencil | [3398426](https://civitai.com/models/1155749?modelVersionId=3398426) | HyperDetailedPencil_H3.safetensors | 310170120 | `64B9A003DF0580680BF448A29BF3AF8A13B40E6CEAD7F2BC6F80B0A4C254B741` |
| Artistic & Experimental Styles / SumiInk | [3343890](https://civitai.com/models/2952303?modelVersionId=3343890) | SumiInk_h3_v2.safetensors | 155111584 | `80A18A354C66DCBEF5B80F1641386D969182BDC88180858EC5B6BACBFD3844DD` |
| Artistic & Experimental Styles / Dan Mora Chavez Style | [3290797](https://civitai.com/models/2793943?modelVersionId=3290797) | MM-H3 - Dan Mora Chavez Style.safetensors | 155131624 | `05BBC297503F976300F6A91591B26679EAB5A65E5516A7FF878D24DD5CC9FBAA` |
| Artistic & Experimental Styles / Disney Golden Age Style | [3380759](https://civitai.com/models/1913233?modelVersionId=3380759) | Disney Golden Age Animation_V1.safetensors | 310170072 | `A6CF45273DDB70E0E9F20DBC03A4F351B71C99D6832DD6B87AFD56C7CED837FE` |
| Environment & World Styles / Frozen World — Time-Freeze for MiniMax H3 **CONFLICT HOLD** | [3385432](https://civitai.com/models/2986051?modelVersionId=3385432) | V2GQDZF9WKA90BNNK5534QVDD0.safetensors | 310170072 | `3BA12E2509B842B3B16DE572B472F71FF9E853FDF88BAE842E3AC9C8F343FEFC` |

## One proposed PBR transfer (no execution)

| Category / model | Exact Civitai version | Upstream primary filename | Declared bytes | Declared SHA256 |
|---|---|---|---:|---|
| 3D Animation & CGI / Stylized PBR Animation [MiniMax H3 Ref2VA] | [3240881](https://civitai.com/models/2868582?modelVersionId=3240881) | MiniMaxH3_Ref2V_PBRStyle_v1.0.safetensors | 155110376 | `2E72EDAC3412A7B29C9A80B48463CCB642C3429D7B92C763D19CBA19AF58A4C2` |

## Seven located versions (listed, not hash verified)

| Category / model | Exact Civitai version | Upstream primary filename | Declared bytes | Declared SHA256 |
|---|---|---|---:|---|
| 3D Animation & CGI / Stylized PBR Animation [MiniMax H3 Ref2VA] | [3240881](https://civitai.com/models/2868582?modelVersionId=3240881) | MiniMaxH3_Ref2V_PBRStyle_v1.0.safetensors | 155110376 | `2E72EDAC3412A7B29C9A80B48463CCB642C3429D7B92C763D19CBA19AF58A4C2` |
| Photorealism / fal/MiniMax-H3-Realism-People-LoRA | [3395642](https://civitai.com/models/2994195?modelVersionId=3395642) | h3-realism-people-t2v-i2v-r2v.safetensors | 131229656 | `ACC529601D2DA117FB81179E76C56E488A3BEAB1171659D305F04FA3655B787E` |
| Human Motion / BUNNY General Motion Continuity Repair | [3366092](https://civitai.com/models/2890788?modelVersionId=3366092) | Motion_Repair_V2.safetensors | 155110272 | `EDFA0E2858CAEBA7BE9108883F61DA8525D3C58AF998C94AC7A449D9603D7574` |
| Human Motion / BUNNY General Motion Continuity Repair | [3268186](https://civitai.com/models/2890788?modelVersionId=3268186) | Motion_Repair.safetensors | 155110272 | `A678A3657CEFD5C2C2712F892DA2F71BE53C3F252E335557E918854F8ABC579F` |
| Speed & Performance Optimization / LightX2V 4-Step 768p V1.0 | [3219346](https://civitai.com/models/2837571?modelVersionId=3219346) | minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors | 1956192992 | `C396A9A06F58399E9DF9754B18299818D84A2DDD371724BA48FE4A41221437DC` |
| Speed & Performance Optimization / LightX2V 8-Step V1.0 | [3219337](https://civitai.com/models/2837571?modelVersionId=3219337) | minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors | 1956193000 | `2339ACDF19BFE123F46B971EA35D367A84ADB85DE43627E1ECEAFA5A5B2B111E` |
| Speed & Performance Optimization / LightX2V Ref2V 8-Step V1.0 | [3294126](https://civitai.com/models/2837571?modelVersionId=3294126) | minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors | 1956193000 | `6A56F41AB4229C9DD845B9501BBD475EE57E112D846CF2E819D534A1AE928C5A` |

## Three filename conflicts

| Version | Original ledger filename | Actual upstream primary filename |
|---|---|---|
| 3294020 | Crash_Zoom_MinimaxH3_v1.safetensors | 7Q8XQ01KW0HZ1Q97N543ZVZ1J0.safetensors |
| 3390388 | extremeEnduroBetterBike_v1.safetensors | YM79198DCX3K8X5GENDPWJBTK0.safetensors |
| 3385432 | FrozenWorld_v1.safetensors | V2GQDZF9WKA90BNNK5534QVDD0.safetensors |

Keep both names as evidence. No alias, rename, enablement or automatic resolution is authorized.

## TEST package helper: owner workflow after the main build

The default command only prints a plan. **Packaging has not been run.** The helper never builds, activates, restarts, downloads, reads/copies live data, or changes Git/app version 2.0.1. It pins Node 22.23.4 and rollback `test3001-h3-trim-admin-center-20261022T194500Z`.

For a future authorized build, after all agents finish source edits, record the complete source inputs BEFORE that build (including dirty and untracked source). Store the receipt outside source and outside runtime data/config. Then the owner runs the main build with Node 22.23.4. Source changes after the receipt require a new receipt and rebuild. The package command requires both that receipt and an explicit successful-build attestation:

```sh
NODE=/home/shawn-rochford/.nvm/versions/node/v22.23.4/bin/node
$NODE scripts/h3-studio/package-test-candidate.cjs
# Future owner steps only; not executed by this implementation:
$NODE scripts/h3-studio/package-test-candidate.cjs --record-build-inputs /absolute/research/build-inputs.json
# Owner completes the main build, then explicitly authorizes packaging.
$NODE scripts/h3-studio/package-test-candidate.cjs --package --build-complete --build-inputs /absolute/research/build-inputs.json --candidate test3001-h3-phase3-YYYYMMDDTHHMMSSZ
```

A new candidate is created exclusively under the TEST releases directory. Existing candidates, changed current/rollback links, wrong roots, runtime versions, data/env paths, stale/incomplete builds, secrets and external asset symlinks are refused. Required standalone, static, public, workflow, script, library and config assets are copied additively. A complete source manifest and recovery-source copy include dirty/untracked source, with explicit exclusions for Git internals, dependencies, build output, runtime data, secrets, model weights, caches and archives. Excluded paths carry reasons, never contents/hashes. TEST `.env.local` and `data` are symlinks only; no live data or secret values enter the package.

Native SQLite and Sharp are probed with Node 22.23.4 against the source dependencies and the completed candidate (in-memory SQLite and a 2x2 PNG only). Failed candidates retain `DO_NOT_ACTIVATE`; no cleanup, overwrite or retry into an old directory occurs. Source drift during copying invalidates the package.

The package copies the existing guarded `activate_test_release.py` and `systemd_runtime.py` into `owner-activation/`, with hashes and explicit forward/rollback instructions in `OWNER_TEST_ONLY.md`. These helpers are supplied for a separately authorized owner action; the packaging process never invokes them. The expected rollback is checked again before completing packaging. Packaging success is not activation or runtime acceptance.

Recovery baseline: `/home/shawn-rochford/AI/research/h3-phase3-20261023-y8YGow`, source SHA256 `9094bc05fc62621566c5b53886420a028c4577f0a8cdbfc25bdf7e2aeb613301`. No model-weight hashes were computed to generate this proposal.
