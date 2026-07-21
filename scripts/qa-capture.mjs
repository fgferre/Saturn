#!/usr/bin/env node
/**
 * QA capture harness — Onda 0 (PLANO_MESTRE_AAA §4 items 9–10, §10).
 *
 * Drives the PRODUCTION bundle: `vite preview` over dist/ + headless Chromium
 * (playwright-core, no browser download — uses the cached %LOCALAPPDATA%\
 * ms-playwright binaries). Run `npm run build` first.
 *
 * DETERMINISM / IDENTITY RULE (S31): pixel-identical comparisons ONLY on
 * `?post=raw` with a pinned DPR (deviceScaleFactor = 1) and pinned quality
 * (`?quality=low&notune`). FilmNode uses wall-clock time, so `?post=full`
 * never repeats byte-for-byte. `?notune` disables the one-shot auto-tuner,
 * which can location.reload() in the middle of a headless run. `?qa=1`
 * exposes window.__saturn in production builds. `?webgl` forces WebGL2
 * (headless WebGPU is unreliable; WebGPU-specific runs are F12.5 scope).
 *
 * Scenarios (all assert and also save PNGs under output/, gitignored):
 *   1. identity — two independent page loads, ?post=raw captures must be
 *      byte-identical (the Onda 0 acceptance criterion).
 *   2. ev-sweep — EV 0.5 / 1.4 / 2.6: the solar disk is present, saturated
 *      (never gray) and smooth (never blotchy).
 *   3. ring-b   — camera descends so the Sun sightline crosses ring B: the
 *      CPU-side sunVisibility gate and the measured disk luminance decrease
 *      monotonically (extinction is NOT alpha blending — plan §11.10).
 *
 * Usage: node scripts/qa-capture.mjs
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'output');
const PORT = 4173;
/** Fixed epoch: 2026-07-01T00:00Z — identical scene state across runs. */
const JD_PIN = 2461222.5;
const PAGE_URL =
  `http://127.0.0.1:${PORT}/?webgl&quality=low&notune&qa=1&post=raw`;

let failures = 0;
const ok = (cond, msg) => {
  if (cond) {
    console.log(`  PASS ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL ${msg}`);
  }
};

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function savePng(name, dataUrl) {
  mkdirSync(OUT_DIR, { recursive: true });
  const b64 = dataUrl.split(',').pop();
  const file = join(OUT_DIR, name);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  console.log(`  saved output/${name}`);
}

/** Locate a cached Playwright Chromium binary (headless shell preferred). */
function findChromium() {
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const candidates = [];
  for (const dir of readdirSync(base)) {
    for (const sub of [
      'chrome-headless-shell-win64/chrome-headless-shell.exe',
      'chrome-win/headless_shell.exe',
    ]) {
      if (dir.startsWith('chromium_headless_shell-')) candidates.push(join(base, dir, sub));
    }
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
      if (/^chromium-\d+$/.test(dir)) candidates.push(join(base, dir, sub));
    }
  }
  const found = candidates.filter(existsSync).sort();
  if (!found.length) throw new Error(`no cached chromium under ${base}`);
  return found[found.length - 1];
}

async function startPreview() {
  const child = spawn(
    process.execPath,
    [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview',
      '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stderr.on('data', (d) => process.stderr.write(d));
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return child;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('vite preview did not start within 30 s');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Boot the page and bring it to a fully deterministic state: rAF loop stopped
 * (modern headless fires rAF — wall-clock frames would desync runs), clock
 * paused at a pinned JD, damping off, fixed framing, GPU particles re-seeded
 * (the loop may have integrated a random number of frames before we stopped
 * it), then settled with fixed-dt steps.
 */
async function bootDeterministic(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (err) => {
    failures++;
    console.error(`  FAIL page error: ${err.message}`);
  });
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__saturn !== undefined, null, {
    timeout: 300000,
  });
  await page.evaluate(async (jd) => {
    const s = window.__saturn;
    s.engine.renderer.setAnimationLoop(null); // manual stepping only
    s.clock.paused = true;
    s.clock.jd = jd;
    s.controls.controls.enableDamping = false;
    s.engine.camera.position.set(200, 80, 250);
    s.controls.controls.target.set(0, 0, 0);
    for (const p of s.system.plumeSystems) await s.engine.computeOnce(p.init);
    for (let i = 0; i < 12; i++) await s.step(1 / 60);
  }, JD_PIN);
  return page;
}

const capture = (page, width = 640) =>
  page.evaluate((w) => window.__saturn.engine.capture(w, true), width);

/** Aim the camera straight at the Sun (direction from the DirectionalLight). */
async function aimAtSun(page, zoom = 25) {
  await page.evaluate(async (z) => {
    const s = window.__saturn;
    let light = null;
    s.engine.scene.traverse((o) => { if (o.isDirectionalLight && !light) light = o; });
    const sd = light.position.clone().normalize();
    const cam = s.engine.camera;
    s.controls.controls.target.copy(cam.position).addScaledVector(sd, 1000);
    cam.zoom = z;
    cam.updateProjectionMatrix();
    for (let i = 0; i < 5; i++) await s.step(1 / 60);
  }, zoom);
}

/**
 * Pixel stats of the solar disk in a capture: brightest-pixel luminance,
 * disk pixel count, mean colour, and the fraction of dark "blotch" pixels
 * inside the disk's bounding disc.
 */
function analyzeDisk(page, dataUrl) {
  return page.evaluate(async (url) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const W = c.width;
    const H = c.height;
    const lum = new Float32Array(W * H);
    let maxL = 0;
    for (let i = 0; i < W * H; i++) {
      const L = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      lum[i] = L;
      if (L > maxL) maxL = L;
    }
    const thr = maxL * 0.5;
    let n = 0;
    let cx = 0;
    let cy = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (lum[i] >= thr) {
          n++; cx += x; cy += y;
          sr += d[i * 4]; sg += d[i * 4 + 1]; sb += d[i * 4 + 2];
        }
      }
    }
    if (n === 0) return { maxL, bright: 0, blotchFrac: 1 };
    cx /= n;
    cy /= n;
    const radius = Math.sqrt(n / Math.PI) * 1.2;
    const r2 = radius * radius;
    let interior = 0;
    let dark = 0;
    for (let y = Math.max(0, Math.floor(cy - radius));
      y <= Math.min(H - 1, Math.ceil(cy + radius)); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius));
        x <= Math.min(W - 1, Math.ceil(cx + radius)); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        interior++;
        if (lum[y * W + x] < maxL * 0.35) dark++;
      }
    }
    return {
      maxL, bright: n, meanR: sr / n, meanG: sg / n, meanB: sb / n,
      blotchFrac: interior ? dark / interior : 1,
    };
  }, dataUrl);
}

// --- Scenario 1: byte-identity across two independent loads (?post=raw) ----
async function scenarioIdentity(browser) {
  console.log('scenario 1: identity (?post=raw, pinned DPR/preset)');
  const caps = [];
  for (let run = 0; run < 2; run++) {
    const page = await bootDeterministic(browser);
    caps.push(await capture(page));
    await page.close();
  }
  savePng('qa-identity-run1.png', caps[0]);
  savePng('qa-identity-run2.png', caps[1]);
  const [h1, h2] = caps.map(sha256);
  console.log(`  sha256 run1=${h1.slice(0, 16)}… run2=${h2.slice(0, 16)}…`);
  ok(h1 === h2, 'raw captures byte-identical across two runs');
}

// --- Scenario 2: EV sweep — disk never gray, never blotchy -----------------
async function scenarioEvSweep(browser) {
  console.log('scenario 2: EV sweep 0.5 / 1.4 / 2.6');
  const page = await bootDeterministic(browser);
  await aimAtSun(page);
  for (const ev of [0.5, 1.4, 2.6]) {
    await page.evaluate(async (v) => {
      const s = window.__saturn;
      s.engine.renderer.toneMappingExposure = v;
      for (let i = 0; i < 4; i++) await s.step(1 / 60);
    }, ev);
    const cap = await capture(page);
    savePng(`qa-ev-${ev}.png`, cap);
    const st = await analyzeDisk(page, cap);
    console.log(
      `  EV ${ev}: maxL=${st.maxL.toFixed(0)} bright=${st.bright} ` +
      `rgb=(${st.meanR?.toFixed(0)},${st.meanG?.toFixed(0)},${st.meanB?.toFixed(0)}) ` +
      `blotch=${(st.blotchFrac * 100).toFixed(1)}%`,
    );
    ok(st.bright >= 50, `EV ${ev}: disk visible (${st.bright} px)`);
    ok(st.maxL > 200, `EV ${ev}: disk saturates, never gray (maxL ${st.maxL.toFixed(0)})`);
    ok(st.meanR >= st.meanB - 4, `EV ${ev}: disk warm/white, not gray (R≥B)`);
    ok(st.blotchFrac <= 0.05, `EV ${ev}: no blotches (${(st.blotchFrac * 100).toFixed(1)}%)`);
  }
  await page.close();
}

// --- Scenario 3: Sun entering ring B — monotonic extinction -----------------
async function scenarioRingB(browser) {
  console.log('scenario 3: Sun sightline entering ring B');
  const page = await bootDeterministic(browser);
  // Camera opposite the Sun at radius 120 u; descending below the plane moves
  // the camera→Sun sightline crossing from the Cassini Division (~119 u)
  // into mid ring B (~108 u). Extinction is CPU-side (sunVisibilityFromCamera).
  const rows = await page.evaluate(async () => {
    const s = window.__saturn;
    let light = null;
    s.engine.scene.traverse((o) => { if (o.isDirectionalLight && !light) light = o; });
    const sd = light.position.clone().normalize();
    const horiz = Math.hypot(sd.x, sd.z);
    const R = 120;
    const cam = s.engine.camera;
    cam.zoom = 25;
    cam.updateProjectionMatrix();
    const out = [];
    for (let i = 0; i <= 7; i++) {
      const rc = 119 - ((119 - 108) * i) / 7;
      const h = ((R - rc) * Math.abs(sd.y)) / horiz;
      cam.position.set((-sd.x / horiz) * R, -Math.sign(sd.y) * h, (-sd.z / horiz) * R);
      s.controls.controls.target.copy(cam.position).addScaledVector(sd, 1000);
      for (let k = 0; k < 25; k++) await s.step(0.1); // settle the half-life smooth
      out.push({ rc, vis: s.sunVisibility(), cap: await s.engine.capture(320, true) });
    }
    return out;
  });
  ok(rows[0].vis > 0.8, `clear sightline starts bright (vis ${rows[0].vis.toFixed(3)})`);
  let mono = true;
  let lumMono = true;
  let prevLum = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const st = await analyzeDisk(page, rows[i].cap);
    if (i > 0 && rows[i].vis > rows[i - 1].vis + 1e-4) mono = false;
    if (st.maxL > prevLum + 2) lumMono = false;
    prevLum = st.maxL;
    console.log(
      `  crossing r=${rows[i].rc.toFixed(1)} u: vis=${rows[i].vis.toFixed(4)} ` +
      `disk maxL=${st.maxL.toFixed(0)}`,
    );
    if (i === 0 || i === 4 || i === rows.length - 1) {
      savePng(`qa-ringb-r${rows[i].rc.toFixed(0)}.png`, rows[i].cap);
    }
  }
  ok(mono, 'sunVisibility monotonically decreasing into ring B');
  ok(rows[0].vis - rows[rows.length - 1].vis > 0.2,
    `extinction depth ${(rows[0].vis - rows[rows.length - 1].vis).toFixed(3)} > 0.2`);
  ok(lumMono, 'disk luminance monotonically decreasing into ring B');
  await page.close();
}

async function main() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    throw new Error('dist/ missing — run `npm run build` first (production bundle required)');
  }
  const executablePath = findChromium();
  console.log(`chromium: ${executablePath}`);
  const server = await startPreview();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      // Allow the software-GL fallback when no GPU is available headless.
      args: ['--enable-unsafe-swiftshader'],
    });
    await scenarioIdentity(browser);
    await scenarioEvSweep(browser);
    await scenarioRingB(browser);
  } finally {
    await browser?.close();
    server.kill();
  }
  console.log(failures === 0 ? '\nqa-capture: ALL SCENARIOS PASSED' : `\nqa-capture: ${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
