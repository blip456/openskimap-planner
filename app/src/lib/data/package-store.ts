// Layout of imported data in the storage:
//
//   openskimap/
//     pkg-<timestamp>/        one imported data ZIP (manifest.json, planner/, tiles/, fonts/, sprites/)
//       .complete             written last: only a package with this marker is used
//
// An import writes a new pkg-<timestamp> folder and creates `.complete` after every file is checked. Creating an
// empty file is atomic, so a failed or interrupted import never replaces the data in use. Older packages are
// removed afterwards.
import { parseManifest, type Manifest } from '@core/data-package.ts';
import type { StorageDir } from './storage.ts';

export const PACKAGE_PREFIX = 'pkg-';
export const COMPLETE_MARKER = '.complete';

export interface StoredPackage {
  name: string;
  dir: StorageDir;
  manifest: Manifest;
}

const stamp = (name: string): number => Number(name.slice(PACKAGE_PREFIX.length)) || 0;

export async function listPackageDirs(root: StorageDir): Promise<string[]> {
  return (await root.list())
    .filter((e) => e.kind === 'directory' && e.name.startsWith(PACKAGE_PREFIX))
    .map((e) => e.name)
    .sort((a, b) => stamp(b) - stamp(a));
}

/** The newest complete package, or null when no data has been imported. */
export async function findActivePackage(root: StorageDir): Promise<StoredPackage | null> {
  for (const name of await listPackageDirs(root)) {
    const dir = await root.dir(name);
    if (!dir || !(await dir.file(COMPLETE_MARKER))) continue;
    const m = await dir.file('manifest.json');
    if (!m) continue;
    try {
      return { name, dir, manifest: parseManifest(JSON.parse(await m.text())) };
    } catch {
      // a damaged package: try the next older one
    }
  }
  return null;
}

/** Removes every package folder except `keep` (also unfinished imports). */
export async function removePackagesExcept(root: StorageDir, keep: string | null): Promise<void> {
  for (const name of await listPackageDirs(root)) if (name !== keep) await root.remove(name);
}

/** Removes unfinished imports (no marker) that are older than the active package. */
export async function removeIncomplete(root: StorageDir): Promise<void> {
  for (const name of await listPackageDirs(root)) {
    const dir = await root.dir(name);
    if (dir && !(await dir.file(COMPLETE_MARKER))) await root.remove(name);
  }
}

/** A new folder name that sorts after every existing one. */
export async function newPackageName(root: StorageDir, now = Date.now()): Promise<string> {
  const newest = (await listPackageDirs(root))[0];
  return `${PACKAGE_PREFIX}${Math.max(now, newest ? stamp(newest) + 1 : 0)}`;
}
