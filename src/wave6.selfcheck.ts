/**
 * Onda 6 / F9.5 self-check — solar irradiance & apparent size from Saturn's
 * heliocentric distance (achado S35). Run via `npm run check`.
 */

import {
  SATURN_MEAN_DISTANCE_AU,
  saturnSunDistanceAU,
} from './data/sunDirection.ts';
import { SATURN_HELIOCENTRIC } from './data/saturn.ts';
import {
  SUN_DISPLAY_RADIANCE,
  SUN_LIGHT_INTENSITY,
  solarIrradianceUniform,
} from './scene/Sun.ts';

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

// --- mean distance is the semi-major axis (irradiance reference) -------------
{
  assert.near(SATURN_MEAN_DISTANCE_AU, 9.537, 0.01, 'mean distance ≈ a (9.537 AU)');
}

// --- distance swings 9.02–10.05 AU across the orbit -------------------------
let rPeri = Infinity;
let rAph = -Infinity;
{
  const period = SATURN_HELIOCENTRIC.periodDays;
  for (let i = 0; i < 720; i++) {
    const r = saturnSunDistanceAU(SATURN_HELIOCENTRIC.epochJD + (i / 720) * period);
    rPeri = Math.min(rPeri, r);
    rAph = Math.max(rAph, r);
  }
  // Perihelion a(1-e) ≈ 9.021, aphelion a(1+e) ≈ 10.053.
  assert.near(rPeri, 9.021, 0.02, 'perihelion distance ≈ 9.02 AU');
  assert.near(rAph, 10.053, 0.02, 'aphelion distance ≈ 10.05 AU');
}

// --- irradiance factor (mean/r)²: ×1.12 near perihelion, ×0.90 at aphelion --
{
  const factorPeri = (SATURN_MEAN_DISTANCE_AU / rPeri) ** 2;
  const factorAph = (SATURN_MEAN_DISTANCE_AU / rAph) ** 2;
  assert.near(factorPeri, 1.12, 0.05, 'irradiance peaks ≈ ×1.12 at r=9.02');
  assert.near(factorAph, 0.90, 0.05, 'irradiance dips ≈ ×0.90 at r=10.05');
  // ~1.24 peak-to-peak (the S35 finding).
  assert.near(factorPeri / factorAph, 1.24, 0.05, 'irradiance ×1.24 peak-to-peak');
}

// --- contract: mean-distance defaults untouched (wave3/wave4 anchors) -------
{
  assert.near(Number(solarIrradianceUniform.value), 1, 1e-9,
    'irradiance uniform defaults to 1 (mean distance) so AgX anchors hold');
  assert.ok(SUN_DISPLAY_RADIANCE === 90, 'SUN_DISPLAY_RADIANCE must stay 90 (mean)');
  assert.ok(SUN_LIGHT_INTENSITY > 0, 'base light intensity positive');
}

console.log('wave6 selfcheck: all assertions passed');
console.log(
  `  r=${rPeri.toFixed(3)}–${rAph.toFixed(3)} AU  ` +
  `irradiance ×${((SATURN_MEAN_DISTANCE_AU / rPeri) ** 2).toFixed(3)}–` +
  `×${((SATURN_MEAN_DISTANCE_AU / rAph) ** 2).toFixed(3)}  ` +
  `dia ×${(SATURN_MEAN_DISTANCE_AU / rPeri).toFixed(3)}–×${(SATURN_MEAN_DISTANCE_AU / rAph).toFixed(3)}`,
);
