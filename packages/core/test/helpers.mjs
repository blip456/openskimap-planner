// Shared helpers for the core tests.
import fs from 'node:fs';
import path from 'node:path';

export const FIXTURE = path.join(import.meta.dirname, 'fixtures/mini-resort.json');
export const loadFixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// Real resort data from `npm run build` (not in git). PLANNER_DATA can point to another resort file.
export const REAL_DATA = process.env.PLANNER_DATA ?? path.resolve(import.meta.dirname, '../../../build/planner/oberstdorf-kleinwalsertal.json');
export const realDataSkip = fs.existsSync(REAL_DATA)
  ? false
  : `real data not found (${REAL_DATA}); run \`npm run build\` first. Golden tests skipped.`;
export const loadRealData = () => JSON.parse(fs.readFileSync(REAL_DATA, 'utf8'));

// Small seeded random generator (mulberry32), so the golden cases are the same on every run.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Run fn and return its result, or the error (class name + message) it threw.
export function outcome(fn) {
  try {
    return { ok: fn() };
  } catch (err) {
    return { error: `${err.constructor.name}: ${err.message}` };
  }
}
