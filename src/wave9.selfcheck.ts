/**
 * Onda 9 / F12 self-check — product polish + visual contracts. Run via
 * `npm run check`.
 *
 * Contract this file pins:
 *  - earthDirectionAt returns a unit vector, finite for every sampled date.
 *  - The Earth is ALWAYS near the Sun in Saturn's sky: the elongation (the
 *    Sun–Saturn–Earth angle) never exceeds ~6.5°, matching arcsin(a_Earth /
 *    a_Saturn) — the physical reason PIA17172 needs the Sun eclipsed by the
 *    planet. Both directions go through the same ECL_TO_SATURN, so a frame
 *    mismatch would blow this bound wide open.
 *  - The check is NON-VACUOUS: across a full synodic sweep the elongation
 *    actually swings out toward that maximum (> 5°) and also passes through
 *    near-conjunction (< 1°) — proving the Earth genuinely moves relative to
 *    the Sun rather than being pinned to it by a bug.
 *  - main.ts renders the dot and updates it from the live clock.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { earthDirectionAt, sunDirectionAt } from './data/sunDirection.ts';
import { dateToJD, J2000 } from './orbital/types.ts';
import {
  CLOUD_LAP_DAYS, CLOUD_PHASE_RADIX, splitCloudPhase,
} from './physics/cloudAdvection.ts';
import { labelBoxesOverlap, projectNdcToViewport } from './ui/labels.ts';

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

const DEG = 180 / Math.PI;
const NOW = dateToJD(new Date('2026-07-21T00:00:00Z'));

const sun = new Vector3();
const earth = new Vector3();

// --- sweep two full Saturn orbits, dense enough to catch conjunctions --------
let maxElong = 0;
let minElong = 180;
{
  const STEP = 3; // days
  const SPAN = 2 * 10759; // ~2 Saturn years
  for (let d = 0; d <= SPAN; d += STEP) {
    const jd = NOW + d;
    sunDirectionAt(jd, sun);
    earthDirectionAt(jd, earth);
    assert.near(earth.length(), 1, 1e-6, 'Earth direction is a unit vector');
    assert.ok(Number.isFinite(earth.x + earth.y + earth.z), 'Earth direction is finite');
    const cos = Math.max(-1, Math.min(1, sun.dot(earth)));
    const elong = Math.acos(cos) * DEG;
    if (elong > maxElong) maxElong = elong;
    if (elong < minElong) minElong = elong;
  }
}

// --- elongation stays inside the physical envelope ---------------------------
{
  // arcsin(a_Earth / a_Saturn) ≈ arcsin(1 / 9.537) ≈ 6.02°; eccentricities push
  // the true bound a touch higher. 7° is a hard ceiling — a frame-conversion bug
  // would send this to tens of degrees.
  assert.ok(maxElong <= 7, `max Earth elongation within the ~6° envelope (got ${maxElong.toFixed(2)}°)`);
  // Non-vacuous both ways: it really swings out, and really passes conjunction.
  assert.ok(maxElong > 5, `elongation actually reaches near the max (got ${maxElong.toFixed(2)}°)`);
  assert.ok(minElong < 1, `Earth passes through near-conjunction (got ${minElong.toFixed(2)}°)`);
}

// --- wiring contract: main.ts actually renders + updates the dot -------------
const base = dirname(fileURLToPath(import.meta.url));
{
  const mainSrc = readFileSync(join(base, 'main.ts'), 'utf8');
  assert.ok(/new PaleBlueDot\(/.test(mainSrc), 'main.ts constructs the Pale Blue Dot');
  assert.ok(/scene\.add\(paleBlueDot\.mesh\)/.test(mainSrc), 'main.ts adds the dot to the scene');
  assert.ok(/paleBlueDot\.update\(/.test(mainSrc), 'main.ts updates the dot each frame');
  assert.ok(/earthDirectionAt\(clock\.jd/.test(mainSrc), 'main.ts drives it from the live clock');
}

// --- visual-bug regression contracts ----------------------------------------
{
  // Cloud phase must cross the old 97.5-day reset continuously while each f32
  // component remains compact across the full supported date-picker range.
  const reconstruct = (jd: number): number => {
    const p = splitCloudPhase(jd);
    assert.ok(p.fine >= 0 && p.fine < CLOUD_PHASE_RADIX, 'cloud fine phase stays in radix range');
    return p.coarse * CLOUD_PHASE_RADIX + p.fine;
  };
  const oldReset = J2000 + 97.5;
  const before = reconstruct(oldReset - 1e-5);
  const after = reconstruct(oldReset + 1e-5);
  assert.near(after - before, 2e-5 / CLOUD_LAP_DAYS, 1e-10, 'cloud phase is continuous at old reset');
  for (const jd of [J2000 - 200 * 365.25, J2000, J2000 + 200 * 365.25]) reconstruct(jd);

  const systemSrc = readFileSync(join(base, 'scene', 'SaturnSystem.ts'), 'utf8');
  assert.ok(!systemSrc.includes('jd % 97.5'), 'old discontinuous cloud modulo stays removed');

  const atmoSrc = readFileSync(join(base, 'materials', 'raymarchAtmosphere.ts'), 'utf8');
  assert.ok(
    atmoSrc.includes('material.blendSrc = OneFactor')
      && atmoSrc.includes('material.blendDst = OneMinusSrcAlphaFactor'),
    'atmosphere adds integrated inscatter once while alpha attenuates destination',
  );
  assert.ok(atmoSrc.includes('colorOut.mul(edgeFade)'), 'atmosphere shell edge fades RGB exactly once');

  const sunSrc = readFileSync(join(base, 'scene', 'Sun.ts'), 'utf8');
  const diskBlock = sunSrc.slice(sunSrc.indexOf('// --- Display disk'), sunSrc.indexOf('// --- Glare seed'));
  assert.ok(!diskBlock.includes('.mul(diskMask)'), 'display disk mask must not be baked into additive RGB');
  assert.ok(diskBlock.includes('material.opacityNode = diskMask'), 'display disk mask belongs to opacity only');
  assert.ok(
    sunSrc.includes('material.opacityNode = clamp(energy.div(peakEnergy), 0, 1)'),
    'solar seed encodes its radiance profile once through additive alpha',
  );

  const fRingSrc = readFileSync(join(base, 'materials', 'fRing.ts'), 'utf8');
  const fRingRgb = fRingSrc.slice(fRingSrc.indexOf('material.colorNode ='), fRingSrc.indexOf('material.opacityNode ='));
  assert.ok(!fRingRgb.includes('.mul(across)') && !fRingRgb.includes('.mul(channelMask)'),
    'F-ring transverse and channel masks must not be baked into additive RGB');
  assert.ok(/opacityNode\s*=\s*across[\s\S]*channelMask/.test(fRingSrc),
    'F-ring opacity owns transverse and channel masks');

  const point = projectNdcToViewport(0, 0, { left: 23, top: 41, width: 844, height: 390 });
  assert.near(point.x, 445, 1e-9, 'label projection includes renderer left offset');
  assert.near(point.y, 236, 1e-9, 'label projection includes renderer top offset');
  assert.ok(labelBoxesOverlap(
    { left: 10, top: 10, right: 40, bottom: 28 },
    { left: 42, top: 12, right: 72, bottom: 30 },
  ), 'label collision padding removes near-touching text');
  assert.ok(!labelBoxesOverlap(
    { left: 10, top: 10, right: 40, bottom: 28 },
    { left: 44, top: 12, right: 72, bottom: 30 },
  ), 'label collision keeps boxes beyond the padding budget');

  // `pos` is projected in place, so the apparent-size score must sample the
  // world distance BEFORE that call or every body scores ~the same denominator.
  const labelsSrc = readFileSync(join(base, 'ui', 'labels.ts'), 'utf8');
  assert.ok(
    labelsSrc.indexOf('const worldDistance') < labelsSrc.indexOf('pos.project(camera)'),
    'label score must read world distance before projecting to NDC',
  );

  const hudCss = readFileSync(join(base, 'ui', 'hud.css'), 'utf8');
  const hudTs = readFileSync(join(base, 'ui', 'hud.ts'), 'utf8');
  assert.ok(hudCss.includes('@media (max-width: 720px), (max-height: 500px)'),
    'mobile HUD handles both narrow and low-height viewports');
  assert.ok(hudCss.includes('#hud.mobile-sheet-open .hud-time'),
    'open mobile sheet removes timeline collision');
  assert.ok(hudTs.includes("grip.setAttribute('aria-expanded', String(open))"),
    'bottom-sheet grip exposes its state accessibly');
  assert.ok(hudTs.includes('bar.inert = open') && hudTs.includes('list.inert = open'),
    'hidden mobile instruments leave the keyboard tree while the sheet is open');
  assert.ok(hudCss.includes('flex-wrap: nowrap') && hudCss.includes('touch-action: pan-x'),
    'mobile instrument rails stay single-line and touch-scrollable');
}

console.log('wave9 selfcheck: all assertions passed');
console.log(`  Earth elongation from the Sun over 2 Saturn years: ${minElong.toFixed(2)}° … ${maxElong.toFixed(2)}°`);
console.log('  visual contracts: cloud continuity, single alpha, viewport labels, mobile HUD');
