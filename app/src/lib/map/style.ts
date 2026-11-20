// The map style, built in the browser with the shared style builder (the same code that writes the TileServer GL
// styles). Sources point at pmtiles://<name> in both builds; glyphs and sprite come from the data source.
import { buildBasemapStyle, type ColorBy } from '@core/styles/index.ts';
import type { StyleSpecification } from 'maplibre-gl';
import type { DataSource, ResortEntry } from '../data/types.ts';

export function buildMapStyle(ds: DataSource, resort: ResortEntry, colorBy: ColorBy = 'difficulty'): StyleSpecification {
  const style = buildBasemapStyle({
    language: ds.info.language,
    bounds: resort.bbox,
    hasTerrain: ds.info.tiles.includes('terrain'),
    hasContours: ds.info.tiles.includes('contours'),
    colorBy,
    urls: {
      tiles: { basemap: 'pmtiles://basemap', ski: 'pmtiles://ski', terrain: 'pmtiles://terrain', contours: 'pmtiles://contours' },
      glyphs: ds.glyphsUrl(),
      sprite: ds.spriteUrl(),
    },
  });
  // the core keeps its style type loose (no MapLibre dependency); the builder output is a valid v8 style
  return style as unknown as StyleSpecification;
}
