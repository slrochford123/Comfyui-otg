// Deterministic derivatives of the owner's official logo, never an AI replacement.
// Writes only TEST flavor Android resources and source web assets. No APK install.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'public/Brand/slr-icon.png');
const res = path.join(root, 'android/app/src/qa/res');
async function icon(size, inset, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const artSize = Math.round(size * inset);
  const art = await sharp(source).resize(artSize, artSize, { fit: 'contain' }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#160c32' } }).composite([{ input: art, gravity: 'centre' }]).png().toFile(target);
}
async function main() {
  for (const size of [192, 512]) {
    await icon(size, .94, path.join(root, `public/icon-${size}.png`));
    await icon(size, .56, path.join(root, `public/icon-${size}-maskable.png`));
  }
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    for (const name of ['ic_launcher', 'ic_launcher_round']) await icon(size, .94, path.join(res, `mipmap-${density}/${name}.png`));
    await icon(Math.round(size * 2.25), .56, path.join(res, `mipmap-${density}/ic_launcher_foreground.png`));
  }
  const { data, info } = await sharp(source).resize(96, 96).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const rgb = [data[i], data[i+1], data[i+2]], low = Math.min(...rgb), high = Math.max(...rgb);
    const x = (i / 4) % info.width, y = Math.floor(i / 4 / info.width);
    const foreground = x >= 12 && x <= 84 && y >= 25 && y <= 67 && low > 155 && high - low < 95 && data[i+3] > 128;
    data[i] = data[i+1] = data[i+2] = 255; data[i+3] = foreground ? 255 : 0;
  }
  fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().extend({ top: 4, bottom: 4, left: 4, right: 4, background: '#00000000' }).resize(96, 96, { fit: 'contain', background: '#00000000' }).png().toFile(path.join(res, 'drawable/ic_stat_slr.png'));
  await icon(256, .94, path.join(res, 'drawable/slr_notification_large.png'));
  await icon(288, .80, path.join(res, 'drawable/slr_splash_logo.png'));
  console.log('Generated official SLR web icons and TEST-only native resources.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
