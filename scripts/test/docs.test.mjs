// Docs check: the npm scripts named in the docs exist, and every npm script is in the README table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const scripts = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DOCS = ['README.md', 'docs/vercel.md', 'docs/iphone-guide.md'];

function mentioned(text) {
  return new Set([...text.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1]));
}

for (const file of DOCS) {
  test(`${file}: every "npm run X" is a script in package.json`, () => {
    for (const name of mentioned(read(file))) assert.ok(scripts.includes(name), `${file} mentions "npm run ${name}", which does not exist`);
  });
}

test('README: every npm script is in the scripts table', () => {
  const readme = read('README.md');
  const table = readme.slice(readme.indexOf('## npm scripts'), readme.indexOf('## Online and offline mode'));
  const listed = new Set([...table.matchAll(/^\| `npm (?:run )?([a-z][a-z0-9:-]*)`/gm)].map((m) => m[1]));
  for (const name of scripts) assert.ok(listed.has(name), `script "${name}" is missing in the README table`);
  for (const name of listed) assert.ok(scripts.includes(name), `README table lists "${name}", which does not exist`);
});

test('README does not mention the removed planner/ folder', () => {
  assert.doesNotMatch(read('README.md'), /\bplanner\/(server|app|search|graph)|npm run planner\b/);
});

test('iphone guide links the test checklists, and they exist', () => {
  const guide = read('docs/iphone-guide.md');
  for (const n of [5, 6, 7]) {
    const f = `docs/agents/iphone-test-phase${n}.md`;
    assert.ok(guide.includes(f), `guide must link ${f}`);
    assert.ok(fs.existsSync(path.join(ROOT, f)));
  }
});
