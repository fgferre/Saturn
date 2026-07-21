/**
 * Event browser (F12.1) — a numeric sweep, at runtime, over a ±5-year window
 * centred on "now", for the handful of dates worth jumping to. Everything is
 * derived from the same ephemeris the render loop already trusts
 * (sunDirectionAt / elementsToPosition / saturnShadowOnMoon), so an event date
 * and what you see when you jump there can never disagree.
 *
 * Cost: the sweep runs once at boot in a few milliseconds (coarse day/6-hour
 * steps + bisection refinement, Titan restricted to the ±10-month shadow season
 * around each equinox). RECURRING events are NOT enumerated — Enceladus reaches
 * apoapsis every 1.37 d (~2,700 times in the window). Only the NEXT apoapsis is
 * materialised, from the current simulated time, recomputed on demand
 * (nextEnceladusApoapsis) rather than listed.
 *
 * Frame: the scene is Saturn's equatorial frame, +Y = pole, so the ring plane
 * is Y=0. sunDirectionAt(jd).y is therefore the Sun's height above the rings:
 * =0 at equinox (ring-plane crossing), extremal at solstice.
 *
 * ⚠ VERIFICAR (dates are mean-element approximations, good to ~1–3 days):
 *  - Saturn equinox 2025-05-06 (this model: 2025-05-08).
 *  - Saturn oppositions 2024-09-08, 2025-09-21, 2026-10-04 … (JPL Horizons).
 *  - Next Saturn solstice ~2032 (2017-05 + half a Saturn season) — outside ±5 yr.
 *  - Titan shadow-transit season Nov 2024 – Oct 2025 around the equinox.
 */

import { Vector3 } from 'three';
import { elementsToPosition, meanAnomalyAt } from '../orbital/kepler.ts';
import { sunDirectionAt } from './sunDirection.ts';
import { EARTH_HELIOCENTRIC, KM_PER_UNIT, MOONS, SATURN, SATURN_HELIOCENTRIC } from './saturn.ts';

const DAY = 1; // Julian days
const YEAR = 365.25;
/** Half-width of the browsing window, in years, centred on "now". */
export const WINDOW_YEARS = 5;

const AU_KM = 149597870.7;
const REQ = SATURN.physical.radiusKm / KM_PER_UNIT; // scene units
const TITAN = MOONS.find((m) => m.id === 'titan')!;
const ENCELADUS = MOONS.find((m) => m.id === 'enceladus')!;
const R_TITAN = TITAN.physical.radiusKm / KM_PER_UNIT;

export type EventCategory =
  | 'equinox' | 'solstice' | 'opposition' | 'titan-transit' | 'apoapsis';

export interface SaturnEvent {
  category: EventCategory;
  /** Short display name. */
  name: string;
  /** Julian Date of the event. */
  jd: number;
  /** Body id to frame on jump. */
  focus: string;
  /** Suggested SimClock speed (signed simulated seconds per real second). */
  speed: number;
  /** Suggested pause state on arrival (freeze a fast apex). */
  paused: boolean;
  /**
   * True when the category has no occurrence inside the ±5-year window and this
   * entry was found by an extended sweep (labelled, not hidden, so the category
   * never reads as empty).
   */
  rare?: boolean;
}

// --- tiny numeric helpers ----------------------------------------------------

const _sd = new Vector3();
/** Sun height above the ring plane at jd (scene frame). Zero at equinox. */
function sunY(jd: number): number {
  return sunDirectionAt(jd, _sd).y;
}

/** Refine a bracketed sign change of f to a root by bisection. */
function bisect(f: (jd: number) => number, a: number, b: number): number {
  let fa = f(a);
  for (let k = 0; k < 48; k++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if ((fa < 0) !== (fm < 0)) { b = m; } else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

const _ps = new Vector3();
const _pe = new Vector3();
/** Heliocentric ecliptic longitude difference Saturn−Earth, wrapped to (−π,π]. */
function saturnEarthLonDiff(jd: number): number {
  const S = elementsToPosition(SATURN_HELIOCENTRIC, jd, _ps);
  const E = elementsToPosition(EARTH_HELIOCENTRIC, jd, _pe);
  let d = Math.atan2(S.z, S.x) - Math.atan2(E.z, E.x);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Saturn–Earth distance at jd, in AU (heliocentric mean elements). */
export function saturnEarthDistanceAU(jd: number): number {
  const S = elementsToPosition(SATURN_HELIOCENTRIC, jd, _ps);
  const E = elementsToPosition(EARTH_HELIOCENTRIC, jd, _pe);
  return Math.hypot(S.x - E.x, S.y - E.y, S.z - E.z) / AU_KM;
}

const _pt = new Vector3();
/**
 * Impact parameter (scene units) of Titan's anti-solar shadow ray against
 * Saturn's centre: < REQ means Titan's shadow lands on the globe. Returns a
 * large sentinel when Titan is on the far side of the Sun line (no transit).
 */
function titanShadowMiss(jd: number): number {
  const T = elementsToPosition(TITAN.elements!, jd, _pt);
  const tx = T.x / KM_PER_UNIT, ty = T.y / KM_PER_UNIT, tz = T.z / KM_PER_UNIT;
  const S = sunDirectionAt(jd, _sd);
  const tStar = tx * S.x + ty * S.y + tz * S.z; // Titan projected onto Sun line
  if (tStar <= 0) return 1e9; // Titan behind Saturn — casts away from the globe
  return Math.hypot(tx - S.x * tStar, ty - S.y * tStar, tz - S.z * tStar);
}

// --- category sweeps ---------------------------------------------------------

/** Equinoxes: sunY sign changes, refined to sunY=0. */
function findEquinoxes(start: number, end: number): SaturnEvent[] {
  const out: SaturnEvent[] = [];
  let prev = sunY(start);
  for (let jd = start + DAY; jd <= end; jd += DAY) {
    const y = sunY(jd);
    if ((prev < 0) !== (y < 0)) {
      const t = bisect(sunY, jd - DAY, jd);
      out.push({ category: 'equinox', name: 'Saturn equinox', jd: t, focus: 'saturn', speed: 86400, paused: false });
    }
    prev = y;
  }
  return out;
}

/**
 * Next solstice at/after `from` via an EXTENDED sweep (the ±5 yr window holds
 * none — 2017 and ~2032 straddle it). A solstice is an extremum of sunY, i.e.
 * a sign change of its slope. Marked rare so the category is labelled, never
 * silently empty.
 */
function findNextSolstice(from: number): SaturnEvent | null {
  const step = 5 * DAY;
  let a = sunY(from), b = sunY(from + step);
  for (let jd = from + 2 * step; jd <= from + 8 * YEAR; jd += step) {
    const c = sunY(jd);
    if ((b - a < 0) !== (c - b < 0)) {
      // Extremum bracketed in [jd−2step, jd]; refine on the slope (central diff).
      const h = 0.25 * DAY;
      const slope = (t: number) => sunY(t + h) - sunY(t - h);
      const t = bisect(slope, jd - 2 * step, jd);
      const north = sunY(t) > 0;
      return {
        category: 'solstice',
        name: `Saturn ${north ? 'northern' : 'southern'} solstice`,
        jd: t, focus: 'saturn', speed: 86400, paused: false, rare: true,
      };
    }
    a = b; b = c;
  }
  return null;
}

/** Oppositions: Saturn−Earth heliocentric longitude crosses zero. */
function findOppositions(start: number, end: number): SaturnEvent[] {
  const out: SaturnEvent[] = [];
  const step = 2 * DAY;
  let prev = saturnEarthLonDiff(start);
  for (let jd = start + step; jd <= end; jd += step) {
    const d = saturnEarthLonDiff(jd);
    // Genuine opposition (near 0), not the ±π conjunction wrap: both ends small.
    if (Math.abs(d) < 1 && Math.abs(prev) < 1 && (prev < 0) !== (d < 0)) {
      const t = bisect(saturnEarthLonDiff, jd - step, jd);
      out.push({ category: 'opposition', name: 'Saturn at opposition', jd: t, focus: 'saturn', speed: 86400, paused: false });
    }
    prev = d;
  }
  return out;
}

/**
 * Titan shadow transits on Saturn's globe. Titan's orbit is nearly in the ring
 * plane, so its shadow only reaches the disk when the Sun sits within a few
 * degrees of that plane — a ±10-month season around each equinox. Restricting
 * the fine (6-hour) sweep to those seasons keeps boot cheap. Deepest transits
 * (smallest impact parameter) are kept, capped, and returned chronologically.
 */
function findTitanTransits(start: number, end: number, equinoxes: SaturnEvent[]): SaturnEvent[] {
  const SEASON = 300 * DAY;
  const step = 0.25 * DAY;
  const found: { jd: number; miss: number }[] = [];
  for (const eq of equinoxes) {
    const a0 = Math.max(start, eq.jd - SEASON);
    const b0 = Math.min(end, eq.jd + SEASON);
    let d0 = titanShadowMiss(a0);
    let d1 = titanShadowMiss(a0 + step);
    for (let jd = a0 + 2 * step; jd <= b0; jd += step) {
      const d2 = titanShadowMiss(jd);
      // Local minimum of the impact parameter, deep enough to land on the globe.
      if (d1 < d0 && d1 <= d2 && d1 < REQ + R_TITAN) {
        found.push({ jd: jd - step, miss: d1 });
      }
      d0 = d1; d1 = d2;
    }
  }
  // Keep the six most central transits; present them in time order.
  found.sort((p, q) => p.miss - q.miss);
  return found.slice(0, 6)
    .sort((p, q) => p.jd - q.jd)
    .map((t) => ({
      category: 'titan-transit' as const,
      name: 'Titan shadow transit', jd: t.jd, focus: 'saturn', speed: 60, paused: false,
    }));
}

/**
 * The NEXT Enceladus apoapsis strictly after `fromJd`. Apoapsis is mean
 * anomaly = π; solve for the first crossing forward in time. Recomputed on
 * demand (recurring — never enumerated). Jumping there frames Enceladus at 1
 * min/s, when the tidal flexing peaks its plumes (F9.2).
 */
export function nextEnceladusApoapsis(fromJd: number): SaturnEvent {
  const el = ENCELADUS.elements!;
  const n = (2 * Math.PI) / el.periodDays; // rad/day
  const M = meanAnomalyAt(el, fromJd); // ∈ [0, 2π)
  // Days until M next reaches π.
  let dTheta = Math.PI - M;
  if (dTheta <= 0) dTheta += 2 * Math.PI;
  const jd = fromJd + dTheta / n;
  return {
    category: 'apoapsis', name: 'Enceladus apoapsis', jd,
    focus: 'enceladus', speed: 60, paused: false,
  };
}

/**
 * Full one-off event list for the ±5-year window centred on `nowJd`, sorted
 * chronologically. The recurring Enceladus apoapsis is NOT included here — the
 * HUD adds it separately via nextEnceladusApoapsis so it always reflects the
 * live simulated time.
 */
export function scanEvents(nowJd: number): SaturnEvent[] {
  const start = nowJd - WINDOW_YEARS * YEAR;
  const end = nowJd + WINDOW_YEARS * YEAR;
  const equinoxes = findEquinoxes(start, end);
  const events: SaturnEvent[] = [
    ...equinoxes,
    ...findOppositions(start, end),
    ...findTitanTransits(start, end, equinoxes),
  ];
  const sol = findNextSolstice(nowJd);
  if (sol) events.push(sol);
  events.sort((a, b) => a.jd - b.jd);
  return events;
}
