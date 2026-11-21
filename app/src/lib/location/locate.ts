// The Locate button as a small state machine (spec §2.6), like Apple Maps: centre once → follow → follow with
// heading. Pure functions: the location store runs the actions (start/stop the GPS, move the map, ask for the
// compass). Unit-tested in app/test/location.test.ts.

export type LocateMode =
  /** no location shown, or shown but the map does not follow (the dot can still be there) */
  | 'off'
  /** waiting for the first position */
  | 'searching'
  /** dot shown, the map was centred once and does not follow */
  | 'centred'
  /** the map follows the position */
  | 'follow'
  /** the map follows the position and turns with the compass */
  | 'heading'
  /** the user (or iOS) did not allow location */
  | 'denied'
  /** no position: no GPS, timeout, insecure page or no support */
  | 'unavailable';

export type LocateAction =
  | 'start-watch'
  | 'stop-watch'
  /** move the map to the position */
  | 'centre'
  /** ask for the compass (iOS needs the tap for this) */
  | 'ask-compass'
  /** turn the map back to north */
  | 'north';

export type LocationErrorCode = 'denied' | 'unavailable' | 'timeout' | 'insecure' | 'unsupported';

export interface Step {
  mode: LocateMode;
  actions: LocateAction[];
}

export interface TapContext {
  /** a position is known (the dot is on the map) */
  hasFix: boolean;
  /** the compass was refused before */
  compassDenied: boolean;
  /** the device can have a compass (not on a desktop with a mouse) */
  compassAvailable: boolean;
}

/** A tap on the Locate button. */
export function locateTap(mode: LocateMode, ctx: TapContext): Step {
  switch (mode) {
    case 'off':
      return ctx.hasFix ? { mode: 'centred', actions: ['start-watch', 'centre'] } : { mode: 'searching', actions: ['start-watch'] };
    case 'searching':
      return { mode: 'off', actions: ['stop-watch'] };
    case 'centred':
      return { mode: 'follow', actions: ['centre'] };
    case 'follow':
      // no compass, or it was refused: the next tap stops following (spec §2.6)
      if (!ctx.compassAvailable || ctx.compassDenied) return { mode: 'off', actions: [] };
      return { mode: 'heading', actions: ['ask-compass', 'centre'] };
    case 'heading':
      return { mode: 'off', actions: ['north'] };
    case 'denied':
    case 'unavailable':
      // try again: the user may have changed the setting; a new error shows the message again
      return { mode: 'searching', actions: ['start-watch'] };
  }
}

/**
 * A new position arrived. The first one centres the map once. While following, the map moves with every fix by
 * itself (it watches the fix in these modes), so no extra "centre" request (that one also zooms in).
 */
export function locateFix(mode: LocateMode): Step {
  if (mode === 'searching' || mode === 'denied' || mode === 'unavailable') return { mode: 'centred', actions: ['centre'] };
  return { mode, actions: [] };
}

/** The map was moved by hand: following stops (as in Apple Maps). */
export function locatePan(mode: LocateMode): Step {
  return { mode: mode === 'follow' || mode === 'heading' ? 'centred' : mode, actions: [] };
}

/** The map was turned by hand: "follow with heading" becomes "follow". */
export function locateRotate(mode: LocateMode): Step {
  return { mode: mode === 'heading' ? 'follow' : mode, actions: [] };
}

/**
 * The GPS reported an error. "Denied" always stops. A short gap (no signal, timeout) while a position is known
 * keeps the last position and the mode; without a position the button shows "Location is off".
 */
export function locateError(mode: LocateMode, code: LocationErrorCode, hasFix: boolean): Step {
  if (code === 'denied') return { mode: 'denied', actions: ['stop-watch'] };
  if ((code === 'unavailable' || code === 'timeout') && hasFix) return { mode, actions: [] };
  return { mode: 'unavailable', actions: ['stop-watch'] };
}

/** aria-label and tooltip per state (spec §6 "Locate states"). */
export function locateLabel(mode: LocateMode): string {
  switch (mode) {
    case 'off':
      return 'Show my location';
    case 'searching':
      return 'Finding your location';
    case 'centred':
      return 'Follow my location';
    case 'follow':
      return 'Follow my location and heading';
    case 'heading':
      return 'Stop following';
    case 'denied':
    case 'unavailable':
      return 'Location is off';
  }
}

export const LOCATION_DENIED = 'Location is off for this app. Turn it on in Settings › Privacy & Security › Location Services › Safari Websites.';
export const COMPASS_DENIED = 'Compass is off. The map can still follow your position.';

/** Plain-English message for an error (spec §6). */
export function locationMessage(code: LocationErrorCode): string {
  switch (code) {
    case 'denied':
      return LOCATION_DENIED;
    case 'timeout':
      return "Can't find your location right now. Try again in a moment, best outside.";
    case 'insecure':
      return 'My location only works on a secure page (https). Open the app with its https address.';
    case 'unsupported':
      return 'This browser cannot show your location.';
    default:
      return "Can't find your location right now.";
  }
}

/** GeolocationPositionError.code → our code (1 denied, 2 unavailable, 3 timeout). */
export function errorCodeOf(err: { code?: number } | null | undefined): LocationErrorCode {
  if (err?.code === 1) return 'denied';
  if (err?.code === 3) return 'timeout';
  return 'unavailable';
}
