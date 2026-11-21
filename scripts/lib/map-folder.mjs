// Where the resorts.json map build lives: build/regions/<id>, where <id> is the id of the first resort in resorts.json.
// Used by the build, the data ZIP packer, the desktop server and the "Build region" page, so they always agree.
import fs from 'node:fs';
import path from 'node:path';

/** Fallback when resorts.json has no usable resort (for example in tests without a project folder). */
export const FALLBACK_MAP_ID = 'default';

/** The folder name of the resorts.json build, read from `<root>/resorts.json`. */
export function defaultMapId(root) {
  try {
    const id = JSON.parse(fs.readFileSync(path.join(root, 'resorts.json'), 'utf8'))?.resorts?.[0]?.id;
    if (typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) return id;
  } catch {
    // no file or not JSON: use the fallback
  }
  return FALLBACK_MAP_ID;
}

/** build/regions/<id> for the resorts.json build. */
export function defaultMapDir(buildDir, root) {
  return path.join(buildDir, 'regions', defaultMapId(root));
}
