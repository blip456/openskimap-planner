// Number formats, as in the current planner (spec §6: "8.4 km", "1210 m", "42 min").
export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function formatDuration(s: number): string {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${Math.max(1, min)} min`;
}

export function formatMB(bytes: number): string {
  return `${Math.round(bytes / 1048576)} MB`;
}

/** value + unit split, for the big stats (value large, unit small) */
export function splitUnit(text: string): { value: string; unit: string } {
  const i = text.lastIndexOf(' ');
  return i < 0 ? { value: text, unit: '' } : { value: text.slice(0, i), unit: text.slice(i + 1) };
}
