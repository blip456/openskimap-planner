// GPX export of a route result.
import type { RouteResult } from './routing/graph.ts';
import { pointLetter } from './routing/steps.ts';
import type { Position } from './types.ts';

const ESCAPES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };

/** The parts of a route result the GPX needs. */
export type GpxRoute = Pick<RouteResult, 'snapped' | 'steps' | 'coordinates'>;

export function toGpx(name: string, result: GpxRoute): string {
  const esc = (s: unknown): string => String(s).replace(/[<>&"']/g, (c) => ESCAPES[c]);
  const pt = (tag: string, c: Position | readonly number[], inner = ''): string =>
    `<${tag} lat="${c[1].toFixed(7)}" lon="${c[0].toFixed(7)}">${c[2] != null ? `<ele>${c[2].toFixed(1)}</ele>` : ''}${inner}</${tag}>`;

  const last = result.snapped.length - 1;
  const pointWpts = result.snapped.map((c, i) => {
    const role = i === 0 ? ' (start)' : i === last ? ' (destination)' : '';
    return pt('wpt', c, `<name>${esc(`${pointLetter(i)}${role}`)}</name><type>route point</type>`);
  });

  const counters = new Map<number, number>();
  const wpts = result.steps
    .filter((s) => s.type !== 'walk' && s.runKind !== 'connector')
    .map((s) => {
      const n = (counters.get(s.leg) ?? 0) + 1;
      counters.set(s.leg, n);
      const what =
        s.type === 'lift'
          ? `${s.down ? 'Ride down' : 'Take lift'}: ${s.label}`
          : `Run: ${s.label}${s.difficulty ? ` (${s.difficulty})` : ''}`;
      const leg = `${pointLetter(s.leg)}→${pointLetter(s.leg + 1)}`;
      return pt('wpt', s.coordinates[0], `<name>${esc(`${leg} ${n}. ${what}`)}</name><type>${s.type}</type>`);
    });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="openskimap-local planner" xmlns="http://www.topografix.com/GPX/1/1">',
    `<metadata><name>${esc(name)}</name><desc>Data: OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors (ODbL)</desc></metadata>`,
    ...pointWpts,
    ...wpts,
    `<trk><name>${esc(name)}</name><type>skiing</type><trkseg>`,
    ...result.coordinates.map((c) => pt('trkpt', c)),
    '</trkseg></trk>',
    '</gpx>',
    '',
  ].join('\n');
}
