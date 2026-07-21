/**
 * Onda 9 / F12.1b self-check — the "Pale Blue Dot". Run via `npm run check`.
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
import { dateToJD } from './orbital/types.ts';

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

console.log('wave9 selfcheck: all assertions passed');
console.log(`  Earth elongation from the Sun over 2 Saturn years: ${minElong.toFixed(2)}° … ${maxElong.toFixed(2)}°`);
