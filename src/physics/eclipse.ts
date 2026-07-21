/**
 * Analytic eclipse/shadow physics (CPU side, per frame — a handful of ray
 * tests, negligible cost):
 *
 * - saturnShadowOnMoon: how much sunlight reaches a moon, accounting for
 *   Saturn's oblate umbra (with penumbra from the Sun's angular size) and
 *   for sunlight filtered through the rings (real ring opacity profile).
 * - sunVisibilityFromCamera: fraction of the solar disk visible from a point
 *   (lens-flare / glare gate), including moon occultations.
 * - solarAtmosphereTint: Rayleigh-ish reddening when the LOS grazes Saturn's
 *   atmosphere (sunset colour on the display disk).
 *
 * Moon-shadow transits on Saturn's globe and rings are computed in-shader
 * from the shared moon uniforms (see sharedUniforms.ts).
 */

import { Vector3 } from 'three';
import { KM_PER_UNIT, SATURN } from '../data/saturn.ts';

/** Sun angular radius at Saturn (~9.5 AU): ~0.028° (diameter ~0.057°). */
export const SUN_ANGULAR_RADIUS = 0.000497; // radians

const REQ = SATURN.physical.radiusKm / KM_PER_UNIT;
const Y_SCALE = SATURN.physical.radiusKm / (SATURN.physical.polarRadiusKm ?? SATURN.physical.radiusKm);
/** Outer haze shell used by Saturn's raymarched atmosphere (~2.5% above Req). */
const RA_ATM = REQ * 1.025;

const q = new Vector3();
const sScaled = new Vector3();
const tmp = new Vector3();

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

export interface MoonDisk {
  pos: Vector3;
  radius: number;
}

/**
 * Soft disk occultation of the Sun by a sphere of radius `rM` at position
 * `moonPos`, as seen from `cam` looking along `sunDir` (unit, toward the Sun).
 * Same geometry family as moonTransits.ts.
 */
function moonOccultsSun(
  cam: Vector3,
  sunDir: Vector3,
  moonPos: Vector3,
  rM: number,
): number {
  if (rM <= 0) return 0;
  tmp.copy(moonPos).sub(cam);
  const t = tmp.dot(sunDir);
  if (t <= 1e-4) return 0;
  const perp = Math.hypot(
    tmp.x - sunDir.x * t,
    tmp.y - sunDir.y * t,
    tmp.z - sunDir.z * t,
  );
  const rSun = Math.max(t * SUN_ANGULAR_RADIUS, 1e-4);
  // smoothstep(rM - rSun, rM + rSun, perp) → 0 inside full occultation disk
  const e0 = rM - rSun;
  const e1 = rM + rSun;
  const u = (perp - e0) / Math.max(e1 - e0, 1e-6);
  const s = u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
  const occ = 1 - s;
  // Full depth when the moon is larger than the solar disk (total eclipse).
  const depth = Math.min(1, (rM / rSun) * (rM / rSun));
  return Math.min(1, occ * depth);
}

/**
 * Fraction of the solar disk visible from `cam` looking toward `sunDir`.
 * Combines Saturn umbra/rings with moon occultations (solar eclipses in fly-by).
 */
export function sunVisibilityFromCamera(
  cam: Vector3,
  sunDir: Vector3,
  ringOpacityAt: (km: number) => number,
  moons: readonly MoonDisk[],
): number {
  let v = saturnShadowOnMoon(cam, sunDir, ringOpacityAt);
  for (const m of moons) {
    v *= 1 - moonOccultsSun(cam, sunDir, m.pos, m.radius);
    if (v < 1e-4) return 0;
  }
  return Math.min(1, Math.max(0, v));
}

/**
 * RGB transmittance of a grazing LOS from `cam` toward `sunDir` through
 * Saturn's haze shell (analytic, no raymarch). Used to redden the display
 * disk near sunrise/sunset without a new pass.
 *
 * Writes into `out` and returns it.
 */
export function solarAtmosphereTint(
  cam: Vector3,
  sunDir: Vector3,
  out = new Vector3(1, 1, 1),
): Vector3 {
  // Sphere-ized coordinates (oblate → sphere of radius REQ).
  q.set(cam.x, cam.y * Y_SCALE, cam.z);
  sScaled.set(sunDir.x, sunDir.y * Y_SCALE, sunDir.z).normalize();

  // Closest approach of the ray cam + t·sunDir to the origin.
  const tClosest = -q.dot(sScaled);
  const cx = q.x + sScaled.x * Math.max(tClosest, 0);
  const cy = q.y + sScaled.y * Math.max(tClosest, 0);
  const cz = q.z + sScaled.z * Math.max(tClosest, 0);
  const b = Math.hypot(cx, cy, cz);

  // Far outside the haze — no tint.
  if (b >= RA_ATM) return out.set(1, 1, 1);

  // Chord lengths through outer shell and solid body.
  const outerChord = 2 * Math.sqrt(Math.max(0, RA_ATM * RA_ATM - b * b));
  const bodyChord = b < REQ ? 2 * Math.sqrt(Math.max(0, REQ * REQ - b * b)) : 0;
  const atmPath = Math.max(0, outerChord - bodyChord) / REQ;

  // Strong grazing extinction so (tint × SUN_DISPLAY_RADIANCE) falls into the
  // AgX shoulder as orange before extinguishing — weak k left the disk white.
  // Rayleigh-ish: shorter wavelengths scatter more → redder transmission.
  const k = 22 * atmPath;
  out.set(
    Math.exp(-0.38 * k),
    Math.exp(-0.70 * k),
    Math.exp(-1.35 * k),
  );
  return out;
}
