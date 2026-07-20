/**
 * Keplerian two-body propagation. Pure math, no rendering dependencies.
 *
 * Frames: elements are given relative to a parent reference plane (X toward
 * the reference direction, Z = pole/normal of the plane). The returned
 * position is converted to a Y-up right-handed scene frame:
 *   scene.x = ref.x, scene.y = ref.z (pole), scene.z = -ref.y
 * so orbits with i=0 lie in the scene XZ plane, counter-clockwise seen
 * from +Y (prograde).
 */

import type { OrbitalElements, Vec3 } from './types.ts';

const DEG = Math.PI / 180;

/** Solve Kepler's equation M = E - e·sin(E) for E (radians). */
export function solveKepler(meanAnomaly: number, e: number): number {
  const M = meanAnomaly;
  // Newton–Raphson with a good starter; converges fast for e < 0.95.
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 12; k++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  return E;
}

/** Mean anomaly (radians, normalized) at the given Julian Date. */
export function meanAnomalyAt(el: OrbitalElements, jd: number): number {
  const n = (2 * Math.PI) / el.periodDays; // rad/day
  const M = el.m0Deg * DEG + n * (jd - el.epochJD);
  return ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Position at time jd in the scene frame described above, in the same
 * length unit as el.aKm (i.e. kilometers).
 */
export function elementsToPosition(el: OrbitalElements, jd: number, out?: Vec3): Vec3 {
  const M = meanAnomalyAt(el, jd);
  const E = solveKepler(M, el.e);

  // Perifocal coordinates.
  const xp = el.aKm * (Math.cos(E) - el.e);
  const yp = el.aKm * Math.sqrt(1 - el.e * el.e) * Math.sin(E);

  // Rotate perifocal -> reference frame: Rz(node) · Rx(i) · Rz(peri).
  const cO = Math.cos(el.nodeDeg * DEG), sO = Math.sin(el.nodeDeg * DEG);
  const ci = Math.cos(el.iDeg * DEG), si = Math.sin(el.iDeg * DEG);
  const cw = Math.cos(el.periDeg * DEG), sw = Math.sin(el.periDeg * DEG);

  const x1 = cw * xp - sw * yp;
  const y1 = sw * xp + cw * yp;

  const x2 = x1;
  const y2 = ci * y1;
  const z2 = si * y1;

  const xr = cO * x2 - sO * y2;
  const yr = sO * x2 + cO * y2;
  const zr = z2;

  const o = out ?? { x: 0, y: 0, z: 0 };
  o.x = xr;
  o.y = zr;
  o.z = -yr;
  return o;
}

/** True anomaly + orbital angle helper (used for tidal locking orientation). */
export function orbitalAngleAt(el: OrbitalElements, jd: number): number {
  const M = meanAnomalyAt(el, jd);
  const E = solveKepler(M, el.e);
  const nu = 2 * Math.atan2(
    Math.sqrt(1 + el.e) * Math.sin(E / 2),
    Math.sqrt(1 - el.e) * Math.cos(E / 2),
  );
  // Angle of the position vector in the scene XZ plane, measured from +X
  // toward -Z (prograde as seen from +Y). Includes node/peri offsets only
  // approximately for inclined orbits — fine for facing the parent body.
  return nu + (el.periDeg + el.nodeDeg) * DEG;
}

/** Sampled orbit path (one full revolution) for drawing orbit lines. */
export function sampleOrbit(el: OrbitalElements, segments = 256): Vec3[] {
  const pts: Vec3[] = [];
  const saved = { ...el };
  for (let s = 0; s <= segments; s++) {
    // Sweep mean anomaly through a full turn at the epoch.
    const jd = saved.epochJD + (s / segments) * saved.periodDays - (saved.m0Deg / 360) * saved.periodDays;
    pts.push(elementsToPosition(saved, jd));
  }
  return pts;
}
