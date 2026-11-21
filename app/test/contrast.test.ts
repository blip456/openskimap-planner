// Text on glass must be readable over the map (phase 7): WCAG contrast ≥ 4.5:1 in light and dark, for the regular
// glass (map buttons, tab bar) and the strong glass (sheet at medium, search results). The glass colour is mixed
// with the map behind it. Two backdrops are checked: white snow, and a grey darker than any blurred map area we
// measured in the screenshots (darkest 10 px-blurred pixel of the Oberstdorf map: rgb(102, 110, 104)).
// The blur only averages the map, so a flat backdrop is the worst case.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

type Rgba = [number, number, number, number];

const css = fs.readFileSync(path.join(import.meta.dirname, '../src/ui/tokens.css'), 'utf8');

/** custom properties of the first block that starts with `start` (light :root or the dark media block) */
function block(start: string): Map<string, string> {
  const i = css.indexOf(start);
  if (i < 0) throw new Error(`no block ${start}`);
  const open = css.indexOf('{', css.indexOf(':root', i));
  const end = css.indexOf('}', open);
  const out = new Map<string, string>();
  for (const m of css.slice(open + 1, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

function parse(v: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((k) => parseInt(hex[1].slice(k, k + 2), 16)).concat(1) as Rgba;
  const rgba = /^rgba?\(([^)]+)\)/.exec(v);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
    return [r, g, b, a];
  }
  throw new Error(`cannot read colour ${v}`);
}

const lin = (c: number) => {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = ([r, g, b, a]: Rgba, [R, G, B]: number[]): number[] => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
export function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const BACKDROPS = { snow: [255, 255, 255], 'darkest map': [90, 90, 90] };
const themes = {
  light: block(':root {'),
  dark: (() => {
    const light = block(':root {');
    for (const [k, v] of block('@media (prefers-color-scheme: dark) {')) light.set(k, v);
    return light;
  })(),
};

describe('contrast of text on glass (WCAG AA, 4.5:1)', () => {
  for (const [theme, vars] of Object.entries(themes)) {
    for (const surface of ['--glass-fill', '--glass-fill-strong']) {
      for (const [where, backdrop] of Object.entries(BACKDROPS)) {
        test(`${theme}: ${surface} over ${where}`, () => {
          const glass = over(parse(vars.get(surface)!), backdrop);
          for (const text of ['--glass-label', '--glass-label-2', '--glass-accent']) {
            const fg = over(parse(vars.get(text)!), glass);
            expect(contrast(fg, glass), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
          }
        });
      }
    }
  }

  // solid surfaces (large sheet, panel, menu): text, accent buttons and destructive buttons on cells, the grouped
  // background and the grey capsule buttons (fill-3 on a cell); white on filled accent buttons
  for (const [theme, vars] of Object.entries(themes)) {
    test(`${theme}: text on solid surfaces`, () => {
      const cell = over(parse(vars.get('--bg-cell')!), [0, 0, 0]);
      const surfaces = {
        cell,
        grouped: over(parse(vars.get('--bg-grouped')!), [0, 0, 0]),
        'grey button': over(parse(vars.get('--fill-3')!), cell),
      };
      for (const [name, bg] of Object.entries(surfaces)) {
        for (const text of ['--label', '--label-2', '--accent', '--red', '--orange']) {
          expect(contrast(over(parse(vars.get(text)!), bg), bg), `${text} on ${name}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      const fill = over(parse(vars.get('--accent-fill')!), cell);
      expect(contrast([255, 255, 255], fill), 'white on --accent-fill').toBeGreaterThanOrEqual(4.5);
    });
  }

  test('the check catches too light text (iOS secondary label on glass fails)', () => {
    const glass = over(parse(themes.light.get('--glass-fill')!), BACKDROPS['darkest map']);
    expect(contrast(over(parse('rgba(60, 60, 67, 0.6)'), glass), glass)).toBeLessThan(4.5);
  });

  test('solid interface and increased contrast are opaque or nearly', () => {
    expect(css).toMatch(/:root\[data-solid\] \{\s*--glass-filter: none;/);
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\) \{\s*:root \{\s*--glass-filter: none;/);
    expect(css).toMatch(/@media \(prefers-contrast: more\) \{\s*:root \{\s*--glass-filter: none;/);
  });
});
