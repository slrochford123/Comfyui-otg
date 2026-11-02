// Mechanical Android resource derivatives of the existing, owner-approved logo.
// No new artwork, web deployment, signing, Play upload or APK installation.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const ROOT = path.resolve(__dirname, "../..");
const SOURCE = path.join(ROOT, "public/Brand/slr-icon.png");
const RES = path.join(ROOT, "android/app/src/main/res");
const DENSITIES = {mdpi:48, hdpi:72, xhdpi:96, xxhdpi:144, xxxhdpi:192};
const BACKGROUND = "#160c32";
async function renderIcon(size, fraction, transparent = false) {
  const artwork = await sharp(SOURCE).resize(Math.round(size * fraction), Math.round(size * fraction), {fit:"contain", background:"#00000000"}).png().toBuffer();
  return sharp({create:{width:size,height:size,channels:4,background:transparent ? "#00000000" : BACKGROUND}}).composite([{input:artwork,gravity:"centre"}]).png().toBuffer();
}
async function main() {
  for (const [density, size] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, "mipmap-" + density);
    fs.mkdirSync(dir, {recursive:true});
    const legacy = await renderIcon(size, .94);
    for (const name of ["ic_launcher", "ic_launcher_round"]) fs.writeFileSync(path.join(dir,name + ".png"),legacy);
    // 108dp canvas, logo inside 61dp: below Android's 66dp safe-zone maximum.
    fs.writeFileSync(path.join(dir,"ic_launcher_foreground.png"), await renderIcon(Math.round(size * 2.25), .56, true));
  }
  fs.writeFileSync(path.join(RES,"drawable/slr_splash_logo.png"),await renderIcon(288,.56,true));
  console.log("Generated production Android launcher and splash resources from the official purple SLR logo.");
}
if (require.main === module) main().catch(() => {console.error("SLR Android icon generation failed.");process.exitCode=1;});
module.exports = {DENSITIES, BACKGROUND, renderIcon};
