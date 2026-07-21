/**
 * Direction of the Sun as seen from Saturn, expressed in the scene frame
 * (Saturn's equatorial frame, pole = +Y). Drives lighting, seasons and the
 * ring-shadow geometry for the simulated date.
 */

import { Vector3, Matrix4 } from 'three';
import { elementsToPosition } from '../orbital/kepler.ts';
import { SATURN_HELIOCENTRIC, SATURN_POLE } from './saturn.ts';

const DEG = Math.PI / 180;
const OBLIQUITY = 23.43928 * DEG; // Earth obliquity: ICRF equatorial -> ecliptic
const AU_KM = 149597870.7; // 1 astronomical unit in km

/**
 * Saturn's mean heliocentric distance (semi-major axis), AU. The reference for
 * the (mean/r)² irradiance and mean/r apparent-size scaling; irradiance = 1 here.
 */
export const SATURN_MEAN_DISTANCE_AU = SATURN_HELIOCENTRIC.aKm / AU_KM;

/** Saturn's pole as a unit vector in ecliptic coordinates (Y-up scene style). */
function saturnPoleEcliptic(): Vector3 {
  const ra = SATURN_POLE.raDeg * DEG;
  const dec = SATURN_POLE.decDeg * DEG;
  // ICRF equatorial frame (x toward vernal equinox, z celestial north).
  const eq = new Vector3(
    Math.cos(dec) * Math.cos(ra),
    Math.cos(dec) * Math.sin(ra),
    Math.sin(dec),
  );
  // Rotate about x by -obliquity: equatorial -> ecliptic.
  const ec = new Vector3(
    eq.x,
    Math.cos(OBLIQUITY) * eq.y + Math.sin(OBLIQUITY) * eq.z,
    -Math.sin(OBLIQUITY) * eq.y + Math.cos(OBLIQUITY) * eq.z,
  );
  // Map math frame (z-up) to scene-style Y-up: (x, z, -y).
  return new Vector3(ec.x, ec.z, -ec.y).normalize();
}

/** Rotation taking ecliptic (Y-up) vectors into Saturn's equatorial frame. */
function eclipticToSaturnFrame(): Matrix4 {
  const y = saturnPoleEcliptic();
  // X axis: ascending node of Saturn's equator on the ICRF equator — the
  // direction JPL's satellite mean elements measure nodeDeg from. This keeps
  // the Sun's azimuth consistent with the moons' node angles.
  const ra = SATURN_POLE.raDeg * DEG;
  const dec = SATURN_POLE.decDeg * DEG;
  const p = new Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
  const nEq = new Vector3(0, 0, 1).cross(p); // z_ICRF × pole (exactly ⊥ pole)
  // Same equatorial -> ecliptic rotation and Y-up mapping as saturnPoleEcliptic().
  const nEc = new Vector3(
    nEq.x,
    Math.cos(OBLIQUITY) * nEq.y + Math.sin(OBLIQUITY) * nEq.z,
    -Math.sin(OBLIQUITY) * nEq.y + Math.cos(OBLIQUITY) * nEq.z,
  );
  const x = new Vector3(nEc.x, nEc.z, -nEc.y).normalize();
  const z = new Vector3().crossVectors(x, y);
  // Columns are the saturn-frame axes in ecliptic coords; we need the inverse
  // (= transpose) to convert ecliptic vectors into the saturn frame.
  return new Matrix4().makeBasis(x, y, z).transpose();
}

const ECL_TO_SATURN = eclipticToSaturnFrame();

/** Unit vector pointing from Saturn toward the Sun, scene frame. */
export function sunDirectionAt(jd: number, out = new Vector3()): Vector3 {
  const p = elementsToPosition(SATURN_HELIOCENTRIC, jd);
  // Saturn position (ecliptic, Y-up scene mapping); Sun is the opposite way.
  out.set(-p.x, -p.y, -p.z).normalize();
  return out.applyMatrix4(ECL_TO_SATURN);
}

/**
 * Saturn's heliocentric distance at jd, AU. Varies ≈9.02 (perihelion) to
 * ≈10.05 (aphelion) over the 29.5 yr orbit (e≈0.054), swinging solar
 * irradiance ×1.24 peak-to-peak and the Sun's apparent diameter ±5.5%.
 * Complements sunDirectionAt, which normalizes this distance away.
 */
export function saturnSunDistanceAU(jd: number): number {
  const p = elementsToPosition(SATURN_HELIOCENTRIC, jd);
  return Math.hypot(p.x, p.y, p.z) / AU_KM;
}

/**
 * Rotation taking ICRF (equatorial RA/Dec) directions into the scene frame.
 * Used to orient a real celestial-sphere starmap so the Milky Way sits where
 * it actually is as seen from Saturn.
 */
export function icrfToSceneMatrix(): Matrix4 {
  // ICRF (z-up math frame) -> ecliptic (z-up): rotate about x by -obliquity.
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  const eqToEcl = new Matrix4().set(
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  );
  // Math z-up -> scene Y-up mapping: (x, y, z) -> (x, z, -y).
  const zUpToYUp = new Matrix4().set(
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, -1, 0, 0,
    0, 0, 0, 1,
  );
  return new Matrix4().multiplyMatrices(ECL_TO_SATURN, new Matrix4().multiplyMatrices(zUpToYUp, eqToEcl));
}
