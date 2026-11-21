import { describe, expect, test, vi } from 'vitest';
import { gpxFileName, shareFile, shareMethod, slug, type ShareNavigator } from '../src/lib/share.ts';

const file = new File(['<gpx/>'], 'route.gpx', { type: 'application/gpx+xml' });
const iphone = (canShare = true): ShareNavigator & { share: ReturnType<typeof vi.fn> } => ({
  share: vi.fn(async () => {}),
  canShare: () => canShare,
});

describe('share or download', () => {
  test('decision: share sheet only where files can be shared and not on a desktop', () => {
    expect(shareMethod(iphone(), file, { desktop: false })).toBe('share');
    expect(shareMethod(iphone(false), file, { desktop: false })).toBe('download');
    expect(shareMethod(iphone(), file, { desktop: true })).toBe('download'); // macOS could share, the desktop downloads
    expect(shareMethod({}, file, { desktop: false })).toBe('download'); // no Web Share API
    expect(shareMethod({ share: async () => {} }, file, { desktop: false })).toBe('download'); // no canShare
    expect(shareMethod(undefined, file, { desktop: false })).toBe('download');
    const throwing: ShareNavigator = { share: async () => {}, canShare: () => { throw new TypeError('bad'); } };
    expect(shareMethod(throwing, file, { desktop: false })).toBe('download');
  });

  test('shares the file with its name; a closed share sheet is not an error', async () => {
    const nav = iphone();
    const download = vi.fn();
    expect(await shareFile(new Blob(['<gpx/>'], { type: 'application/gpx+xml' }), 'a.gpx', { desktop: false, nav, download })).toBe('share');
    const shared = nav.share.mock.calls[0][0] as { files: File[] };
    expect(shared.files[0].name).toBe('a.gpx');
    expect(shared.files[0].type).toBe('application/gpx+xml');
    expect(download).not.toHaveBeenCalled();

    nav.share.mockRejectedValueOnce(Object.assign(new Error('cancel'), { name: 'AbortError' }));
    expect(await shareFile(new Blob(['x']), 'a.gpx', { desktop: false, nav, download })).toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
  });

  test('falls back to a download when sharing fails or is not possible', async () => {
    const nav = iphone();
    nav.share.mockRejectedValueOnce(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' }));
    const download = vi.fn();
    expect(await shareFile(new Blob(['x']), 'a.gpx', { desktop: false, nav, download })).toBe('download');
    expect(await shareFile(new Blob(['x']), 'b.zip', { desktop: true, nav, download })).toBe('download');
    expect(download.mock.calls.map((c) => c[1])).toEqual(['a.gpx', 'b.zip']);
  });

  test('file names', () => {
    expect(slug('Gipfel → Seealpe (Höfats)')).toBe('gipfel-seealpe-hofats');
    expect(gpxFileName('Gipfel → Seealpe')).toBe('gipfel-seealpe.gpx');
    expect(gpxFileName('→ ←')).toBe('ski-route.gpx');
  });
});
