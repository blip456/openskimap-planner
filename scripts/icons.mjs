// Renders every app icon from the one logo, planner/public/logo.svg:
//
//   planner/public/favicon-32.png         browser tab (fallback for browsers without SVG favicons)
//   planner/public/apple-touch-icon.png   180×180, when the web planner is added to an iPhone home screen
//   ios/…/AppIcon.appiconset/AppIcon.png  1024×1024 iOS app icon
//
//   npm run icons
//
// iOS rounds the corners of home-screen icons itself, so those two get a full-bleed square background
// without the logo's rounded corners and light rim.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'planner/public');
const LOGO = path.join(PUBLIC, 'logo.svg');
const IOS_ICON = path.join(ROOT, 'ios/OpenSkiPlanner/Assets.xcassets/AppIcon.appiconset/AppIcon.png');
const BACKGROUND = '#0c0f14'; // bottom colour of the logo gradient

const logo = fs.readFileSync(LOGO, 'utf8');
const fullBleed = logo
  .replace(/<rect width="512" height="512" rx="114"/, '<rect width="512" height="512"')
  .replace(/\s*<rect x="4" y="4"[^>]*\/>/, '');
if (fullBleed === logo || /rx="11[04]"/.test(fullBleed)) {
  throw new Error('logo.svg changed: update the full-bleed replacements in scripts/icons.mjs');
}

async function render(svg, size, file, { opaque = false } = {}) {
  // render at the target resolution (SVG density is in dpi; the logo is 512 px at 72 dpi)
  let image = sharp(Buffer.from(svg), { density: (72 * size) / 512 }).resize(size, size);
  if (opaque) image = image.flatten({ background: BACKGROUND }).removeAlpha();
  await image.png().toFile(file);
  console.log(`${path.relative(ROOT, file)} (${size}×${size})`);
}

await render(logo, 32, path.join(PUBLIC, 'favicon-32.png'));
await render(fullBleed, 180, path.join(PUBLIC, 'apple-touch-icon.png'), { opaque: true });
await render(fullBleed, 1024, IOS_ICON, { opaque: true });
