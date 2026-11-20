// Camera helpers (pure; unit-tested).

const mercY = (lat: number): number => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/**
 * Zoom at which the bbox *covers* a width × height view (no empty area around the data, the long side is cropped).
 * A portrait phone and a wide resort would otherwise show the resort as a thin strip ("contain").
 */
export function coverZoom(bbox: readonly [number, number, number, number], width: number, height: number, tileSize = 512): number {
  const dx = (bbox[2] - bbox[0]) / 360;
  const dy = Math.abs(mercY(bbox[1]) - mercY(bbox[3]));
  const zw = Math.log2(width / (tileSize * Math.max(dx, 1e-9)));
  const zh = Math.log2(height / (tileSize * Math.max(dy, 1e-9)));
  return Math.max(zw, zh);
}

export function boundsOf(coords: readonly (readonly [number, number, number?])[]): [[number, number], [number, number]] | null {
  if (!coords.length) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const c of coords) {
    w = Math.min(w, c[0]);
    e = Math.max(e, c[0]);
    s = Math.min(s, c[1]);
    n = Math.max(n, c[1]);
  }
  return [[w, s], [e, n]];
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** True when every screen point lies inside the box. */
export function allInside(points: readonly { x: number; y: number }[], box: Box): boolean {
  return points.every((p) => p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom);
}
