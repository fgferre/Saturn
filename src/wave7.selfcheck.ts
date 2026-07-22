/**
 * Onda 8 / F11.1 self-check — minor moons + Phoebe. Run via `npm run check`.
 *
 * Contract this file pins:
 *  - Phoebe's orbit is retrograde (i > 90°, clockwise seen from +Y) and its
 *    equatorial i/node/peri are the frame-converted ecliptic elements (§15).
 *  - Janus/Epimetheus share a period (co-rotating pair, decision b) yet sit
 *    apart in longitude (never interpenetrate).
 *  - MINOR_MOONS is separate from MOONS and claims NO shadow slot
 *    (MOON_SHADOW_COUNT stays 8).
 *  - Inner-moon periods obey Kepler's third law; Phoebe fits inside the orbit.
 *  - Every CPU-deformed icosphere is welded before normal recomputation, so
 *    Hyperion and all eight minor moons use continuous rather than flat normals.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IcosahedronGeometry, Vector3 } from 'three';
import { MINOR_MOONS, MOONS, PHOEBE_ECLIPTIC } from './data/saturn.ts';
import { ECL_TO_SATURN, eclipticOrbitToSaturnFrame } from './data/sunDirection.ts';
import { elementsToPosition } from './orbital/kepler.ts';
import { MOON_SHADOW_COUNT } from './materials/sharedUniforms.ts';
import { ORBIT_MAX_DISTANCE } from './camera/FocusControls.ts';
import { J2000 } from './orbital/types.ts';
import { weldProceduralMoonGeometry } from './scene/proceduralMoonGeometry.ts';

const DEG = Math.PI / 180;
const KM_PER_UNIT = 1000;

const assert = {
  ok(cond: unknown, msg: string): void {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  },
  near(a: number, b: number, eps: number, msg: string): void {
    if (!Number.isFinite(a) || Math.abs(a - b) > eps) {
      throw new Error(`ASSERT FAILED: ${msg} (${a} vs ${b})`);
    }
  },
};

const byId = (id: string) => MINOR_MOONS.find((m) => m.id === id)!;

// --- deformed icospheres: indexed shared vertices + smooth normals -----------
{
  const source = new IcosahedronGeometry(1, 4);
  const beforePositions = source.attributes.position.count;
  const pos = source.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setY(i, y * (1 + 0.12 * pos.getX(i)));
  }

  const welded = weldProceduralMoonGeometry(source);
  const position = welded.attributes.position;
  const normal = welded.attributes.normal;
  assert.ok(welded.index !== null, 'deformed moon geometry is indexed after welding');
  assert.ok(position.count < beforePositions, 'coincident polyhedron positions are shared');
  assert.ok(welded.index!.count === beforePositions, 'welding preserves every source triangle');
  assert.ok(normal.count === position.count, 'every shared position has one smooth normal');
  assert.ok(welded.getAttribute('uv') === undefined, 'procedural moon geometry carries no UV seam');
  assert.ok(welded.boundingSphere !== null, 'welded geometry refreshes its bounding sphere');
  for (let i = 0; i < normal.count; i++) {
    const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
    assert.near(length, 1, 1e-5, `normal ${i} is unit length`);
  }
}

// --- table shape: 8 minors, separate from the 8 majors, no extra slots -------
{
  assert.ok(MINOR_MOONS.length === 8, 'exactly 8 minor moons');
  assert.ok(MOON_SHADOW_COUNT === 8, 'MOON_SHADOW_COUNT stays 8 (majors only)');
  assert.ok(MOONS.length === MOON_SHADOW_COUNT, 'majors exactly fill the shadow slots');
  const majorIds = new Set(MOONS.map((m) => m.id));
  for (const m of MINOR_MOONS) {
    assert.ok(!majorIds.has(m.id), `${m.id} must not also be a major moon`);
    assert.ok(m.elements, `${m.id} has orbital elements`);
  }
  const expected = ['pan', 'daphnis', 'atlas', 'prometheus', 'pandora', 'janus', 'epimetheus', 'phoebe'];
  assert.ok(expected.every((id) => MINOR_MOONS.some((m) => m.id === id)), 'all 8 named bodies present');
}

// --- Kepler's third law: inner moons (Pan..Janus) share T²/a³ ----------------
// Epimetheus is EXCLUDED: its period is forced equal to Janus (decision b), so
// it deliberately departs from its own Keplerian period by ~0.1%.
{
  const inner = ['pan', 'daphnis', 'atlas', 'prometheus', 'pandora', 'janus'];
  const ks = inner.map((id) => {
    const el = byId(id).elements!;
    return (el.periodDays ** 2) / ((el.aKm / KM_PER_UNIT) ** 3);
  });
  const mean = ks.reduce((a, b) => a + b, 0) / ks.length;
  for (let i = 0; i < ks.length; i++) {
    assert.near(ks[i] / mean, 1, 0.01, `${inner[i]} obeys Kepler T²∝a³ within 1%`);
  }
}

// --- Janus / Epimetheus: equal period, fixed non-zero longitude gap ----------
{
  const janus = byId('janus').elements!;
  const epi = byId('epimetheus').elements!;
  assert.near(janus.periodDays, epi.periodDays, 0, 'Janus/Epimetheus periods are EQUAL (co-rotating pair)');
  // Fixed longitude separation ⇒ the meshes never collide. Check the angular
  // gap in the XZ plane is comfortably larger than their summed angular size.
  const jr = byId('janus').physical.radiusKm;
  const er = byId('epimetheus').physical.radiusKm;
  let minSep = Infinity;
  for (let d = 0; d < janus.periodDays * 4; d += 0.05) {
    const pj = elementsToPosition(janus, J2000 + d);
    const pe = elementsToPosition(epi, J2000 + d);
    minSep = Math.min(minSep, Math.hypot(pj.x - pe.x, pj.y - pe.y, pj.z - pe.z));
  }
  assert.ok(minSep > (jr + er) * 5, `co-orbital twins stay well apart (min sep ${minSep.toFixed(0)} km ≫ ${(jr + er).toFixed(0)} km)`);
}

// --- Phoebe: frame conversion matches the table (gotcha §15) -----------------
{
  const ph = byId('phoebe').elements!;
  const conv = eclipticOrbitToSaturnFrame(PHOEBE_ECLIPTIC);
  assert.near(ph.iDeg, conv.iDeg, 1e-3, 'Phoebe iDeg = converted ecliptic value');
  assert.near(ph.nodeDeg, conv.nodeDeg, 1e-3, 'Phoebe nodeDeg = converted ecliptic value');
  assert.near(ph.periDeg, conv.periDeg, 1e-3, 'Phoebe periDeg recomputed from the new node');

  // Physical invariant: the angle between Phoebe's orbit normal and the
  // ecliptic pole is frame-independent, so the equatorial elements must still
  // sit at the ecliptic inclination (173.04°) away from the ecliptic pole.
  const refToScene = (v: Vector3) => new Vector3(v.x, v.z, -v.y);
  const sceneToRef = (v: Vector3) => new Vector3(v.x, -v.z, v.y);
  const normalOf = (iDeg: number, nodeDeg: number) => {
    const i = iDeg * DEG, O = nodeDeg * DEG;
    return new Vector3(Math.sin(O) * Math.sin(i), -Math.cos(O) * Math.sin(i), Math.cos(i));
  };
  const wSat = normalOf(ph.iDeg, ph.nodeDeg);
  const eclPoleSat = sceneToRef(refToScene(new Vector3(0, 0, 1)).applyMatrix4(ECL_TO_SATURN));
  const angEcl = Math.acos(Math.max(-1, Math.min(1, wSat.dot(eclPoleSat)))) / DEG;
  assert.near(angEcl, PHOEBE_ECLIPTIC.iDeg, 0.05, 'orbit-normal↔ecliptic-pole angle preserved by the conversion');
}

// --- Phoebe: retrograde (i > 90° ⇒ clockwise seen from +Y) --------------------
{
  const ph = byId('phoebe').elements!;
  assert.ok(ph.iDeg > 90, `Phoebe inclination is retrograde (${ph.iDeg.toFixed(2)}° > 90°)`);
  // Angular momentum L = r × v; L.y < 0 ⇒ clockwise as seen from +Y.
  const p0 = elementsToPosition(ph, J2000);
  const p1 = elementsToPosition(ph, J2000 + 1);
  const Ly = p0.z * (p1.x - p0.x) - p0.x * (p1.z - p0.z);
  assert.ok(Ly < 0, 'Phoebe sweeps clockwise (retrograde) as seen from +Y');
  // Sanity: a prograde major moon has the opposite sign.
  const rhea = MOONS.find((m) => m.id === 'rhea')!.elements!;
  const r0 = elementsToPosition(rhea, J2000);
  const r1 = elementsToPosition(rhea, J2000 + 0.1);
  const LyR = r0.z * (r1.x - r0.x) - r0.x * (r1.z - r0.z);
  assert.ok(LyR > 0, 'prograde moon (Rhea) sweeps counter-clockwise (control)');
}

// --- Phoebe fits inside the reachable scene ----------------------------------
{
  const ph = byId('phoebe').elements!;
  const apoUnits = (ph.aKm * (1 + ph.e)) / KM_PER_UNIT;
  assert.ok(apoUnits < ORBIT_MAX_DISTANCE, `Phoebe apoapsis (${apoUnits.toFixed(0)} u) < ORBIT_MAX_DISTANCE (${ORBIT_MAX_DISTANCE})`);
}

// --- Phoebe: non-synchronous uniform rotation, others tidally locked ---------
{
  const ph = byId('phoebe');
  assert.ok(ph.physical.tidallyLocked === false, 'Phoebe is NOT tidally locked');
  assert.near(ph.physical.rotationPeriodH ?? 0, 9.27, 1e-9, 'Phoebe rotation period is 9.27 h');
  for (const m of MINOR_MOONS) {
    if (m.id === 'phoebe') continue;
    assert.ok(m.physical.tidallyLocked === true, `${m.id} is tidally locked`);
  }
}

// --- contract: SaturnSystem renders minors + has the non-sync branch ---------
const base = dirname(fileURLToPath(import.meta.url));
{
  const sysSrc = readFileSync(join(base, 'scene/SaturnSystem.ts'), 'utf8');
  assert.ok(/for\s*\(const def of MINOR_MOONS\)/.test(sysSrc), 'F11.1: SaturnSystem iterates MINOR_MOONS');
  assert.ok(
    /rotationPeriodH[\s\S]*rotation\.y\s*=/.test(sysSrc),
    'F11.1: SaturnSystem has a non-synchronous rotation branch (rotationPeriodH)',
  );
  const weldedFamilies = sysSrc.match(/return weldProceduralMoonGeometry\(geo\);/g) ?? [];
  assert.ok(
    weldedFamilies.length === 4,
    'F11.1b: Hyperion + ravioli + irregular + Phoebe geometries all use welded normals',
  );
  const mainSrc = readFileSync(join(base, 'main.ts'), 'utf8');
  assert.ok(/\.\.\.MINOR_MOONS/.test(mainSrc), 'F11.1: main.ts adds MINOR_MOONS to the body list (HUD/labels/picking)');
}

console.log('wave7 selfcheck: all assertions passed');
console.log('  procedural moon geometries: indexed weld + continuous vertex normals');
const ph = byId('phoebe').elements!;
console.log(
  `  Phoebe eq: i=${ph.iDeg.toFixed(2)}° node=${ph.nodeDeg.toFixed(2)}° peri=${ph.periDeg.toFixed(2)}°  ` +
  `apo=${((ph.aKm * (1 + ph.e)) / KM_PER_UNIT).toFixed(0)}u  (from ecliptic i=${PHOEBE_ECLIPTIC.iDeg}°)`,
);
