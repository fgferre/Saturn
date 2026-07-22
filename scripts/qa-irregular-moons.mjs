#!/usr/bin/env node
/**
 * Cross-backend close-up QA for Saturn's nine procedural, non-spherical moons.
 *
 * Uses the production bundle and the only supported capture path,
 * window.__saturn.engine.capture(). Raw mode removes FilmNode wall-clock noise;
 * a fixed 1:1 viewport, DPR, epoch, phase angle and camera distance make WebGPU
 * and WebGL2 comparisons meaningful. Artifacts are gitignored under
 * output/playwright/irregular-moons/.
 *
 * Usage: npm run qa:moons  (run `npm run build` first)
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'output', 'playwright', 'irregular-moons');
const PORT = 4174;
const JD_PIN = 2461222.5; // 2026-07-01T00:00Z
const IDS = [
  'hyperion', 'pan', 'daphnis', 'atlas', 'prometheus', 'pandora',
  'janus', 'epimetheus', 'phoebe',
];
const VIEWS = [
  { name: 'relief-a', side: 1 },
  { name: 'relief-b', side: -1 },
];

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log(`  PASS ${message}`);
  else { failures++; console.error(`  FAIL ${message}`); }
};

function savePng(name, dataUrl) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, name), Buffer.from(dataUrl.split(',').pop(), 'base64'));
}

function findChromium() {
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const full = [];
  const shells = [];
  for (const dir of readdirSync(base)) {
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
      if (/^chromium-\d+$/.test(dir)) full.push(join(base, dir, sub));
    }
    for (const sub of [
      'chrome-headless-shell-win64/chrome-headless-shell.exe',
      'chrome-win/headless_shell.exe',
    ]) {
      if (dir.startsWith('chromium_headless_shell-')) shells.push(join(base, dir, sub));
    }
  }
  const fullFound = full.filter(existsSync).sort();
  const shellFound = shells.filter(existsSync).sort();
  // Full Chromium is required for hardware WebGPU on Windows. The headless
  // shell may exist at a newer revision but silently forces WebGL2.
  if (fullFound.length) return fullFound[fullFound.length - 1];
  if (shellFound.length) return shellFound[shellFound.length - 1];
  throw new Error(`no cached Chromium under ${base}`);
}

async function startPreview() {
  const child = spawn(
    process.execPath,
    [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview',
      '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stderr.on('data', (data) => process.stderr.write(data));
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/`);
      if (response.ok) return child;
    } catch { /* preview is still starting */ }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('vite preview did not start within 30 s');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function boot(browser, forceWebGL) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => {
    failures++;
    console.error(`  FAIL page error: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`  browser error: ${message.text()}`);
  });
  const webgl = forceWebGL ? '&webgl' : '';
  await page.goto(
    `http://127.0.0.1:${PORT}/?quality=ultra&notune&qa=1&post=raw${webgl}`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(() => window.__saturn !== undefined, null, { timeout: 300000 });
  const backend = await page.evaluate(async (jd) => {
    const s = window.__saturn;
    s.engine.renderer.setAnimationLoop(null);
    s.clock.paused = true;
    s.clock.jd = jd;
    s.clock.speed = 0;
    s.controls.controls.enableDamping = false;
    s.controls.controls.autoRotate = false;
    s.engine.camera.near = 0.001; // QA macro view of 3.8 km Daphnis
    s.engine.camera.far = 120000;
    s.engine.camera.fov = 32;
    s.engine.camera.zoom = 1;
    s.engine.camera.updateProjectionMatrix();
    for (let i = 0; i < 8; i++) await s.step(1 / 60);
    // Freeze every procedural asset under unobscured sunlight after the final
    // simulation step. Subsequent moon captures snap the camera without
    // advancing the physics clock, so the masks remain a stable QA fixture.
    for (const body of s.system.bodies.values()) {
      if (body.eclipseLight) body.eclipseLight.value = 1;
      body.eclipseTint?.value?.set(1, 1, 1);
    }
    await s.engine.renderOnce();
    return s.engine.backendName;
  }, JD_PIN);
  return { page, backend };
}

async function captureMoon(page, id, side) {
  return page.evaluate(async ({ moonId, sideSign }) => {
    const s = window.__saturn;
    const body = s.system.bodies.get(moonId);
    if (!body) throw new Error(`missing body ${moonId}`);

    let light = null;
    s.engine.scene.traverse((object) => {
      if (object.isDirectionalLight && !light) light = object;
    });
    if (!light) throw new Error('directional sunlight missing');

    // Camera sits 34° off the sunlight vector: enough phase for readable form,
    // enough grazing light for crater walls and micro-normal relief.
    const sun = light.position.clone().normalize();
    const tangent = sun.clone().set(-sun.z, 0, sun.x).normalize();
    const bitangent = sun.clone().cross(tangent).normalize();
    const phase = 34 * Math.PI / 180;
    const direction = sun.clone().multiplyScalar(Math.cos(phase))
      .addScaledVector(tangent, Math.sin(phase) * sideSign)
      .addScaledVector(bitangent, 0.10)
      .normalize();
    const radius = body.def.physical.radiusKm / 1000;
    const distance = Math.max(radius * 6.4, 0.028);
    s.controls.snap(moonId, direction.multiplyScalar(distance));
    s.engine.camera.fov = 32;
    s.engine.camera.updateProjectionMatrix();

    // Prime the post target after the synthetic camera jump, then capture.
    await s.engine.capture(720, true);
    return s.engine.capture(720, true);
  }, { moonId: id, sideSign: side });
}

async function imageStats(page, dataUrl) {
  return page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const values = [];
    const cx = image.width / 2, cy = image.height / 2;
    const radius = Math.min(image.width, image.height) * 0.23;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 2) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 2) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
        const i = (y * image.width + x) * 4;
        values.push(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
      }
    }
    values.sort((a, b) => a - b);
    const percentile = (p) => values[Math.floor((values.length - 1) * p)];
    return { p05: percentile(0.05), p50: percentile(0.50), p95: percentile(0.95) };
  }, dataUrl);
}

async function contactSheet(page, entries, title) {
  return page.evaluate(async ({ items, heading }) => {
    const cell = 260, label = 34, columns = 3, rows = Math.ceil(items.length / columns);
    const canvas = document.createElement('canvas');
    canvas.width = cell * columns;
    canvas.height = 44 + (cell + label) * rows;
    const context = canvas.getContext('2d');
    context.fillStyle = '#050608';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#e7edf4';
    context.font = '600 18px system-ui';
    context.fillText(heading, 14, 28);
    for (let i = 0; i < items.length; i++) {
      const image = new Image();
      image.src = items[i].url;
      await image.decode();
      const x = (i % columns) * cell;
      const y = 44 + Math.floor(i / columns) * (cell + label);
      context.drawImage(image, x, y, cell, cell);
      context.fillStyle = '#11161d';
      context.fillRect(x, y + cell, cell, label);
      context.fillStyle = '#dfe7ef';
      context.font = '500 15px system-ui';
      context.fillText(items[i].id, x + 10, y + cell + 22);
    }
    return canvas.toDataURL('image/png');
  }, { items: entries, heading: title });
}

async function compare(page, a, b) {
  return page.evaluate(async ({ urlA, urlB }) => {
    const load = async (url) => {
      const image = new Image(); image.src = url; await image.decode(); return image;
    };
    const [imageA, imageB] = await Promise.all([load(urlA), load(urlB)]);
    const canvas = document.createElement('canvas');
    const thumb = 96;
    canvas.width = thumb; canvas.height = thumb;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const crop = Math.min(imageA.width, imageA.height) * 0.62;
    const sx = (imageA.width - crop) / 2, sy = (imageA.height - crop) / 2;
    context.drawImage(imageA, sx, sy, crop, crop, 0, 0, thumb, thumb);
    const aData = context.getImageData(0, 0, thumb, thumb).data;
    context.clearRect(0, 0, thumb, thumb);
    context.drawImage(imageB, sx, sy, crop, crop, 0, 0, thumb, thumb);
    const bData = context.getImageData(0, 0, thumb, thumb).data;
    // A low-pass subject crop measures structural/material parity without
    // treating a one-pixel raster edge or backend-specific star as a failure.
    let sum = 0, max = 0, samples = 0;
    for (let i = 0; i < aData.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        const delta = Math.abs(aData[i + channel] - bData[i + channel]);
        sum += delta; max = Math.max(max, delta); samples++;
      }
    }
    return { mae: sum / (samples * 255), max };
  }, { urlA: a, urlB: b });
}

async function main() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    throw new Error('dist/ missing — run npm run build first');
  }
  const server = await startPreview();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: findChromium(),
      // Chromium on Windows silently disables WebGPU in headless mode and
      // WebGPURenderer falls back to WebGL2. Headed mode is therefore a QA
      // requirement here, not a presentation choice; the assertion below
      // rejects any silent fallback.
      headless: false,
      args: ['--enable-unsafe-swiftshader'],
    });
    const captures = new Map();
    for (const requested of [
      { slug: 'webgpu', forceWebGL: false, expected: 'WebGPU' },
      { slug: 'webgl2', forceWebGL: true, expected: 'WebGL2' },
    ]) {
      console.log(`\n${requested.slug}:`);
      const { page, backend } = await boot(browser, requested.forceWebGL);
      ok(backend === requested.expected, `${requested.slug} requested and ${backend} initialized`);
      for (const view of VIEWS) {
        const sheetEntries = [];
        for (const id of IDS) {
          const dataUrl = await captureMoon(page, id, view.side);
          const key = `${requested.slug}-${view.name}-${id}`;
          captures.set(key, dataUrl);
          savePng(`${key}.png`, dataUrl);
          const stats = await imageStats(page, dataUrl);
          ok(stats.p95 - stats.p05 >= 8,
            `${view.name}/${id}: readable relief (p05=${stats.p05.toFixed(1)}, p95=${stats.p95.toFixed(1)})`);
          sheetEntries.push({ id, url: dataUrl });
        }
        savePng(
          `${requested.slug}-${view.name}-contact.png`,
          await contactSheet(page, sheetEntries, `${backend} · ${view.name} · raw · ultra`),
        );
      }
      await page.close();
    }

    const comparePage = await browser.newPage();
    console.log('\ncross-backend parity:');
    for (const view of VIEWS) {
      for (const id of IDS) {
        const diff = await compare(
          comparePage,
          captures.get(`webgpu-${view.name}-${id}`),
          captures.get(`webgl2-${view.name}-${id}`),
        );
        // Cross-backend raster/derivative lighting is not pixel-identical even
        // in raw mode. This is a gross structural guard; each backend already
        // passed the independent relief/readability checks above.
        ok(diff.mae <= 0.15,
          `${view.name}/${id}: bounded WebGPU↔WebGL2 structural MAE=${diff.mae.toFixed(5)} max=${diff.max}`);
      }
    }
    await comparePage.close();
  } finally {
    await browser?.close();
    server.kill();
  }
  console.log(failures === 0 ? '\nqa-irregular-moons: ALL SCENARIOS PASSED' :
    `\nqa-irregular-moons: ${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
