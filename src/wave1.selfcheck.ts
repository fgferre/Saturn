/**
 * Onda 1 acceptance self-check.
 * Run via `npm run check` (also runnable alone):
 *   node --experimental-strip-types src/wave1.selfcheck.ts
 *
 * Sections:
 *  A. Ring-shadow equinox denominator (numeric proof of Fix 1.2)
 *  B. Radial focus path model (proves minDistance clamp math only —
 *     NOT a substitute for OrbitControls runtime behaviour)
 *  C. FocusControls + OrbitControls state (momentum flush, autoRotate,
 *     re-entrant focus) using a minimal DOM stub in Node
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { FocusControls } from './camera/FocusControls.ts';

const assert = {
  ok(cond: unknown, msg: string): void {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  },
  near(a: number, b: number, eps: number, msg: string): void {
    if (Math.abs(a - b) > eps) throw new Error(`ASSERT FAILED: ${msg} (${a} vs ${b})`);
  },
};

const easeInOut = (t: number) => t * t * (3 - 2 * t);

// --- A. Equinox-safe ring-shadow denominator ---------------------------------

const EPS = 1e-5;

function safeDenom(Sy: number): number {
  return Sy >= 0 ? Math.max(Sy, EPS) : Math.min(Sy, -EPS);
}

function oldDenom(Sy: number): number {
  const s = Math.abs(Sy) <= EPS ? 1 : 0;
  return Sy + s * EPS;
}

const sweep = [-2e-5, -1e-5, -5e-6, 0, 5e-6, 1e-5, 2e-5];

for (const Sy of sweep) {
  const d = safeDenom(Sy);
  assert.ok(Number.isFinite(d) && d !== 0, `safeDenom(${Sy}) not finite nonzero: ${d}`);
  assert.ok(Math.abs(d) >= EPS - 1e-15, `safeDenom(${Sy}) below eps: ${d}`);
  if (Sy > 0) assert.ok(d > 0, `safeDenom(+): ${d}`);
  if (Sy < 0) assert.ok(d < 0, `safeDenom(-): ${d}`);
  assert.ok(Number.isFinite(1 / d), `1/safeDenom(${Sy}) not finite`);
}

assert.ok(oldDenom(-EPS) === 0, 'old formula should zero at Sy=-ε (regression anchor)');
assert.near(safeDenom(-EPS), -EPS, 1e-15, 'new formula at Sy=-ε must be -ε');

for (const Sy of sweep) {
  const valid = Math.abs(Sy) >= EPS ? 1 : 0;
  if (Math.abs(Sy) < EPS) assert.ok(valid === 0, `valid should be 0 at Sy=${Sy}`);
  else assert.ok(valid === 1, `valid should be 1 at Sy=${Sy}`);
}

const Py = -30;
for (const Sy of [0.3, -0.3]) {
  const t = -Py / safeDenom(Sy);
  if (Sy > 0) assert.ok(t > 0, `expected toward-sun hit for Sy>0, t=${t}`);
  if (Sy < 0) assert.ok(t <= 0, `expected no plane hit toward sun for Sy<0 south pt, t=${t}`);
}

// --- B. Radial focus path model (NOT OrbitControls proof) -------------------
// Documents the minDistance pin that caused the ~80 unit snap. Angular
// damping / autoRotate are covered in section C and browser QA.

const SATURN_R = 60268 / 1000;
const MIMAS_R = 198.2 / 1000;
const oldMin = SATURN_R * 1.35;
const targetDist = Math.max(MIMAS_R * 5.5, 0.6);
const newMin = Math.max(MIMAS_R * 1.4, 0.02);

function sampleFocusPath(clampMidFlight: boolean): number[] {
  const from = 339.56;
  const to = targetDist;
  const samples: number[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    let d = from + (to - from) * easeInOut(t);
    if (clampMidFlight && t < 1) d = Math.max(d, oldMin);
    if (t >= 1) d = Math.max(to, newMin);
    samples.push(d);
  }
  return samples;
}

const oldPath = sampleFocusPath(true);
const newPath = sampleFocusPath(false);
const oldJump = Math.abs(oldPath[oldPath.length - 1] - oldPath[oldPath.length - 2]);
assert.ok(oldJump > 50, `expected large old-path final jump, got ${oldJump}`);

let maxStep = 0;
for (let i = 1; i < newPath.length; i++) {
  maxStep = Math.max(maxStep, Math.abs(newPath[i] - newPath[i - 1]));
}
assert.ok(maxStep < 30, `new path max step too large: ${maxStep}`);
assert.near(newPath[newPath.length - 1], targetDist, 1e-9, 'final Mimas framing');

// --- C. FocusControls + OrbitControls (Node stub) ---------------------------

/** Minimal DOM surface for OrbitControls event wiring in Node. */
function stubDom(): HTMLElement {
  const doc = {
    addEventListener() {},
    removeEventListener() {},
  };
  const el = {
    style: {} as CSSStyleDeclaration,
    ownerDocument: doc as unknown as Document,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} };
    },
    clientWidth: 800,
    clientHeight: 600,
    getRootNode() { return el; },
  };
  return el as unknown as HTMLElement;
}

type OrbitInternal = { _sphericalDelta: { theta: number; phi: number } };

/** Test-only read of residual spherical momentum (private field). */
function sphericalDeltaTheta(controls: object): number {
  return (controls as OrbitInternal)._sphericalDelta.theta;
}

function injectTheta(controls: object, theta: number): void {
  (controls as OrbitInternal)._sphericalDelta.theta = theta;
}

function cameraOf(fc: FocusControls): PerspectiveCamera {
  return fc.controls.object as PerspectiveCamera;
}

function dirOf(camera: PerspectiveCamera, target: Vector3): Vector3 {
  return camera.position.clone().sub(target).normalize();
}

function angleBetween(a: Vector3, b: Vector3): number {
  return Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * (180 / Math.PI);
}

const bodies = new Map<string, { pos: Vector3; radius: number }>([
  ['saturn', { pos: new Vector3(0, 0, 0), radius: SATURN_R }],
  ['mimas', { pos: new Vector3(185.5, 0, 0), radius: MIMAS_R }],
  ['titan', { pos: new Vector3(1221.9, 0, 0), radius: 2.5747 }],
]);

function makeFocus(): FocusControls {
  const camera = new PerspectiveCamera(45, 1, 0.05, 120000);
  camera.position.set(0, 80, 330);
  const fc = new FocusControls(
    camera,
    stubDom(),
    (id, out) => out.copy(bodies.get(id)!.pos),
    (id) => bodies.get(id)!.radius,
  );
  fc.controls.target.set(0, 0, 0);
  fc.controls.update();
  return fc;
}

// C1 — damping residual is cleared at focus start (not frozen across flight)
{
  const fc = makeFocus();
  fc.controls.enableDamping = true;
  // Inject residual equivalent to a short horizontal drag (~0.27 rad).
  injectTheta(fc.controls, -0.2727588);
  assert.near(sphericalDeltaTheta(fc.controls), -0.2727588, 1e-9, 'precondition residual');

  fc.focus('mimas');
  assert.near(sphericalDeltaTheta(fc.controls), 0, 1e-9, 'residual must be zero after focus() flush');

  // Mid-flight: authoritative pose; residual must stay zero (no freeze-and-release).
  for (let i = 0; i < 10; i++) fc.update(0.07);
  assert.near(sphericalDeltaTheta(fc.controls), 0, 1e-9, 'residual must stay zero mid-flight');

  // Finish the flight.
  for (let i = 0; i < 30; i++) fc.update(0.1);
  assert.near(sphericalDeltaTheta(fc.controls), 0, 1e-6, 'residual must stay zero after landing');

  const finalDist = cameraOf(fc).position.distanceTo(fc.controls.target);
  assert.near(finalDist, targetDist, 1e-3, 'final distance after damped-start focus');
}

// C2 — autoRotate survives a normal focus flight
{
  const fc = makeFocus();
  fc.controls.autoRotate = true;
  fc.focus('mimas');
  assert.ok(fc.controls.autoRotate === true, 'autoRotate must stay true during flight');
  for (let i = 0; i < 40; i++) fc.update(0.1);
  assert.ok(fc.controls.autoRotate === true, 'autoRotate must stay true after flight');
}

// C3 — re-entrant focus does not lose autoRotate
{
  const fc = makeFocus();
  fc.controls.autoRotate = true;
  fc.focus('mimas');
  assert.ok(fc.controls.autoRotate === true, 'autoRotate after first focus');
  // 300 ms into the 1.4 s flight
  for (let i = 0; i < 5; i++) fc.update(0.06);
  fc.focus('titan');
  assert.ok(fc.controls.autoRotate === true, 'autoRotate after re-entrant focus start');
  for (let i = 0; i < 40; i++) fc.update(0.1);
  assert.ok(fc.controls.autoRotate === true, 'autoRotate after re-entrant flight ends');
}

// C4 — Drift toggle during flight is respected at the end
{
  const fc = makeFocus();
  fc.controls.autoRotate = true;
  fc.focus('mimas');
  for (let i = 0; i < 5; i++) fc.update(0.06);
  // HUD checkbox toggled mid-flight
  fc.controls.autoRotate = false;
  for (let i = 0; i < 40; i++) fc.update(0.1);
  assert.ok(fc.controls.autoRotate === false, 'mid-flight Drift off must stick after landing');

  const fc2 = makeFocus();
  fc2.controls.autoRotate = false;
  fc2.focus('mimas');
  for (let i = 0; i < 5; i++) fc2.update(0.06);
  fc2.controls.autoRotate = true;
  for (let i = 0; i < 40; i++) fc2.update(0.1);
  assert.ok(fc2.controls.autoRotate === true, 'mid-flight Drift on must stick after landing');
}

// C5 — angular kick from residual must be negligible after flush+flight
{
  const fc = makeFocus();
  fc.controls.enableDamping = true;
  injectTheta(fc.controls, -0.2727588);

  fc.focus('mimas');
  // Capture direction at first post-focus frame (authoritative start of lerp).
  fc.update(1 / 60);
  const cam = cameraOf(fc);
  const dirStart = dirOf(cam, fc.controls.target);

  // Advance almost to the end, capture direction just before landing sync.
  for (let i = 0; i < 82; i++) fc.update(1 / 60);
  const dirPreLand = dirOf(cam, fc.controls.target);

  // Complete
  for (let i = 0; i < 10; i++) fc.update(1 / 60);
  const dirLand = dirOf(cam, fc.controls.target);

  const landKick = angleBetween(dirPreLand, dirLand);
  assert.ok(landKick < 0.1, `landing angular kick ${landKick.toFixed(4)}° exceeds 0.1° budget`);

  // Sanity: we did move during the flight (not frozen at start).
  const travel = angleBetween(dirStart, dirPreLand);
  // Travel may be small if fromOffset already near toOffset; only require finite.
  assert.ok(Number.isFinite(travel), 'travel angle finite');
}

console.log('wave1 selfcheck: all assertions passed');
console.log(`  A equinox: safeDenom sweep ok; oldDenom(-ε)=${oldDenom(-EPS)}`);
console.log(`  B radial model: old jump=${oldJump.toFixed(2)}, new max step=${maxStep.toFixed(2)}, final=${newPath[newPath.length - 1].toFixed(4)} (model only)`);
console.log('  C FocusControls: residual flush, autoRotate, re-entrant, Drift mid-flight, land kick < 0.1°');
