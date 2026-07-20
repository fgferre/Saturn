/**
 * Analytic eclipse/shadow physics (CPU side, per frame — a handful of ray
 * tests, negligible cost):
 *
 * - saturnShadowOnMoon: how much sunlight reaches a moon, accounting for
 *   Saturn's oblate umbra (with penumbra from the Sun's angular size) and
 *   for sunlight filtered through the rings (real ring opacity profile).
 *
 * Moon-shadow transits on Saturn's globe and rings are computed in-shader
 * from the shared moon uniforms (see sharedUniforms.ts).
 */

import { Vector3 } from 'three';
import { KM_PER_UNIT, SATURN } from '../data/saturn.ts';

/** Sun angular radius at Saturn (~9.5 AU): ~0.028°. */
export const SUN_ANGULAR_RADIUS = 0.000497; // radians

const REQ = SATURN.physical.radiusKm / KM_PER_UNIT;
const Y_SCALE = SATURN.physical.radiusKm / (SATURN.physical.polarRadiusKm ?? SATURN.physical.radiusKm);

const q = new Vector3();
const sScaled = new Vector3();

/**
 * Fraction of sunlight reaching a moon at `pos` (scene units) for sun
 * direction `sunDir`. `ringOpacityAt(km)` supplies ring optical blocking
 * for the ray toward the Sun.
 */
export function saturnShadowOnMoon(
  pos: Vector3,
  sunDir: Vector3,
  ringOpacityAt: (km: number) => number,
): number {
  // Work in the sphere-ized space of Saturn's oblate ellipsoid.
  q.set(pos.x, pos.y * Y_SCALE, pos.z);
  sScaled.set(sunDir.x, sunDir.y * Y_SCALE, sunDir.z).normalize();

  let light = 1;

  // --- Saturn's umbra/penumbra ---
  const tStar = -q.dot(sScaled);
  if (tStar > 0) {
    const dMin = Math.hypot(
      q.x + sScaled.x * tStar,
      q.y + sScaled.y * tStar,
      q.z + sScaled.z * tStar,
    );
    // Penumbra half-width grows with distance behind the planet.
    const pen = tStar * SUN_ANGULAR_RADIUS + 0.02;
    const x = (dMin - REQ) / pen; // <0 umbra, >1 clear
    const f = Math.min(1, Math.max(0, x));
    light *= f * f * (3 - 2 * f);
  }

  // --- Ring shadow: where does the ray to the Sun cross the ring plane? ---
  if (Math.abs(sunDir.y) > 1e-6) {
    const t = -pos.y / sunDir.y;
    if (t > 0) {
      const hx = pos.x + sunDir.x * t;
      const hz = pos.z + sunDir.z * t;
      const rKm = Math.hypot(hx, hz) * KM_PER_UNIT;
      light *= 1 - ringOpacityAt(rKm) * 0.92;
    }
  }

  return light;
}
