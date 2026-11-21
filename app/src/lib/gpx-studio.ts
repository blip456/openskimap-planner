// Tile links for gpx.studio (desktop build; old planner "gpx.studio" section). TileServer GL renders the styles of
// the data build; the base URL comes from /api/capabilities.
export interface GpxStudioLink {
  title: string;
  url: string;
}

export const DEFAULT_TILE_SERVER = 'http://localhost:8080';

export function gpxStudioLinks(tileServerUrl: string | null): GpxStudioLink[] {
  const base = (tileServerUrl || DEFAULT_TILE_SERVER).replace(/\/+$/, '');
  return [
    { title: 'Map (JPG)', url: `${base}/styles/ski-basemap/{z}/{x}/{y}@2x.jpg` },
    { title: 'Runs and lifts only (PNG)', url: `${base}/styles/ski-overlay/{z}/{x}/{y}@2x.png` },
    { title: 'Map, steepness colours (JPG)', url: `${base}/styles/ski-basemap-steepness/{z}/{x}/{y}@2x.jpg` },
    { title: 'Runs and lifts, steepness colours (PNG)', url: `${base}/styles/ski-overlay-steepness/{z}/{x}/{y}@2x.png` },
  ];
}
