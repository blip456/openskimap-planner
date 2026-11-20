// Copied from planner/routes-store.mjs for the new desktop server; planner/ goes away in phase 4.
// Saved routes: one JSON file per route in saved-routes/, grouped into folders by a "folder" field.
// Each file keeps what is needed to reopen the route (resort, points, settings) and the GPX made when saving.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const DEFAULT_FOLDER = 'My routes';

export class StoreError extends Error {}

export class RouteStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  file(id) {
    if (!/^[a-f0-9]{12}$/.test(String(id))) throw new StoreError('Invalid route id');
    return path.join(this.dir, `${id}.json`);
  }

  get(id) {
    const file = this.file(id);
    if (!fs.existsSync(file)) throw new StoreError('Route not found');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  list() {
    const routes = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8'));
        routes.push({
          id: r.id,
          name: r.name,
          folder: r.folder,
          resort: r.resort,
          resortName: r.resortName,
          points: r.points.length,
          summary: r.summary,
          updatedAt: r.updatedAt,
        });
      } catch {
        // ignore unreadable files
      }
    }
    const folders = new Map();
    for (const r of routes) {
      if (!folders.has(r.folder)) folders.set(r.folder, []);
      folders.get(r.folder).push(r);
    }
    return [...folders.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, list]) => ({ name, routes: list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }));
  }

  save({ id, name, folder, resort, resortName, points, options, summary, gpx }) {
    const now = new Date().toISOString();
    let createdAt = now;
    if (id) {
      createdAt = this.get(id).createdAt ?? now;
    } else {
      id = crypto.randomBytes(6).toString('hex');
    }
    const route = {
      id,
      name: cleanText(name, 120) || 'Ski route',
      folder: cleanText(folder, 60) || DEFAULT_FOLDER,
      resort,
      resortName,
      points,
      options,
      summary,
      gpx,
      createdAt,
      updatedAt: now,
    };
    fs.writeFileSync(this.file(id), JSON.stringify(route, null, 2));
    return route;
  }

  delete(id) {
    fs.rmSync(this.file(id), { force: true });
  }

  zipFolder(folder) {
    const routes = this.list().find((f) => f.name === folder)?.routes ?? [];
    if (!routes.length) throw new StoreError(`Folder "${folder}" has no routes`);
    const used = new Set();
    const files = routes.map((meta) => {
      const r = this.get(meta.id);
      let base = slug(r.name) || 'ski-route';
      for (let n = 2; used.has(base); n++) base = `${slug(r.name) || 'ski-route'}-${n}`;
      used.add(base);
      return { name: `${base}.gpx`, data: Buffer.from(r.gpx, 'utf8') };
    });
    return zip(files);
  }
}

const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const slug = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

// Minimal ZIP writer (deflate), enough for a handful of GPX files.
function zip(files) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}
