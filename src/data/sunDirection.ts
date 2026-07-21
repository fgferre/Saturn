/**
 * Direction of the Sun as seen from Saturn, expressed in the scene frame
 * (Saturn's equatorial frame, pole = +Y). Drives lighting, seasons and the
 * ring-shadow geometry for the simulated date.
 */

import { Vector3, Matrix4 } from 'three';
import { elementsToPosition } from '../orbital/kepler.ts';
import { EARTH_HELIOCENTRIC, SATURN_HELIOCENTRIC, SATURN_POLE } from './saturn.ts';

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

/**
 * Rotation taking ecliptic (Y-up scene) vectors into Saturn's equatorial
 * frame. Exported for the irregular-satellite frame conversion (Phoebe, F11.1),
 * whose JPL mean elements are referred to the ecliptic while `data/saturn.ts`
 * stores everything in Saturn's equatorial frame.
 */
export const ECL_TO_SATURN = eclipticToSaturnFrame();

/** Orbit-orientation angles (degrees). a/e/M0/period are frame-independent. */
export interface OrbitOrientation {
  iDeg: number;
  nodeDeg: number;
  periDeg: number;
}

// z-up reference frame (the frame kepler.ts uses before its scene mapping)
// ↔ scene Y-up mapping. kepler maps ref (a,b,c) → scene (a, c, −b).
const refToScene = (v: Vector3): Vector3 => new Vector3(v.x, v.z, -v.y);
const sceneToRef = (v: Vector3): Vector3 => new Vector3(v.x, -v.z, v.y);

/**
 * Convert an orbit's orientation (inclination, ascending node, argument of
 * periapsis) from the ecliptic reference frame to Saturn's equatorial frame.
 *
 * JPL SSD lists irregular satellites (Phoebe) in the ecliptic; copying i≈175°
 * straight into the equatorial table would mis-orient the plane by Saturn's
 * ~26.7° obliquity. We build the periapsis (P) and orbit-normal (W) unit
 * vectors, rotate them through ECL_TO_SATURN, then re-extract the three angles —
 * the node moves, so the argument of periapsis is recomputed from the *new*
 * node (gotcha §15). a, e, M0 and the period are unchanged by a pure rotation.
 */
export function eclipticOrbitToSaturnFrame(o: OrbitOrientation): OrbitOrientation {
  const i = o.iDeg * DEG, O = o.nodeDeg * DEG, w = o.periDeg * DEG;
  const cO = Math.cos(O), sO = Math.sin(O);
  const ci = Math.cos(i), si = Math.sin(i);
  const cw = Math.cos(w), sw = Math.sin(w);
  // Standard perifocal → reference unit vectors (ecliptic z-up frame).
  const P = new Vector3(cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si);
  const W = new Vector3(sO * si, -cO * si, ci); // orbit normal (ang. momentum)
  // Rotate both into Saturn's equatorial frame via the scene-vector matrix.
  const Ps = sceneToRef(refToScene(P).applyMatrix4(ECL_TO_SATURN));
  const Ws = sceneToRef(refToScene(W).applyMatrix4(ECL_TO_SATURN));
  // Re-extract angles. i' from the normal's z; node from n = ẑ × W = (−Wy,Wx,0).
  const iOut = Math.acos(Math.max(-1, Math.min(1, Ws.z)));
  const n = new Vector3(-Ws.y, Ws.x, 0);
  const nodeOut = Math.atan2(n.y, n.x);
  const nLen = n.length();
  const nHat = nLen > 1e-9 ? n.clone().multiplyScalar(1 / nLen) : new Vector3(1, 0, 0);
  // In-plane basis at the node: nHat, and bHat = W × nHat (direction of motion,
  // so ω is signed correctly for retrograde orbits too). P = cosω·n̂ + sinω·b̂.
  const bHat = new Vector3().crossVectors(Ws, nHat);
  const periOut = Math.atan2(Ps.dot(bHat), Ps.dot(nHat));
  const norm = (r: number): number => (((r / DEG) % 360) + 360) % 360;
  return { iDeg: iOut / DEG, nodeDeg: norm(nodeOut), periDeg: norm(periOut) };
}

/** Unit vector pointing from Saturn toward the Sun, scene frame. */
export function sunDirectionAt(jd: number, out = new Vector3()): Vector3 {
  const p = elementsToPosition(SATURN_HELIOCENTRIC, jd);
  // Saturn position (ecliptic, Y-up scene mapping); Sun is the opposite way.
  out.set(-p.x, -p.y, -p.z).normalize();
  return out.applyMatrix4(ECL_TO_SATURN);
}

const _earthDirS = new Vector3();
const _earthDirE = new Vector3();

/**
 * Unit vector pointing from Saturn toward the Earth, scene frame (F12.1b, the
 * "Pale Blue Dot"). Both bodies are propagated in the same ecliptic (Y-up)
 * frame and the difference is rotated by the very ECL_TO_SATURN that
 * `sunDirectionAt` uses — so the Earth lands at its true elongation from the
 * Sun (≤ ~6° as seen from Saturn: it is always near the Sun in Saturn's sky,
 * which is why the iconic Cassini frame has the Sun eclipsed by the planet).
 */
export function earthDirectionAt(jd: number, out = new Vector3()): Vector3 {
  elementsToPosition(SATURN_HELIOCENTRIC, jd, _earthDirS);
  elementsToPosition(EARTH_HELIOCENTRIC, jd, _earthDirE);
  out.copy(_earthDirE).sub(_earthDirS).normalize();
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
