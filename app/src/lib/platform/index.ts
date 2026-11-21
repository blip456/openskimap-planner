// Build target and capabilities (docs/pwa-plan.md §3.3). The UI shows features based on these, never on
// device sniffing.

export type Target = 'pwa' | 'desktop';

export const TARGET: Target = import.meta.env.VITE_TARGET === 'pwa' ? 'pwa' : 'desktop';

export interface Capabilities {
  target: Target;
  /** import a data ZIP into the browser storage (PWA) */
  importData: boolean;
  /** installable PWA with offline cache (phase 5) */
  installable: boolean;
  /** base URL of TileServer GL for gpx.studio links (desktop), or null */
  tileServerUrl: string | null;
  /** saved routes can be stored in the project folder (desktop server) */
  projectFolderRoutes: boolean;
  /** Google Maps short links (maps.app.goo.gl) can be resolved (desktop server) */
  googleShortLinks: boolean;
  /** default for the online-mode switch */
  onlineByDefault: boolean;
  /** build data ZIPs for other regions ("Build region", desktop server) */
  regionBuilds: boolean;
}

/** What the desktop server reports at /api/capabilities. */
export interface ServerCapabilities {
  tileServerUrl: string | null;
  projectFolderRoutes: boolean;
  googleShortLinks: boolean;
  /** older servers do not send it */
  regionBuilds?: boolean;
  data: ServerDataInfo | null;
  /** why data is null (e.g. "Run npm run build first") */
  dataError?: string;
}

export interface ServerDataInfo {
  resorts: { id: string; name: string; bbox: [number, number, number, number]; center: [number, number] }[];
  language: string;
  /** PMTiles archives that exist on the server */
  tiles: string[];
  zoom: { terrain: number | null; basemap: number | null; ski: number | null } | null;
  builtAt: string | null;
}

export function staticCapabilities(target: Target): Capabilities {
  return target === 'pwa'
    ? {
        target,
        importData: true,
        installable: true,
        tileServerUrl: null,
        projectFolderRoutes: false,
        googleShortLinks: false,
        onlineByDefault: false,
        regionBuilds: false,
      }
    : {
        target,
        importData: false,
        installable: false,
        tileServerUrl: null,
        projectFolderRoutes: false,
        googleShortLinks: false,
        onlineByDefault: true,
        regionBuilds: false,
      };
}

/** Merges the static capabilities of a target with what the desktop server reports. */
export function mergeServerCapabilities(base: Capabilities, server: ServerCapabilities): Capabilities {
  return {
    ...base,
    tileServerUrl: server.tileServerUrl,
    projectFolderRoutes: server.projectFolderRoutes,
    googleShortLinks: server.googleShortLinks,
    regionBuilds: server.regionBuilds === true,
  };
}

export async function fetchServerCapabilities(fetchFn: typeof fetch = fetch): Promise<ServerCapabilities> {
  const res = await fetchFn('/api/capabilities');
  if (!res.ok) throw new Error(`The desktop server did not answer (${res.status}). Is it running?`);
  return (await res.json()) as ServerCapabilities;
}
