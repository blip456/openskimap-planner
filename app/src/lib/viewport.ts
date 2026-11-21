/**
 * Height of the app area. Usually innerHeight; in the iOS 26+ Home Screen app innerHeight is short by the status
 * bar height, and the body is stretched to the full screen instead (app.css), so read the body.
 */
export function viewportHeight(): number {
  const body = typeof document !== 'undefined' ? document.body : null;
  return Math.max(body?.clientHeight ?? 0, typeof innerHeight === 'number' ? innerHeight : 800);
}
