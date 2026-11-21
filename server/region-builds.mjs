// "Build region" for the desktop server: search ski areas, estimate a region, keep saved regions in regions.json, run
// one region build at a time (scripts/build-pwa-data.mjs as a child process) and stream its output to the app.
// The ZIPs land in build/pwa/. Region helpers: scripts/lib/region.mjs.
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

export class BuildError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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
    command = [process.execPath, path.join(ROOT, 'scripts/build-pwa-data.mjs')],
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

  // --- ZIPs in build/pwa ---

  zips() {
    const dir = path.join(this.buildDir, 'pwa');
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
    const file = path.join(this.buildDir, 'pwa', name);
    return fs.existsSync(file) ? file : null;
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
    this.log.log?.(`Region build ${job.state}: ${job.region.name}${job.zip ? ` → build/pwa/${job.zip}` : ''}`);
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

/** The data build ends with "Build failed: …" (the real reason), the packer with "build:pwa-data failed: …". */
function lastError(lines) {
  const tail = lines.slice(-40);
  for (const re of [/Build failed: (.+)$/, /build:pwa-data failed: (.+)$/]) {
    for (let i = tail.length - 1; i >= 0; i--) {
      const m = re.exec(tail[i]);
      if (m) return m[1];
    }
  }
  return null;
}
