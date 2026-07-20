/** Runnable sanity check: `npm run check`. Fails loudly if the math breaks. */
import { elementsToPosition, solveKepler, meanAnomalyAt } from './kepler.ts';
import { J2000, type OrbitalElements } from './types.ts';

// Tiny local assert to avoid needing @types/node just for this file.
const assert = {
  ok(cond: unknown, msg: string): void {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  },
};

const circ: OrbitalElements = {
  aKm: 1000, e: 0, iDeg: 0, nodeDeg: 0, periDeg: 0, m0Deg: 0,
  periodDays: 10, epochJD: J2000,
};

// Circular orbit stays at radius a and lies in the XZ plane.
for (let d = 0; d < 10; d += 0.7) {
  const p = elementsToPosition(circ, J2000 + d);
  const r = Math.hypot(p.x, p.y, p.z);
  assert.ok(Math.abs(r - 1000) < 1e-6, `circular radius drifted: ${r}`);
  assert.ok(Math.abs(p.y) < 1e-9, `circular orbit left the plane: ${p.y}`);
}

// Full period returns to the starting point.
const p0 = elementsToPosition(circ, J2000);
const p1 = elementsToPosition(circ, J2000 + 10);
assert.ok(Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z) < 1e-6, 'orbit not periodic');

// Prograde: quarter period from +X should move toward -Z (CCW from +Y / north).
const pq = elementsToPosition(circ, J2000 + 2.5);
assert.ok(pq.z < -999, `orbit not prograde: ${JSON.stringify(pq)}`);

// Eccentric orbit: radius bounded by periapsis/apoapsis, reached at M=0 and M=π.
const ecc: OrbitalElements = { ...circ, e: 0.3 };
const peri = elementsToPosition(ecc, J2000);
assert.ok(Math.abs(Math.hypot(peri.x, peri.y, peri.z) - 700) < 1e-6, 'periapsis wrong');
const apo = elementsToPosition(ecc, J2000 + 5);
assert.ok(Math.abs(Math.hypot(apo.x, apo.y, apo.z) - 1300) < 1e-6, 'apoapsis wrong');

// Kepler solver converges at high eccentricity across the whole turn.
for (let M = 0; M < 2 * Math.PI; M += 0.05) {
  const E = solveKepler(M, 0.95);
  assert.ok(Math.abs(E - 0.95 * Math.sin(E) - M) < 1e-8, `solver diverged at M=${M}`);
}

// Inclined orbit leaves the plane but keeps |r| = a for e=0.
const inc = elementsToPosition({ ...circ, iDeg: 45, m0Deg: 90 }, J2000);
assert.ok(Math.abs(inc.y) > 100, 'inclined orbit stayed flat');
assert.ok(Math.abs(Math.hypot(inc.x, inc.y, inc.z) - 1000) < 1e-6, 'inclined radius wrong');

// Mean anomaly stays normalized far from epoch.
const M = meanAnomalyAt(circ, J2000 + 1e6);
assert.ok(M >= 0 && M < 2 * Math.PI, 'mean anomaly not normalized');

console.log('kepler selfcheck: all assertions passed');
