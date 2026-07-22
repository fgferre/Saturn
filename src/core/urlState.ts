/**
 * Shareable URL state (F8.3): the focused body, simulation time, speed and a
 * camera pose relative to the focused body, encoded as query params.
 *
 * Pure and dependency-free (no three, no DOM) so it is importable from Node
 * self-checks and round-trips exactly: `parseState(serializeState(x))` returns
 * every field of `x` that was valid. Parsing NEVER throws — invalid ids, junk
 * numbers and out-of-range dates are simply dropped.
 *
 *   ?focus=<id>&jd=<julian>&speed=<s>&cam=<az>,<el>,<dist>[,<fov>]
 *
 * `cam` is a spherical offset (azimuth/elevation in radians, distance in scene
 * units) *relative to the focused body*, so a shared link frames the same body
 * the same way wherever that body happens to be in its orbit. An optional 4th
 * component carries the camera FOV (degrees) so shared links / photos preserve
 * the lens (F8.7).
 */

import { J2000 } from '../orbital/types.ts';

/** Field-of-view slider bounds (degrees) — shared with the HUD and main loop. */
export const FOV_MIN = 10;
export const FOV_MAX = 60;
export const FOV_DEFAULT = 45;

export interface CameraPose {
  /** Azimuth around the vertical axis, radians. */
  az: number;
  /** Elevation above the body's horizontal plane, radians. */
  el: number;
  /** Distance from the body, scene units. */
  dist: number;
  /** Vertical field of view, degrees (optional; the lens the link was made at). */
  fov?: number;
}

export interface UrlState {
  focus?: string;
  jd?: number;
  speed?: number;
  cam?: CameraPose;
}

/** J2000 ± 200 Julian years — anything outside is ignored (bad ephemeris). */
const JD_HALF_SPAN = 200 * 365.25;
const JD_MIN = J2000 - JD_HALF_SPAN;
const JD_MAX = J2000 + JD_HALF_SPAN;

/**
 * Simulated seconds per real second. The fastest HUD preset is 5 d/s (4.32e5);
 * anything past this is junk, and a crafted `?speed=1e308` walks SimClock's JD
 * to Infinity on the first frame — an unrecoverable state (every date, orbit
 * and label goes NaN until the user reloads).
 */
const SPEED_MAX = 1e7;

/** Body ids are short slugs; reject anything that isn't one (e.g. markup). */
const FOCUS_RE = /^[a-z][a-z0-9_-]{0,31}$/i;

const clamp = (n: number, lo: number, hi: number): number =>
  n < lo ? lo : n > hi ? hi : n;

/** Round-trip-safe rounding: the rounded double still re-parses to itself. */
const round = (n: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** Parse a finite number, or undefined for null/blank/NaN/Infinity. */
const finiteNum = (v: string | null): number | undefined => {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Spherical (az/el/dist) → cartesian offset `[x, y, z]` (y is up). */
export function sphericalToOffset(
  az: number, el: number, dist: number,
): [number, number, number] {
  const ce = Math.cos(el);
  return [Math.cos(az) * ce * dist, Math.sin(el) * dist, Math.sin(az) * ce * dist];
}

/** Cartesian offset (y up) → spherical (az/el/dist); inverse of the above. */
export function offsetToSpherical(x: number, y: number, z: number): CameraPose {
  const dist = Math.hypot(x, y, z);
  const el = dist > 0 ? Math.asin(clamp(y / dist, -1, 1)) : 0;
  const az = Math.atan2(z, x);
  return { az, el, dist };
}

/** Decode query state. Accepts a `location.search` string with or without `?`. */
export function parseState(search: string): UrlState {
  const out: UrlState = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    return out;
  }

  const focus = params.get('focus');
  if (focus !== null && FOCUS_RE.test(focus)) out.focus = focus.toLowerCase();

  const jd = finiteNum(params.get('jd'));
  if (jd !== undefined && jd >= JD_MIN && jd <= JD_MAX) out.jd = jd;

  const speed = finiteNum(params.get('speed'));
  if (speed !== undefined && Math.abs(speed) <= SPEED_MAX) out.speed = speed;

  const cam = params.get('cam');
  if (cam !== null) {
    const parts = cam.split(',');
    // 3 components (az,el,dist) or 4 (…,fov). Anything else is junk.
    if (parts.length === 3 || parts.length === 4) {
      const az = finiteNum(parts[0]);
      const el = finiteNum(parts[1]);
      const dist = finiteNum(parts[2]);
      if (az !== undefined && el !== undefined && dist !== undefined && dist > 0) {
        out.cam = { az, el, dist };
        if (parts.length === 4) {
          const fov = finiteNum(parts[3]);
          // Out-of-range fov is dropped; the pose still restores at default lens.
          if (fov !== undefined && fov >= FOV_MIN && fov <= FOV_MAX) out.cam.fov = fov;
        }
      }
    }
  }

  return out;
}

/**
 * Encode state as a query string (no leading `?`). Only valid fields are
 * written, so `parseState(serializeState(x))` preserves exactly the fields of
 * `x` that survive validation.
 */
export function serializeState(state: UrlState): string {
  const params = new URLSearchParams();

  if (state.focus !== undefined && FOCUS_RE.test(state.focus)) {
    params.set('focus', state.focus.toLowerCase());
  }
  if (
    state.jd !== undefined && Number.isFinite(state.jd) &&
    state.jd >= JD_MIN && state.jd <= JD_MAX
  ) {
    params.set('jd', String(round(state.jd, 6)));
  }
  if (
    state.speed !== undefined && Number.isFinite(state.speed) &&
    Math.abs(state.speed) <= SPEED_MAX
  ) {
    params.set('speed', String(round(state.speed, 6)));
  }
  if (
    state.cam !== undefined &&
    Number.isFinite(state.cam.az) && Number.isFinite(state.cam.el) &&
    Number.isFinite(state.cam.dist) && state.cam.dist > 0
  ) {
    const { az, el, dist, fov } = state.cam;
    let camStr = `${round(az, 5)},${round(el, 5)},${round(dist, 3)}`;
    if (fov !== undefined && Number.isFinite(fov) && fov >= FOV_MIN && fov <= FOV_MAX) {
      camStr += `,${round(fov, 2)}`;
    }
    params.set('cam', camStr);
  }

  return params.toString();
}
