// Browser-safe presentation only. Model paths and worker configuration stay server-side.
export const LTX_STUDIO_LABELS = {
 "alpha-gen":"Alpha Gen",ingredients:"Ingredients",colorization:"Colorization","slow-motion-control":"Slow Motion Control",cinemagraph:"Cinemagraph","clean-plate":"Clean Plate","day-to-night":"Day-to-Night","water-simulation":"Water Simulation",decompression:"Decompression",deblur:"Deblur",restore:"Restore","refine-details":"Refine Details","sdr-to-hdr":"SDR-to-HDR","layout-to-render":"Layout-to-Render",
} as const;
export const LTX_STUDIO_HELP:Partial<Record<keyof typeof LTX_STUDIO_LABELS,string>>={
 "sdr-to-hdr":"Convert SDR through ACEScct conditioning and fixed scene embeddings. Outputs an Android SDR preview, a real BT.2020 HLG 10-bit master, and an ACEScg half-float EXR archive. No text prompt is used.",
 "layout-to-render":"Supply a layout video and a separate finished look image. The official two-stage 8+3 step recipe keeps the layout at frame 0 and look reference at frame -1 on both stages. Describe the finished shot; output dimensions are twice the selected base dimensions.",
 cinemagraph:"Animate one detail in a locked-off still image. Begin with CINEMAGRAPH_MOTION, identify everything that stays frozen, then describe one moving detail and a seamless natural loop.",
 "clean-plate":"Reconstruct an empty background from a video. Describe the desired empty scene and the people or vehicles excluded; no trigger word is needed.",
 "day-to-night":"Keep the source shot and motion unchanged. Describe only the nighttime lighting, ambient darkness and practical lights; outdoor daylight sources work best.",
 "water-simulation":"Describe the dry reference, then the same shot with water. Include ADD WATER and specify the water type and motion. This bounded preview uses one native-resolution stage.",
 decompression:"Use low-bitrate video with compression artifacts. Describe the reference and clean edited scene with ENHANCE QUALITY. This does not repair defocus or upscale.",
 deblur:"Use genuinely defocused video. Describe the source and sharp edited scene with DEBLUR. This is not motion-blur repair or super-resolution.",
 restore:"Restore progressive archive footage in natural color. Describe period, materials and lighting. Preserve aspect ratio; deinterlace first. Maximum 97 frames per window.",
 "refine-details":"Use a soft or compressed delivery clip. Describe sharpness, texture, grain and light without changing its subjects. Source is resized with Lanczos to the chosen output size.",
};
