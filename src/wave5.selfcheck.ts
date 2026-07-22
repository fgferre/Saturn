/**
 * Onda 5 / F8.3 self-check — shareable URL state parser/serializer.
 * Pure module, no three / no DOM. Run via `npm run check`.
 */

import {
  offsetToSpherical,
  parseState,
  serializeState,
  sphericalToOffset,
  type UrlState,
} from './core/urlState.ts';

const J2000 = 2451545.0;

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

// --- jd range gate: J2000 ± 200 years -------------------------------------
{
  const inRange = parseState('?jd=2460000.5');
  assert.near(inRange.jd!, 2460000.5, 1e-9, 'valid jd within J2000±200y kept');

  const tooLate = parseState(`?jd=${J2000 + 201 * 365.25}`);
  assert.ok(tooLate.jd === undefined, 'jd > J2000+200y ignored');
  const tooEarly = parseState(`?jd=${J2000 - 201 * 365.25}`);
  assert.ok(tooEarly.jd === undefined, 'jd < J2000-200y ignored');
  assert.ok(parseState('?jd=abc').jd === undefined, 'non-numeric jd ignored');
  assert.ok(parseState('?jd=NaN').jd === undefined, 'NaN jd ignored');
  assert.ok(parseState('?jd=Infinity').jd === undefined, 'Infinity jd ignored');
}

// --- junk / never-throws ---------------------------------------------------
{
  // Garbage of every shape must yield an empty state, never an exception.
  const junk = parseState('?focus=<script>&jd=&speed=&cam=nope');
  assert.ok(junk.focus === undefined, 'markup focus rejected');
  assert.ok(junk.jd === undefined, 'blank jd rejected');
  assert.ok(junk.speed === undefined, 'blank speed rejected');
  assert.ok(junk.cam === undefined, 'unparseable cam rejected');

  assert.ok(Object.keys(parseState('')).length === 0, 'empty search → empty state');
  assert.ok(Object.keys(parseState('?')).length === 0, 'bare ? → empty state');
  // Leading-? optional and totally unrelated params are ignored, not thrown on.
  assert.ok(Object.keys(parseState('post=1&webgl=1&quality=high')).length === 0,
    'unrelated params ignored without ?');
}

// --- speed bounds ----------------------------------------------------------
{
  // A finite-but-absurd speed drives SimClock's JD to Infinity on frame 1 and
  // never comes back; bound it at the parse boundary like jd/fov/dist.
  assert.ok(parseState('?speed=1e308').speed === undefined, 'absurd speed rejected');
  assert.ok(parseState('?speed=-1e308').speed === undefined, 'absurd negative speed rejected');
  assert.near(parseState('?speed=432000').speed!, 432000, 1e-9, 'fastest preset survives');
  assert.near(parseState('?speed=-86400').speed!, -86400, 1e-9, 'backwards preset survives');
  // Serialization applies the same bound, so the round-trip contract holds.
  assert.ok(
    parseState(serializeState({ speed: 1e308 })).speed === undefined,
    'absurd speed never serialized',
  );
}

// --- cam validation --------------------------------------------------------
{
  assert.ok(parseState('?cam=1,2').cam === undefined, 'cam needs 3 components');
  assert.ok(parseState('?cam=1,2,3,4,5').cam === undefined, 'cam rejects 5 components');
  assert.ok(parseState('?cam=1,x,3').cam === undefined, 'cam rejects non-numeric');
  assert.ok(parseState('?cam=1,2,0').cam === undefined, 'cam rejects non-positive dist');
  assert.ok(parseState('?cam=1,2,-5').cam === undefined, 'cam rejects negative dist');
  const okCam = parseState('?cam=0.5,-0.25,12.5').cam!;
  assert.near(okCam.az, 0.5, 1e-9, 'cam az parsed');
  assert.near(okCam.el, -0.25, 1e-9, 'cam el parsed');
  assert.near(okCam.dist, 12.5, 1e-9, 'cam dist parsed');
  assert.ok(okCam.fov === undefined, 'cam without 4th component has no fov');

  // 4th component is the FOV lens (degrees), validated against the slider range.
  const lensCam = parseState('?cam=0.5,-0.25,12.5,28').cam!;
  assert.near(lensCam.fov!, 28, 1e-9, 'cam fov parsed');
  const wideDropped = parseState('?cam=0.5,-0.25,12.5,120').cam!;
  assert.ok(wideDropped.fov === undefined, 'out-of-range fov dropped, pose kept');
  assert.near(wideDropped.dist, 12.5, 1e-9, 'pose survives an invalid fov');
}

// --- focus normalisation ---------------------------------------------------
{
  assert.ok(parseState('?focus=Titan').focus === 'titan', 'focus lowercased');
  assert.ok(parseState('?focus=').focus === undefined, 'blank focus ignored');
  assert.ok(parseState('?focus=a b').focus === undefined, 'focus with space rejected');
}

// --- round-trip: parse(serialize(x)) preserves valid fields ---------------
{
  const state: UrlState = {
    focus: 'enceladus',
    jd: 2460000.123456,
    speed: -3600,
    cam: { az: 1.2345, el: -0.4211, dist: 42.75, fov: 32.5 },
  };
  const round = parseState(serializeState(state));
  assert.ok(round.focus === 'enceladus', 'round-trip focus');
  assert.near(round.jd!, state.jd!, 1e-6, 'round-trip jd (6-dp precision)');
  assert.near(round.speed!, state.speed!, 1e-6, 'round-trip speed');
  assert.near(round.cam!.az, state.cam!.az, 1e-5, 'round-trip cam az');
  assert.near(round.cam!.el, state.cam!.el, 1e-5, 'round-trip cam el');
  assert.near(round.cam!.dist, state.cam!.dist, 1e-3, 'round-trip cam dist');
  assert.near(round.cam!.fov!, state.cam!.fov!, 1e-2, 'round-trip cam fov');

  // Invalid fields drop out of serialization entirely.
  const partial = serializeState({ jd: 9e9, focus: '<x>', speed: 100 });
  const partialParsed = parseState(partial);
  assert.ok(partialParsed.jd === undefined, 'out-of-range jd not serialized');
  assert.ok(partialParsed.focus === undefined, 'invalid focus not serialized');
  assert.near(partialParsed.speed!, 100, 1e-9, 'valid speed survives partial state');
  assert.ok(serializeState({}) === '', 'empty state → empty string');
}

// --- spherical <-> offset round-trip (camera pose math) --------------------
{
  const cases: [number, number, number][] = [
    [0.5, 0.3, 12], [-2.1, -0.8, 300], [3.0, 0.0, 1.5],
  ];
  for (const [az, el, dist] of cases) {
    const [x, y, z] = sphericalToOffset(az, el, dist);
    const back = offsetToSpherical(x, y, z);
    assert.near(back.dist, dist, 1e-9, 'offset round-trip dist');
    assert.near(back.el, el, 1e-9, 'offset round-trip el');
    // az wraps; compare via the reconstructed offset instead.
    const [x2, y2, z2] = sphericalToOffset(back.az, back.el, back.dist);
    assert.near(x2, x, 1e-9, 'offset round-trip x');
    assert.near(y2, y, 1e-9, 'offset round-trip y');
    assert.near(z2, z, 1e-9, 'offset round-trip z');
  }
}

console.log('wave5 selfcheck: all assertions passed');
console.log('  jd range gate; junk ignored; cam validated; parse/serialize + pose round-trip');
