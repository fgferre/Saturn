/**
 * Seasonal forcing for Saturn's hemispheric hue (F9.3), as a PURE function of
 * the simulated date — no state, no filtering. A time-constant filter in the
 * render loop would give the wrong hue under time-scrub / reverse playback
 * (F12.1), so the lag is baked in by evaluating the sub-solar latitude at
 * `jd − lag` instead of low-pass filtering the present value.
 *
 * Cassini record: the hemisphere in WINTER turns blue (less UV → less
 * photochemical haze → Rayleigh scattering dominates). The north was blue in
 * 2004–05 (northern winter), golden by the 2017 solstice; after the 2025
 * equinox the north heads back toward autumn/winter and blues again. The haze
 * lags the insolation by ~1–2 years (PIA21345).
 */

import { Vector3 } from 'three';
import { sunDirectionAt } from './sunDirection.ts';

/**
 * Haze response lag behind insolation. ~1.75 yr keeps the hue turn trailing
 * the solstice/equinox as Cassini observed. ⚠ VERIFICAR: lag magnitude
 * (PIA21345 discussion cites 1–2 yr; exact value is not published).
 */
export const SEASONAL_LAG_DAYS = 1.75 * 365.25; // ≈ 639 d

const scratch = new Vector3();

/**
 * Signed seasonal forcing at `jd`: +value ⇒ the NORTHERN hemisphere is in
 * winter (blues), −value ⇒ the SOUTHERN hemisphere is in winter. Magnitude is
 * the lagged sub-solar latitude sine, peaking at sin(obliquity) ≈ 0.45 at
 * solstice and passing through 0 near equinox. Pure and deterministic:
 * depends only on `jd`.
 */
export function seasonalTilt(jd: number): number {
  // S.y > 0 ⇒ sun north of the equator ⇒ northern SUMMER ⇒ north not blue,
  // so the winter-blue forcing is the negated, lagged sub-solar latitude.
  return -sunDirectionAt(jd - SEASONAL_LAG_DAYS, scratch).y;
}
