// CSS rules that broke the glass before (phase 7, lessons.md): the minifier keeps only the last of
// `backdrop-filter` / `-webkit-backdrop-filter` when the unprefixed one comes first, and Chromium ignores the prefixed
// one, so the sheet had no blur there. Write the prefixed declaration first, the unprefixed one right after it.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const SRC = path.join(import.meta.dirname, '../src');
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(svelte|css)$/.test(d.name) ? [path.join(dir, d.name)] : []));

describe('CSS lint', () => {
  test('backdrop-filter: prefixed declaration first, unprefixed right after it', () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // a declaration list on one line (tokens.css) is split at the semicolons
        const decls = line.split(';').map((d) => d.trim());
        decls.forEach((d, k) => {
          const next = k + 1 < decls.length && decls[k + 1] ? decls[k + 1] : (lines[i + 1] ?? '').trim();
          if (/^-webkit-backdrop-filter\s*:/.test(d) && !/^backdrop-filter\s*:/.test(next)) bad.push(`${path.relative(SRC, f)}:${i + 1} prefixed without unprefixed after it`);
          if (/^backdrop-filter\s*:/.test(d)) {
            const prev = k > 0 ? decls[k - 1] : (lines[i - 1] ?? '').trim();
            if (!/^-webkit-backdrop-filter\s*:/.test(prev)) bad.push(`${path.relative(SRC, f)}:${i + 1} unprefixed without the prefixed one before it`);
          }
        });
      });
    }
    expect(bad).toEqual([]);
  });
});
