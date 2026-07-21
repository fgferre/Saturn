/**
 * Onda 3 acceptance self-check — Sol / sky / frame order / solar isolation.
 * Run via `npm run check`.
 *
 * Browser still owns pixel metrics for square-halo and gate fixtures.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import {
  DISPLAY_SUN_LAYER,
  SOLAR_LAYER,
  SUN_DISK_SCALE,
  SUN_DISPLAY_RADIANCE,
  SUN_FOLLOW_DISTANCE,
  SUN_SEED_CORE_RADIANCE,
  SUN_SEED_SCALE,
} from './scene/Sun.ts';
import { SKY_RADIUS } from './scene/Starfield.ts';
import { ORBIT_MAX_DISTANCE } from './camera/FocusControls.ts';

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

// Mirrors Sun.update / followCamera placement (must match production).
function placeSun(camera: Vector3, sunDir: Vector3): { disk: Vector3; seed: Vector3 } {
  const p = camera.clone().addScaledVector(sunDir.clone().normalize(), SUN_FOLLOW_DISTANCE);
  return { disk: p.clone(), seed: p.clone() };
}
function placeSky(camera: Vector3): Vector3 {
  return camera.clone();
}
function residualSun(camera: Vector3, sunDir: Vector3, disk: Vector3): number {
  const expected = camera.clone().addScaledVector(sunDir.clone().normalize(), SUN_FOLLOW_DISTANCE);
  return disk.distanceTo(expected);
}
function residualSky(camera: Vector3, sky: Vector3): number {
  return sky.distanceTo(camera);
}

// --- A. Parallax / shared direction -----------------------------------------
{
  const sunDir = new Vector3(0.3, -0.2, 0.9).normalize();
  const saturnCam = new Vector3(200, 80, 250);
  const iapetusCam = new Vector3(3560, 100, -400);

  const dSat = placeSun(saturnCam, sunDir).disk;
  const dIap = placeSun(iapetusCam, sunDir).disk;
  const aSat = dSat.clone().sub(saturnCam).normalize();
  const aIap = dIap.clone().sub(iapetusCam).normalize();
  assert.near(aSat.dot(sunDir), 1, 1e-9, 'apparent dir @ Saturn');
  assert.near(aIap.dot(sunDir), 1, 1e-9, 'apparent dir @ Iapetus');
  assert.near(aSat.dot(aIap), 1, 1e-9, 'no parallax Saturn vs Iapetus');

  const legacy = sunDir.clone().multiplyScalar(24000);
  const legacyDot = legacy.clone().sub(saturnCam).normalize()
    .dot(legacy.clone().sub(iapetusCam).normalize());
  assert.ok(legacyDot < 0.999, `legacy shell should parallax (dot=${legacyDot})`);
}

// --- B. Frame order: residual after final camera pose -----------------------
// Simulates the production order: controls move cam, then sun/sky follow.
{
  const sunDir = new Vector3(0.2, 0.1, 0.97).normalize();
  let cam = new Vector3(300, 80, 200);
  // Wrong order (old bug): place sun, then move camera → residual = cam delta.
  const stale = placeSun(cam, sunDir);
  const camDelta = new Vector3(64.777959, 0, 0);
  cam = cam.clone().add(camDelta);
  assert.ok(
    residualSun(cam, sunDir, stale.disk) > 60,
    'stale placement must show large residual (regression anchor)',
  );

  // Correct order: move camera, then place.
  const placed = placeSun(cam, sunDir);
  const sky = placeSky(cam);
  assert.ok(residualSun(cam, sunDir, placed.disk) < 1e-6, 'disk residual after correct order');
  assert.ok(residualSun(cam, sunDir, placed.seed) < 1e-6, 'seed residual after correct order');
  assert.ok(residualSky(cam, sky) < 1e-6, 'sky residual after correct order');

  // Source order in main.ts: system → controls → sun/sky (not sun before controls).
  const mainSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'main.ts'),
    'utf8',
  );
  const iSys = mainSrc.indexOf('system.update(clock.jd, sunDir)');
  const iCtrl = mainSrc.indexOf('controls.update(dt)');
  const iSun = mainSrc.indexOf('sun.update(sunDir, camera.position)');
  const iSky = mainSrc.indexOf('followCamera(sky, camera.position)');
  assert.ok(iSys >= 0 && iCtrl >= 0 && iSun >= 0 && iSky >= 0, 'main.ts frame calls present');
  assert.ok(iSys < iCtrl && iCtrl < iSun && iSun < iSky, 'main.ts order: system→controls→sun→sky');
}

// --- C. Reachability / shared constants -------------------------------------
{
  assert.ok(ORBIT_MAX_DISTANCE < SUN_FOLLOW_DISTANCE, 'orbit max < sun follow');
  assert.ok(ORBIT_MAX_DISTANCE < SKY_RADIUS, 'orbit max < sky radius');
  assert.ok(SKY_RADIUS > SUN_FOLLOW_DISTANCE, 'sky beyond sun');
  // F7: seed footprint ≥ disk; both are HDR (seed may be lower peak after retune).
  assert.ok(SUN_SEED_SCALE >= SUN_DISK_SCALE * 0.9, 'seed covers display disk footprint');
  assert.ok(SUN_DISPLAY_RADIANCE > 10, 'display radiance is HDR for AgX');
  assert.ok(SOLAR_LAYER === 1, 'solar layer id');
}

// --- D. No inverted smoothstep in Sun.ts / Starfield.ts ---------------------
{
  const base = dirname(fileURLToPath(import.meta.url));
  for (const rel of ['scene/Sun.ts', 'scene/Starfield.ts']) {
    const src = readFileSync(join(base, rel), 'utf8');
    // Forbid smoothstep(high, low, ...) numeric pattern edge0 > edge1.
    const bad = /smoothstep\(\s*(?:float\()?(\d*\.?\d+)\)?\s*,\s*(?:float\()?(\d*\.?\d+)\)?/g;
    let m: RegExpExecArray | null;
    while ((m = bad.exec(src)) !== null) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      assert.ok(a < b, `${rel} inverted smoothstep edges ${a} -> ${b}`);
    }
    assert.ok(
      src.includes('oneMinus(smoothstep'),
      `${rel} should use oneMinus(smoothstep(...)) form`,
    );
  }
  const sunSrc = readFileSync(join(base, 'scene/Sun.ts'), 'utf8');
  assert.ok(
    sunSrc.includes('DISPLAY_SUN_LAYER') && sunSrc.includes('SOLAR_LAYER'),
    'Sun must use DISPLAY_SUN_LAYER + SOLAR_LAYER',
  );
  assert.ok(
    Number(DISPLAY_SUN_LAYER) !== Number(SOLAR_LAYER),
    'display and solar layers must differ',
  );
  assert.ok(Number(DISPLAY_SUN_LAYER) !== 0, 'display sun must leave beauty layer 0');
}

// --- E. Engine: base(0+display) + bloom(0 only) + solar lens --------------
{
  const engSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'core', 'Engine.ts'),
    'utf8',
  );
  assert.ok(engSrc.includes('solarCamera'), 'Engine has solarCamera');
  assert.ok(engSrc.includes('bloomCamera'), 'Engine has bloomCamera');
  assert.ok(engSrc.includes('DISPLAY_SUN_LAYER'), 'Engine references DISPLAY_SUN_LAYER');
  assert.ok(engSrc.includes('SOLAR_LAYER'), 'Engine references SOLAR_LAYER');
  assert.ok(engSrc.includes('syncAuxCameras'), 'Engine syncs aux cameras each frame');
  assert.ok(engSrc.includes('basePass'), 'Engine has basePass (system + sun depth)');
  assert.ok(
    engSrc.includes('layers.enable(DISPLAY_SUN_LAYER)') ||
      engSrc.includes('enable(DISPLAY_SUN_LAYER)'),
    'base camera enables DISPLAY_SUN_LAYER for depth occlusion',
  );
  assert.ok(
    engSrc.includes('bloomCamera.layers.set(0)') || engSrc.includes('layers.set(0)'),
    'bloom camera is layer 0 only',
  );
  // F7 final: solar anamorphic removed (bead/blue-bar artefact); glare is seed-only.
  assert.ok(
    !engSrc.includes('anamorphic(solar'),
    'solar anamorphic streak must be removed',
  );
  assert.ok(
    engSrc.includes('lensflare(solarSource') || engSrc.includes('lensflare(solarPass') ||
      engSrc.includes('solarSource.mul(solarGate)'),
    'solar glare chain present (seed and/or flare)',
  );
  assert.ok(
    !/beautyBloom[^;]*sunVisibilityUniform/.test(engSrc.replace(/\s+/g, '')),
    'beauty bloom must not be gated by sunVisibility',
  );
  // Capture must use RT readback (WebGL2-safe), not default-FB + double-rAF.
  assert.ok(engSrc.includes('readRenderTargetPixelsAsync'), 'capture uses RT readback');
  assert.ok(!engSrc.includes('waitForPresent'), 'capture must not double-rAF the default FB');
  assert.ok(engSrc.includes('image/png'), 'capture encodes PNG for QA');
  assert.ok(
    engSrc.includes('Does **not** advance compute') ||
      engSrc.includes('snapshot of the current GPU state'),
    'capture documents no compute advance',
  );
  assert.ok(/finally\s*\{[\s\S]*capturing\s*=\s*false/.test(engSrc), 'capturing cleared in finally');
  assert.ok(engSrc.includes('rt?.dispose()') || engSrc.includes('rt.dispose()'), 'RT disposed');
  assert.ok(engSrc.includes('setRenderTarget(prevRT)'), 'previous RT restored');
}

// --- F. (removed — S28) ------------------------------------------------------
// Vestigial angular-size assertions of the old sprite sun: they passed without
// affirming anything about the physical sun. The physical contract (disk radius
// from SUN_ANGULAR_RADIUS, apparent-diameter band, UV margin, radiance floors)
// is covered by the F7.1 block in wave4.selfcheck.ts.

console.log('wave3 selfcheck: all assertions passed');
console.log(`  follow=${SUN_FOLLOW_DISTANCE} skyR=${SKY_RADIUS} orbitMax=${ORBIT_MAX_DISTANCE}`);
console.log(`  displayScale=${SUN_DISK_SCALE} seedScale=${SUN_SEED_SCALE} rad=${SUN_DISPLAY_RADIANCE}/${SUN_SEED_CORE_RADIANCE}`);
console.log('  frame order source-checked; residual policy < 1e-6; solar-only lens chain asserted');
