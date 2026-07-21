/**
 * Onda 9 / F12.1 self-check — event browser. Run via `npm run check`.
 *
 * Contract this file pins:
 *  - The ±5-year sweep is NON-VACUOUS: equinox, opposition and Titan-transit
 *    categories each return at least one event; the solstice category is
 *    present but explicitly marked `rare` (2017 / ~2032 straddle the window).
 *  - Datable events land near their JPL references (oppositions ±2 d; the
 *    equinox within a documented mean-element margin).
 *  - Titan shadow transits only occur in the shadow season around an equinox.
 *  - Recurrence: nextEnceladusApoapsis returns the NEXT apoapsis (< 1 orbit
 *    away, mean anomaly ≈ π), never an enumerated list.
 *  - Every event carries a playback speed that exists in the HUD preset set and
 *    a finite jd (jumping to the equinox must not produce NaN, and puts the Sun
 *    in the ring plane).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { EARTH_HELIOCENTRIC, MOONS } from './data/saturn.ts';
import {
  nextEnceladusApoapsis, saturnEarthDistanceAU, scanEvents, WINDOW_YEARS,
  type SaturnEvent,
} from './data/events.ts';
import { sunDirectionAt } from './data/sunDirection.ts';
import { meanAnomalyAt } from './orbital/kepler.ts';
import { dateToJD, jdToDate } from './orbital/types.ts';

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

const YEAR = 365.25;
// Deterministic "now" (project reference date) so the window is fixed.
const NOW = dateToJD(new Date('2026-07-21T00:00:00Z'));
const start = NOW - WINDOW_YEARS * YEAR;
const end = NOW + WINDOW_YEARS * YEAR;

// HUD speed presets (mirror of ui/hud.ts SPEEDS — kept in sync by this check).
const HUD_SPEEDS = new Set([-86400, -3600, 1, 60, 3600, 21600, 86400, 432000]);

const events = scanEvents(NOW);
const by = (c: SaturnEvent['category']) => events.filter((e) => e.category === c);
const fmt = (jd: number) => jdToDate(jd).toISOString().slice(0, 16);

// --- Earth ephemeris sanity (enables oppositions + Earth distance) -----------
{
  assert.near(EARTH_HELIOCENTRIC.aKm / 149597870.7, 1, 0.001, 'Earth a ≈ 1 AU');
  assert.near(EARTH_HELIOCENTRIC.periodDays, 365.25, 0.5, 'Earth period ≈ 1 sidereal year');
  const d = saturnEarthDistanceAU(NOW);
  assert.ok(d > 8 && d < 11.1, `Saturn–Earth distance in the plausible 8–11 AU band (${d.toFixed(2)})`);
}

// --- every event is well-formed ---------------------------------------------
{
  assert.ok(events.length > 0, 'the sweep returns a non-empty event list');
  for (const e of events) {
    assert.ok(Number.isFinite(e.jd), `${e.category} jd is finite (no NaN)`);
    assert.ok(e.jd >= start - 1 && e.jd <= NOW + 8 * YEAR, `${e.category} jd within the scanned span`);
    assert.ok(HUD_SPEEDS.has(e.speed), `${e.category} speed ${e.speed} is a HUD preset`);
    assert.ok(typeof e.focus === 'string' && e.focus.length > 0, `${e.category} has a focus body`);
  }
  // Sorted chronologically.
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i].jd >= events[i - 1].jd, 'events are sorted by date');
  }
}

// --- no category is silently vacuous ----------------------------------------
{
  assert.ok(by('equinox').length >= 1, 'equinox category non-empty');
  assert.ok(by('opposition').length >= 1, 'opposition category non-empty');
  assert.ok(by('titan-transit').length >= 1, 'titan-transit category non-empty');
  const sol = by('solstice');
  assert.ok(sol.length >= 1 && sol.every((s) => s.rare === true),
    'solstice category present and marked rare (outside the ±5 yr window)');
}

// --- equinox: Sun in the ring plane, near the observed 2025-05-06 -----------
{
  const eqs = by('equinox');
  // Only the 2025 equinox falls in the window; Saturn equinoxes are ~15 yr apart.
  assert.ok(eqs.length === 1, `exactly one equinox in the window (got ${eqs.length})`);
  const eq = eqs[0];
  // ⚠ VERIFICAR: observed Saturn equinox 2025-05-06; mean elements give 2025-05-08.
  const ref = dateToJD(new Date('2025-05-06T00:00:00Z'));
  assert.near(eq.jd, ref, 4, `equinox near JPL 2025-05-06 within the mean-element margin (${fmt(eq.jd)})`);
  // Acceptance gate: the Sun sits in the ring plane there (rings edge-on).
  const y = sunDirectionAt(eq.jd, new Vector3()).y;
  assert.near(y, 0, 1e-4, 'Sun height above the ring plane is ~0 at equinox (edge-on rings, no NaN)');
  assert.ok(eq.focus === 'saturn' && eq.speed === 86400, 'equinox jumps to Saturn at 1 d/s');
}

// --- oppositions: spaced by the synodic period, anchored to JPL dates -------
{
  const opps = by('opposition');
  assert.ok(opps.length >= 9, `~10 oppositions across ${2 * WINDOW_YEARS} yr (got ${opps.length})`);
  // ⚠ VERIFICAR: JPL Horizons Saturn oppositions.
  const refs = [
    ['2024-09-08', dateToJD(new Date('2024-09-08T00:00:00Z'))],
    ['2025-09-21', dateToJD(new Date('2025-09-21T00:00:00Z'))],
  ] as const;
  for (const [label, ref] of refs) {
    const hit = opps.find((o) => Math.abs(o.jd - ref) < 2);
    assert.ok(hit, `an opposition within ±2 d of JPL ${label}`);
  }
  // Consecutive oppositions ~378 d apart (synodic period).
  for (let i = 1; i < opps.length; i++) {
    assert.near(opps[i].jd - opps[i - 1].jd, 378, 6, 'opposition spacing ≈ synodic 378 d');
  }
}

// --- Titan transits: only in the shadow season around an equinox ------------
{
  const eq = by('equinox')[0].jd;
  const transits = by('titan-transit');
  for (const t of transits) {
    assert.ok(Math.abs(t.jd - eq) < 330,
      `Titan shadow transit ${fmt(t.jd)} lies within the equinox shadow season`);
    assert.ok(t.focus === 'saturn' && t.speed === 60, 'Titan transit jumps to Saturn at 1 min/s');
  }
  // The most central transit hugs the equinox (Titan's orbit ≈ ring plane).
  const closest = transits.reduce((a, b) => (Math.abs(b.jd - eq) < Math.abs(a.jd - eq) ? b : a));
  assert.ok(Math.abs(closest.jd - eq) < 60, 'a Titan transit falls within ~2 months of the equinox');
}

// --- recurrence: NEXT apoapsis only, never enumerated -----------------------
{
  const el = MOONS.find((m) => m.id === 'enceladus')!.elements!;
  // Sample several sim times; each must yield the next apoapsis < one orbit ahead.
  for (const t of [NOW, NOW + 0.3, NOW + 111.7, NOW - 40.2]) {
    const a = nextEnceladusApoapsis(t);
    assert.ok(a.jd > t, 'apoapsis is strictly in the future of the query time');
    assert.ok(a.jd - t < el.periodDays + 1e-6, 'apoapsis is within one orbital period (the NEXT one)');
    assert.ok(a.jd - t < 2, 'recurrence sanity: next apoapsis < 2 d away');
    // Apoapsis ⇔ mean anomaly = π.
    const M = meanAnomalyAt(el, a.jd);
    assert.near(M, Math.PI, 2e-4, 'apoapsis mean anomaly = π');
    assert.ok(a.focus === 'enceladus' && a.speed === 60, 'apoapsis jumps to Enceladus at 1 min/s');
  }
  // The recurring apoapsis is NOT part of the enumerated list.
  assert.ok(by('apoapsis').length === 0, 'scanEvents never enumerates apoapsis occurrences');
}

// --- wiring contract: main.ts + hud.ts actually use the browser -------------
const base = dirname(fileURLToPath(import.meta.url));
{
  const mainSrc = readFileSync(join(base, 'main.ts'), 'utf8');
  assert.ok(/scanEvents\(/.test(mainSrc), 'main.ts runs the event sweep');
  assert.ok(/hud\.setEvents\(/.test(mainSrc), 'main.ts populates the HUD event list');
  assert.ok(/setNextApoapsis\(nextEnceladusApoapsis\(clock\.jd\)\)/.test(mainSrc),
    'main.ts refreshes the recurring apoapsis from the live clock');
  const hudSrc = readFileSync(join(base, 'ui/hud.ts'), 'utf8');
  assert.ok(/setEvents\s*\(/.test(hudSrc), 'hud.ts exposes setEvents');
  assert.ok(/setNextApoapsis\s*\(/.test(hudSrc), 'hud.ts exposes setNextApoapsis');
}

console.log('wave8 selfcheck: all assertions passed');
console.log(
  `  window ${fmt(start)} … ${fmt(end)}  ` +
  `equinox=${by('equinox').length} opp=${by('opposition').length} ` +
  `titan=${by('titan-transit').length} solstice=${by('solstice').length}(rare)`,
);
const sol = by('solstice')[0];
if (sol) console.log(`  next solstice (extended): ${fmt(sol.jd)}  ${sol.name}`);
const ap = nextEnceladusApoapsis(NOW);
console.log(`  next Enceladus apoapsis from now: ${fmt(ap.jd)} (+${((ap.jd - NOW) * 24).toFixed(1)} h)`);
