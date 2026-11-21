// Renders every app icon from the one logo, app/public/logo.svg (taken over from the ios-app-test branch):
//
//   app/public/favicon-32.png          browser tab (fallback for browsers without SVG favicons)
//   app/public/apple-touch-icon.png    180×180, the iPhone home screen icon
//   app/public/icon-192.png            web app manifest, "any"
//   app/public/icon-512.png            web app manifest, "any"
//   app/public/icon-maskable-512.png   web app manifest, "maskable" (Android crops it to a circle or squircle)
//
//   npm run icons
//
// iOS rounds the corners of home-screen icons itself, so the apple-touch-icon gets a full-bleed square background
// without the logo's rounded corners and light rim. The maskable icon also has a full-bleed background, and the
// drawing is made smaller so it stays inside the safe circle (80 % of the size).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'app/public');
const LOGO = path.join(PUBLIC, 'logo.svg');
const BACKGROUND = '#0c0f14'; // bottom colour of the logo gradient
const MASKABLE_SCALE = 0.72;

/** The logo variants as SVG text. Exported for the test. */
export function logoVariants(logo) {
  const fullBleed = logo
    .replace(/<rect width="512" height="512" rx="114"/, '<rect width="512" height="512"')
    .replace(/\s*<rect x="4" y="4"[^>]*\/>/, '');
  if (fullBleed === logo || /rx="11[04]"/.test(fullBleed)) {
    throw new Error('logo.svg changed: update the full-bleed replacements in scripts/icons.mjs');
  }
  // maskable: everything after the background rect goes into a group scaled around the centre
  const bg = fullBleed.indexOf('<rect width="512" height="512"');
  const bgEnd = fullBleed.indexOf('/>', bg) + 2;
  const end = fullBleed.lastIndexOf('</svg>');
  const t = `translate(256 256) scale(${MASKABLE_SCALE}) translate(-256 -256)`;
  const maskable = `${fullBleed.slice(0, bgEnd)}\n  <g transform="${t}">${fullBleed.slice(bgEnd, end)}</g>\n</svg>\n`;
  return { logo, fullBleed, maskable };
}

export const ICONS = [
  { file: 'favicon-32.png', size: 32, variant: 'logo', opaque: false },
  { file: 'apple-touch-icon.png', size: 180, variant: 'fullBleed', opaque: true },
  { file: 'icon-192.png', size: 192, variant: 'logo', opaque: false },
  { file: 'icon-512.png', size: 512, variant: 'logo', opaque: false },
  { file: 'icon-maskable-512.png', size: 512, variant: 'maskable', opaque: true },
];

async function render(svg, size, file, { opaque = false } = {}) {
  // render at the target resolution (SVG density is in dpi; the logo is 512 px at 72 dpi)
  let image = sharp(Buffer.from(svg), { density: (72 * size) / 512 }).resize(size, size);
  if (opaque) image = image.flatten({ background: BACKGROUND }).removeAlpha();
  await image.png().toFile(file);
  console.log(`${path.relative(ROOT, file)} (${size}×${size})`);
}

if (import.meta.main) {
  const variants = logoVariants(fs.readFileSync(LOGO, 'utf8'));
  for (const icon of ICONS) await render(variants[icon.variant], icon.size, path.join(PUBLIC, icon.file), { opaque: icon.opaque });
}
