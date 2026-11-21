// "Build region" for the desktop server: search ski areas, estimate a region, keep saved regions in regions.json, run
// one region build at a time (scripts/build-pwa-map-data.mjs as a child process) and stream its output to the app.
// The ZIPs land in build/pwa-map-data/. Region helpers: scripts/lib/region.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseBuildArgs, resolveZoom, BASEMAP_ZOOM_RANGE, SKI_ZOOM_RANGE, TERRAIN_ZOOM_RANGE, CONFIRM_ABOVE_ZOOM } from '../scripts/lib/build-args.mjs';
import {
  MAX_MARGIN_KM,
  MAX_SPAN_DEG,
  RegionError,
  estimateRegion,
  regionBbox,
  regionBuildArgs,
  searchSkiAreas,
  validateRegion,
} from '../scripts/lib/region.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
/** Lines kept for an app that connects later (the full output is also printed by the server). */
const MAX_LINES = 3000;
const ZIP_RE = /^[\w.-]+\.zip$/;
const REGION_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** build/regions/default is the resorts.json build, not a region: never listed or deleted as one. */
const DEFAULT_MAP = 'default';
/** build/pwa-map-data/<region id>-YYYY-MM-DD-z<N>.zip; the main data ZIP is openskimap-data-… and is never a region ZIP. */
const REGION_ZIP_RE = /^(?!openskimap-data-)[a-z0-9][a-z0-9-]*-\d{4}-\d{2}-\d{2}-z\d+\.zip$/;

export class BuildError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The region id of a region ZIP name (`<id>-YYYY-MM-DD-zN.zip`), or null for any other file (also the main ZIP). */
function regionIdOfZip(name) {
  if (typeof name !== 'string' || !REGION_ZIP_RE.test(name)) return null;
  const id = name.replace(/-\d{4}-\d{2}-\d{2}-z\d+\.zip$/, '');
  return REGION_ID_RE.test(id) && id !== DEFAULT_MAP ? id : null;
}

/** Bytes used by a file or folder (symbolic links are not followed). */
function measure(p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((sum, n) => sum + measure(path.join(p, n)), 0);
}

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

export class RegionBuilds {
  /**
   * root: project folder (resorts.json), buildDir: build/, regionsFile: regions.json,
   * command: [program, ...args] that runs the build (tests pass a fake script).
   */
  constructor({
    root = ROOT,
    buildDir = path.join(ROOT, 'build'),
    regionsFile = path.join(ROOT, 'regions.json'),
    command = [process.execPath, path.join(ROOT, 'scripts/build-pwa-map-data.mjs')],
    log = console,
  } = {}) {
    Object.assign(this, { root, buildDir, regionsFile, command, log });
    this.skiAreaCache = null;
    this.job = null;
    this.listeners = new Set();
  }

  // --- settings ---

  defaults() {
    const settings = readJson(path.join(this.root, 'resorts.json'), {})?.settings ?? {};
    let zoom;
    try {
      zoom = resolveZoom(parseBuildArgs([]), settings);
    } catch {
      zoom = { terrain: 14, basemap: 15, ski: 16 };
    }
    return {
      zoom,
      ranges: { terrain: TERRAIN_ZOOM_RANGE, basemap: BASEMAP_ZOOM_RANGE, ski: SKI_ZOOM_RANGE },
      bigZoom: CONFIRM_ABOVE_ZOOM,
      maxSpanDeg: MAX_SPAN_DEG,
      maxMarginKm: MAX_MARGIN_KM,
      skiAreasAvailable: fs.existsSync(this.skiAreasFile()),
    };
  }

  // --- ski areas ---

  skiAreasFile() {
    return path.join(this.buildDir, 'downloads/ski_areas.geojson');
  }

  skiAreas() {
    const file = this.skiAreasFile();
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      throw new BuildError(409, 'The ski area list is not downloaded yet. Run npm run build once (or draw a box instead).');
    }
    if (this.skiAreaCache?.mtimeMs !== stat.mtimeMs) {
      const features = JSON.parse(fs.readFileSync(file, 'utf8')).features ?? [];
      this.skiAreaCache = { mtimeMs: stat.mtimeMs, features };
    }
    return this.skiAreaCache.features;
  }

  search(query) {
    const q = String(query ?? '').trim();
    if (q.length < 2) return [];
    return searchSkiAreas(this.skiAreas(), q, 20);
  }

  // --- estimate ---

  estimate(input) {
    const region = this.validate({ name: 'estimate', ...input, id: 'estimate' });
    const zoom = { ...this.defaults().zoom, ...(region.zoom ?? {}) };
    const bbox = regionBbox(region, region.skiAreas ? this.skiAreas() : []);
    if (!bbox) throw new BuildError(400, 'None of these ski areas has a known outline.');
    return { ...estimateRegion(bbox, zoom), zoom, big: zoom.terrain > CONFIRM_ABOVE_ZOOM };
  }

  validate(input) {
    try {
      return validateRegion(input);
    } catch (err) {
      if (err instanceof RegionError) throw new BuildError(400, err.message);
      throw err;
    }
  }

  // --- saved regions (regions.json) ---

  listRegions() {
    const data = readJson(this.regionsFile, null);
    return Array.isArray(data?.regions) ? data.regions : [];
  }

  saveRegion(input) {
    const region = this.validate(input);
    const regions = this.listRegions().filter((r) => r.id !== region.id);
    regions.push(region);
    regions.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    this.writeRegions(regions);
    return region;
  }

  deleteRegion(id) {
    const regions = this.listRegions();
    const rest = regions.filter((r) => r.id !== id);
    if (rest.length === regions.length) throw new BuildError(404, 'No saved region with this id.');
    this.writeRegions(rest);
  }

  writeRegions(regions) {
    const tmp = `${this.regionsFile}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ regions }, null, 2)}\n`);
    fs.renameSync(tmp, this.regionsFile);
  }

  // --- ZIPs in build/pwa-map-data ---

  zips() {
    const dir = path.join(this.buildDir, 'pwa-map-data');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((n) => ZIP_RE.test(n))
      .map((name) => {
        const st = fs.statSync(path.join(dir, name));
        return { name, size: st.size, modifiedAt: st.mtime.toISOString() };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  zipFile(name) {
    if (!ZIP_RE.test(name)) return null;
    const file = path.join(this.buildDir, 'pwa-map-data', name);
    return fs.existsSync(file) ? file : null;
  }

  /**
   * Deletes one region ZIP and the built folder of its region (build/regions/<id>), so the region's files go
   * together. The folder stays while another ZIP of the same region is left. The saved region (regions.json) stays.
   */
  deleteRegionZip(name) {
    if (this.job?.state === 'running') throw new BuildError(409, 'A build is running. Wait for it or cancel it first.');
    const regionId = regionIdOfZip(name);
    if (!regionId) throw new BuildError(400, 'Only region ZIP files can be deleted here.');
    const file = this.zipFile(name);
    if (!file) throw new BuildError(404, 'No such ZIP file.');

    let bytes = measure(file);
    fs.rmSync(file, { force: true });
    // the folder is shared by every ZIP of this region: keep it while another ZIP of the region is left
    const stillUsed = this.zips().some((z) => regionIdOfZip(z.name) === regionId);
    const folder = path.join(this.buildDir, 'regions', regionId);
    const folderRemoved = !stillUsed && fs.existsSync(folder);
    if (folderRemoved) {
      bytes += measure(folder);
      fs.rmSync(folder, { recursive: true, force: true });
    }
    this.log.log?.(`Deleted region ${regionId}: ${name}${folderRemoved ? ' and its build folder' : ''}`);
    return { removed: name, folderRemoved, bytes };
  }

  // --- clean up: what region builds leave in build/ ---
  // The page only sends group keys (never paths). Each group's paths are computed here from a fixed list.
  // Not touched: build/regions/default (the resorts.json map), build/pwa-map-data main ZIP, regions.json (saved regions).

  cleanupGroups() {
    const entries = (dir, test) => {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter(test)
        .map((n) => path.join(dir, n));
    };
    const existing = (p) => (fs.existsSync(p) ? [p] : []);
    return [
      {
        key: 'region-folders',
        label: 'Region build folders',
        note: 'Built regions in build/regions. Saved regions (regions.json) stay, Rebuild builds them again.',
        optional: false,
        paths: entries(path.join(this.buildDir, 'regions'), (n) => REGION_ID_RE.test(n) && n !== DEFAULT_MAP),
      },
      {
        key: 'region-zips',
        label: 'Region ZIP files',
        note: 'Region ZIPs in build/pwa-map-data. The main data ZIP (openskimap-data-…) is not touched.',
        optional: false,
        paths: entries(path.join(this.buildDir, 'pwa-map-data'), (n) => REGION_ZIP_RE.test(n)),
      },
      {
        key: 'work',
        label: 'Shared build cache (build/work)',
        note: 'Extracted basemap, terrain and contours. The next build extracts them again, which is slow.',
        optional: true,
        paths: existing(path.join(this.buildDir, 'work')),
      },
      {
        key: 'downloads',
        label: 'Downloads (build/downloads)',
        note: 'Ski area, run and lift data. The ski area search needs it until the next build downloads it again.',
        optional: true,
        paths: existing(path.join(this.buildDir, 'downloads')),
      },
    ];
  }

  /** What the page shows: every group with its count and size. */
  cleanupItems() {
    return this.cleanupGroups().map(({ paths, ...item }) => {
      const sizes = paths.map((p) => measure(p));
      return { ...item, count: paths.length, bytes: sizes.reduce((sum, s) => sum + s, 0) };
    });
  }

  /** Deletes the chosen groups. Refused while a build runs (it may be writing into these folders). */
  cleanup(keys) {
    if (this.job?.state === 'running') throw new BuildError(409, 'A build is running. Wait for it or cancel it first.');
    if (!Array.isArray(keys) || keys.length === 0 || !keys.every((k) => typeof k === 'string')) {
      throw new BuildError(400, 'Choose what to delete.');
    }
    const groups = new Map(this.cleanupGroups().map((g) => [g.key, g]));
    const chosen = [...new Set(keys)].map((k) => {
      const group = groups.get(k);
      if (!group) throw new BuildError(400, `Unknown item: ${k}`);
      return group;
    });
    const removed = chosen.map((group) => {
      const bytes = group.paths.reduce((sum, p) => sum + measure(p), 0);
      for (const p of group.paths) fs.rmSync(p, { recursive: true, force: true });
      this.log.log?.(`Cleaned up ${group.label}: ${group.paths.length} item(s)`);
      return { key: group.key, count: group.paths.length, bytes };
    });
    return { removed };
  }

  // --- the build job ---

  status() {
    if (!this.job) return null;
    const { lines, child, ...rest } = this.job;
    return { ...rest, lineCount: lines.length };
  }

  lines() {
    return this.job?.lines ?? [];
  }

  /** Starts a build. `save` also stores the region in regions.json (for a later rebuild). */
  start(input, { save = false } = {}) {
    if (this.job?.state === 'running') throw new BuildError(409, 'A build is already running. Wait for it or cancel it.');
    const region = this.validate(input);
    if (save) this.saveRegion(region);

    const outDir = path.join(this.buildDir, 'regions', region.id);
    fs.mkdirSync(outDir, { recursive: true });
    const regionFile = path.join(outDir, 'region.json');
    fs.writeFileSync(regionFile, `${JSON.stringify(region, null, 2)}\n`);

    const [program, ...baseArgs] = this.command;
    const child = spawn(program, [...baseArgs, ...regionBuildArgs(region, { regionFile, outDir })], {
      cwd: this.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      // own process group: cancel stops the build and the tools it started (pmtiles, tippecanoe, GDAL)
      detached: process.platform !== 'win32',
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    const job = {
      id: `${region.id}-${Date.now().toString(36)}`,
      region,
      saved: save,
      state: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      zip: null,
      error: null,
      progress: null,
      lines: [],
      child,
    };
    this.job = job;
    this.log.log?.(`Region build started: ${region.name} (${region.id})`);
    this.emit('status', this.status());

    for (const stream of [child.stdout, child.stderr]) {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        rest += chunk;
        // "\r" redraws a progress bar on the same line: only the newest one is kept
        const parts = rest.split(/(\r\n|\n|\r)/);
        rest = parts.pop() ?? '';
        for (let i = 0; i < parts.length; i += 2) this.addLine(job, parts[i], parts[i + 1] === '\r');
      });
      stream.on('end', () => rest && this.addLine(job, rest, false));
    }
    child.on('error', (err) => this.finish(job, 'failed', err.message));
    child.on('exit', (code, signal) => {
      if (job.state !== 'running') return;
      if (job.cancelRequested) this.finish(job, 'cancelled', 'Cancelled.');
      else if (code === 0) this.finish(job, 'done', null);
      else this.finish(job, 'failed', lastError(job.lines) ?? `The build stopped (${signal ?? `exit code ${code}`}).`);
    });
    return this.status();
  }

  addLine(job, raw, progress) {
    // remove terminal colour codes
    const text = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
    if (!text.trim()) return;
    if (progress) {
      job.progress = text;
      if (job === this.job) this.emit('progress', { text });
      return;
    }
    job.progress = null;
    const done = /Done: (.+\.zip)\b/.exec(text);
    if (done) job.zip = path.basename(done[1].trim());
    job.lines.push(text);
    if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
    if (job === this.job) this.emit('line', { text });
  }

  finish(job, state, error) {
    if (job.state !== 'running') return;
    job.state = state;
    job.error = error;
    job.progress = null;
    job.finishedAt = new Date().toISOString();
    if (state === 'done' && !job.zip) {
      job.state = 'failed';
      job.error = 'The build finished but did not report a ZIP file.';
    }
    this.log.log?.(`Region build ${job.state}: ${job.region.name}${job.zip ? ` → build/pwa-map-data/${job.zip}` : ''}`);
    if (job === this.job) this.emit('status', this.status());
  }

  cancel() {
    const job = this.job;
    if (job?.state !== 'running') throw new BuildError(409, 'No build is running.');
    job.cancelRequested = true;
    killTree(job.child, 'SIGTERM');
    // tools that ignore SIGTERM get SIGKILL after a few seconds
    setTimeout(() => job.state === 'running' && killTree(job.child, 'SIGKILL'), 5000).unref();
    return this.status();
  }

  /** Called when the server stops: never leave a build running in the background. */
  shutdown() {
    if (this.job?.state === 'running') killTree(this.job.child, 'SIGTERM');
  }

  // --- events (server-sent events to the app) ---

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, data) {
    for (const fn of this.listeners) fn(type, data);
  }
}

function killTree(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // already gone
  }
}

/** The data build ends with "Build failed: …" (the real reason), the packer with "build:pwa-map-data failed: …". */
function lastError(lines) {
  const tail = lines.slice(-40);
  for (const re of [/Build failed: (.+)$/, /build:pwa-map-data failed: (.+)$/]) {
    for (let i = tail.length - 1; i >= 0; i--) {
      const m = re.exec(tail[i]);
      if (m) return m[1];
    }
  }
  return null;
}
