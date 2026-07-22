import { J2000 } from '../orbital/types.ts';

/** Equatorial cloud texture lap used by Saturn's artistic zonal-flow model. */
export const CLOUD_LAP_DAYS = 9.75;

/**
 * Radix used to split the long-running cloud phase into two exactly
 * reconstructible f32-friendly values. The shader reduces the coarse product
 * modulo one before adding the fine product, so texture coordinates never grow
 * large enough to quantize into visible steps.
 */
export const CLOUD_PHASE_RADIX = 64;

export interface CloudPhaseParts {
  coarse: number;
  fine: number;
}

/**
 * Deterministic, continuous cloud phase relative to J2000.
 *
 * `coarse * CLOUD_PHASE_RADIX + fine` is the total number of equatorial laps.
 * `fine` always stays in [0, CLOUD_PHASE_RADIX), including before J2000.
 */
export function splitCloudPhase(jd: number): CloudPhaseParts {
  const total = (jd - J2000) / CLOUD_LAP_DAYS;
  const coarse = Math.floor(total / CLOUD_PHASE_RADIX);
  return {
    coarse,
    fine: total - coarse * CLOUD_PHASE_RADIX,
  };
}
