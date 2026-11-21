// Sharing a file (GPX, ZIP): the iOS share sheet where the browser can share files, else a normal download.
// Desktop (mouse + hover) always downloads, as the old planner did, even where macOS browsers could share.

export interface ShareNavigator {
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
}

export type ShareMethod = 'share' | 'download';

/** Pure decision, unit-tested: share sheet only when files can be shared and the device is not a desktop. */
export function shareMethod(nav: ShareNavigator | undefined, file: File, opts: { desktop: boolean }): ShareMethod {
  if (opts.desktop || !nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return 'download';
  try {
    return nav.canShare({ files: [file] }) ? 'share' : 'download';
  } catch {
    return 'download';
  }
}

export function downloadBlob(blob: Blob, filename: string, doc: Document = document): void {
  const a = doc.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Shares or downloads. Returns what was done; 'cancelled' when the user closed the share sheet. */
export async function shareFile(
  blob: Blob,
  filename: string,
  opts: { desktop: boolean; nav?: ShareNavigator; download?: (blob: Blob, filename: string) => void },
): Promise<ShareMethod | 'cancelled'> {
  const nav = opts.nav ?? (typeof navigator === 'undefined' ? undefined : (navigator as ShareNavigator));
  const file = new File([blob], filename, { type: blob.type });
  if (shareMethod(nav, file, opts) === 'share') {
    try {
      await nav!.share!({ files: [file], title: filename });
      return 'share';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      // NotAllowedError (no user gesture any more) etc.: fall back to a download
    }
  }
  (opts.download ?? downloadBlob)(blob, filename);
  return 'download';
}

/** File-name part of a route or folder name (same rule as the saved routes on disk). */
export const slug = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

export const gpxFileName = (name: string): string => `${slug(name) || 'ski-route'}.gpx`;
