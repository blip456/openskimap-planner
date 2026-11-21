// My location on the map (spec §2.25): accuracy circle (circle layer, real size in metres), heading cone and blue
// dot (symbol layers from canvas images). Map layers, not DOM, so nothing is redrawn per frame. The colour is the
// system blue in light and dark mode (map colours never change with the theme).
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';

export const USER_LOCATION_COLOR = '#007AFF';
export const USER_LOCATION_STALE = '#8E8E93';
export const LOCATION_SOURCE = 'user-location';
export const LOCATION_LAYERS = { accuracy: 'user-location-accuracy', heading: 'user-location-heading', dot: 'user-location-dot' } as const;
/** above this the circle is not shown (spec: hidden when > 2 km) */
export const MAX_ACCURACY_CIRCLE = 2000;
const EARTH_CIRCUMFERENCE = 40075016.686;
const IMAGE_RATIO = 2;

/** Metres per screen pixel at zoom 0 (MapLibre uses 512 px tiles) at this latitude. */
export function metresPerPixelZ0(lat: number): number {
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / 512;
}

/** Radius in pixels at zoom 0; the layer doubles it per zoom level (exponential interpolation, base 2). */
export function accuracyRadiusZ0(accuracy: number, lat: number): number {
  return accuracy / metresPerPixelZ0(lat);
}

/** Radius in pixels at a zoom level, as the layer draws it. */
export const accuracyRadiusAt = (accuracy: number, lat: number, zoom: number): number => accuracyRadiusZ0(accuracy, lat) * 2 ** zoom;

export interface LocationDisplay {
  lon: number;
  lat: number;
  accuracy: number;
  stale: boolean;
  /** degrees from north; null = no cone */
  heading: number | null;
  /** narrow cone (good compass accuracy) */
  narrow: boolean;
}

export function locationFeatures(d: LocationDisplay | null): FeatureCollection {
  if (!d) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          r0: d.accuracy <= MAX_ACCURACY_CIRCLE ? accuracyRadiusZ0(d.accuracy, d.lat) : 0,
          stale: d.stale,
          heading: d.heading ?? 0,
          hasHeading: d.heading !== null,
          cone: d.narrow ? 'user-cone-narrow' : 'user-cone-wide',
        },
        geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
      },
    ],
  };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const c = document.createElement('canvas');
  c.width = c.height = size * IMAGE_RATIO;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.scale(IMAGE_RATIO, IMAGE_RATIO);
  return [c, ctx];
}

/** Dot: 18 px circle, 3 px white ring, soft shadow. */
function dotImage(color: string): ImageData | null {
  const size = 36;
  const cv = canvas(size);
  if (!cv) return null;
  const [c, ctx] = cv;
  const m = size / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(m, m, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(m, m, 9, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Heading cone: 64 px long wedge pointing up from the centre, radial gradient 55 % → 0. */
function coneImage(widthDeg: number): ImageData | null {
  const size = 128;
  const cv = canvas(size);
  if (!cv) return null;
  const [c, ctx] = cv;
  const m = size / 2;
  const half = (widthDeg / 2) * (Math.PI / 180);
  const g = ctx.createRadialGradient(m, m, 0, m, m, 64);
  g.addColorStop(0, 'rgba(0,122,255,0.55)');
  g.addColorStop(1, 'rgba(0,122,255,0)');
  ctx.beginPath();
  ctx.moveTo(m, m);
  // canvas angles start at 3 o'clock; "up" is −90°
  ctx.arc(m, m, 64, -Math.PI / 2 - half, -Math.PI / 2 + half);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  return ctx.getImageData(0, 0, c.width, c.height);
}

function addImages(map: MlMap): void {
  const images: [string, () => ImageData | null][] = [
    ['user-dot', () => dotImage(USER_LOCATION_COLOR)],
    ['user-dot-stale', () => dotImage(USER_LOCATION_STALE)],
    ['user-cone-wide', () => coneImage(70)],
    ['user-cone-narrow', () => coneImage(40)],
  ];
  for (const [id, make] of images) {
    if (map.hasImage(id)) continue;
    const img = make();
    if (img) map.addImage(id, img, { pixelRatio: IMAGE_RATIO });
  }
}

/** Adds the source and layers on top of everything (call after every style load). */
export function addLocationLayers(map: MlMap): void {
  addImages(map);
  if (!map.getSource(LOCATION_SOURCE)) map.addSource(LOCATION_SOURCE, { type: 'geojson', data: locationFeatures(null) });
  if (!map.getLayer(LOCATION_LAYERS.accuracy)) {
    map.addLayer({
      id: LOCATION_LAYERS.accuracy,
      type: 'circle',
      source: LOCATION_SOURCE,
      filter: ['>', ['get', 'r0'], 0],
      paint: {
        // real size in metres: the radius doubles with every zoom level
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, ['get', 'r0'], 24, ['*', ['get', 'r0'], 2 ** 24]],
        'circle-color': USER_LOCATION_COLOR,
        'circle-opacity': 0.13,
        'circle-stroke-color': 'rgba(0,122,255,0.3)',
        'circle-stroke-width': 1,
        'circle-pitch-alignment': 'map',
        'circle-pitch-scale': 'map',
      },
    });
  }
  if (!map.getLayer(LOCATION_LAYERS.heading)) {
    map.addLayer({
      id: LOCATION_LAYERS.heading,
      type: 'symbol',
      source: LOCATION_SOURCE,
      filter: ['==', ['get', 'hasHeading'], true],
      layout: {
        'icon-image': ['get', 'cone'],
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }
  if (!map.getLayer(LOCATION_LAYERS.dot)) {
    map.addLayer({
      id: LOCATION_LAYERS.dot,
      type: 'symbol',
      source: LOCATION_SOURCE,
      layout: {
        'icon-image': ['case', ['get', 'stale'], 'user-dot-stale', 'user-dot'],
        'icon-pitch-alignment': 'viewport',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }
}

export function setLocation(map: MlMap, d: LocationDisplay | null): void {
  (map.getSource(LOCATION_SOURCE) as GeoJSONSource | undefined)?.setData(locationFeatures(d));
}
