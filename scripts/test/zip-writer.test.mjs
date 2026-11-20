import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describeSources, writeZip } from '../lib/zip-writer.mjs';
import { crc32, readZipEntries } from '../../packages/core/src/index.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zipw-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const fileReader = (fh) => async (offset, length) => {
  const buf = new Uint8Array(length);
  const { bytesRead } = await fh.read(buf, 0, length, offset);
  return buf.subarray(0, bytesRead);
};

for (const forceZip64 of [false, true]) {
  test(`streaming writer: STORE entries, correct CRC and SHA-256 (forceZip64=${forceZip64})`, async () => {
    // a file bigger than one 4 MiB chunk, so the chunk loop and file boundaries are exercised
    const big = crypto.randomBytes(9 * 1024 * 1024 + 123);
    const bigFile = path.join(tmp, `big${forceZip64}.bin`);
    fs.writeFileSync(bigFile, big);
    const sources = [
      { name: 'manifest.json', data: Buffer.from('{"a":1}') },
      { name: 'dir/big.bin', file: bigFile },
      { name: 'ünï/código.txt', data: Buffer.from('utf8 name') },
      { name: 'empty', data: Buffer.alloc(0) },
    ];
    const entries = await describeSources(sources);
    assert.equal(entries[1].size, big.length);
    assert.equal(entries[1].sha256, crypto.createHash('sha256').update(big).digest('hex'));
    const out = path.join(tmp, `out${forceZip64}.zip`);
    const result = await writeZip(out, entries, { forceZip64 });
    assert.equal(result.size, fs.statSync(out).size);
    assert.equal(fs.existsSync(`${out}.tmp`), false);

    const fh = await fs.promises.open(out, 'r');
    try {
      const list = await readZipEntries(fileReader(fh), result.size);
      assert.deepEqual(list.map((e) => e.name), sources.map((s) => s.name));
      const body = Buffer.alloc(big.length);
      await fh.read(body, 0, big.length, list[1].dataOffset);
      assert.ok(body.equals(big), 'data is stored byte for byte');
      assert.equal(list[1].crc32, crc32(big));
    } finally {
      await fh.close();
    }
    // independent check with the system unzip, when available
    const t = spawnSync('unzip', ['-tq', out]);
    if (!t.error) {
      assert.equal(t.status, 0, String(t.stdout) + String(t.stderr));
      const info = spawnSync('unzip', ['-Z', out]).stdout.toString();
      assert.match(info, /stor/);
      assert.doesNotMatch(info, /defl/);
    }
  });
}

test('writer: a file that changes while packing is an error and leaves no archive', async () => {
  const f = path.join(tmp, 'grow.bin');
  fs.writeFileSync(f, 'abc');
  const entries = await describeSources([{ name: 'grow.bin', file: f }]);
  fs.appendFileSync(f, 'def');
  const out = path.join(tmp, 'grow.zip');
  await assert.rejects(writeZip(out, entries), /changed while/);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(`${out}.tmp`), false);
});
