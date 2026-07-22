#!/usr/bin/env node
/**
 * Production-browser regression for the complete quality ladder.
 *
 * Covers every preset on real WebGPU and forced WebGL2, verifies that the
 * scene pass is non-black, confirms Low/Med load their baked texture tiers,
 * and exercises the URL-pin/manual-switch/DPR contracts that pure selfchecks
 * cannot prove across a reload.
 *
 * Run `npm run build` first, then `npm run qa:quality`.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4174;
const PRESETS = ['low', 'med', 'high', 'ultra'];
const TIER_IDS = ['saturn', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'iapetus'];
let failures = 0;

function ok(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else {
    failures++;
    console.error(`  FAIL ${message}`);
  }
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
  const candidates = full.filter(existsSync).sort();
  const fallback = shells.filter(existsSync).sort();
  if (candidates.length) return candidates.at(-1);
  if (fallback.length) return fallback.at(-1);
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
    } catch { /* preview not ready */ }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('vite preview did not start within 30 s');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function pageUrl(preset, backend, { notune = true } = {}) {
  const params = new URLSearchParams({ quality: preset, qa: '1', post: 'raw' });
  if (notune) params.set('notune', '');
  if (backend === 'WebGL2') params.set('webgl', '');
  return `http://127.0.0.1:${PORT}/?${params}`;
}

async function waitForSaturn(page) {
  await page.waitForFunction(() => window.__saturn !== undefined, null, { timeout: 300000 });
}

async function captureStats(page) {
  return page.evaluate(async () => {
    const saturn = window.__saturn;
    saturn.engine.renderer.setAnimationLoop(null);
    saturn.clock.paused = true;
    saturn.clock.jd = 2461222.5;
    saturn.controls.controls.enableDamping = false;
    saturn.engine.camera.position.set(200, 80, 250);
    saturn.controls.controls.target.set(0, 0, 0);
    for (let i = 0; i < 8; i++) await saturn.step(1 / 60);
    await saturn.engine.capture(640, true); // prime synthetic pose/RT transition
    const dataUrl = await saturn.engine.capture(640, true);
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let luminance = 0;
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const value = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      luminance += value;
      if (value > 5) lit++;
    }
    const count = pixels.length / 4;
    return {
      backend: saturn.engine.backendName,
      dpr: saturn.engine.renderer.getPixelRatio(),
      active: document.querySelector('.hud-quality button.active')?.textContent,
      mean: luminance / count,
      litPct: 100 * lit / count,
    };
  });
}

async function qualityMatrix(browser) {
  console.log('quality matrix: 4 presets × WebGPU/WebGL2');
  for (const expectedBackend of ['WebGPU', 'WebGL2']) {
    for (const preset of PRESETS) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      });
      const pageErrors = [];
      const textureResponses = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('response', (response) => {
        if (response.url().includes('/textures/')) {
          textureResponses.push({ url: response.url(), status: response.status() });
        }
      });
      await page.goto(pageUrl(preset, expectedBackend), { waitUntil: 'load', timeout: 300000 });
      await waitForSaturn(page);
      const stats = await captureStats(page);
      const label = `${expectedBackend}/${preset}`;
      ok(stats.backend === expectedBackend, `${label}: backend confirmed`);
      ok(stats.active?.toLowerCase() === preset, `${label}: active preset confirmed`);
      ok(stats.dpr === 1, `${label}: pinned 1× DPR`);
      ok(stats.mean > 5 && stats.litPct > 5,
        `${label}: non-black raw scene (mean ${stats.mean.toFixed(2)}, lit ${stats.litPct.toFixed(1)}%)`);
      ok(pageErrors.length === 0, `${label}: no page errors`);
      ok(!textureResponses.some((entry) => entry.status >= 400), `${label}: no texture HTTP errors`);

      const tier = preset === 'low' ? '1k' : preset === 'med' ? '2k' : null;
      if (tier) {
        for (const id of TIER_IDS) {
          const suffix = `/textures/${tier}/${id}.jpg`;
          ok(
            textureResponses.some((entry) => new URL(entry.url).pathname.endsWith(suffix) && entry.status === 200),
            `${label}: ${tier}/${id}.jpg served`,
          );
        }
      }
      await page.close();
    }
  }
}

async function switchingFlow(browser) {
  console.log('manual switch: pinned Med → saved High');
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(pageUrl('med', 'WebGL2'), { waitUntil: 'load', timeout: 300000 });
  await waitForSaturn(page);
  await Promise.all([
    page.waitForURL((url) => !url.searchParams.has('quality'), { timeout: 300000 }),
    page.getByRole('button', { name: 'High', exact: true }).click(),
  ]);
  await waitForSaturn(page);
  const state = await page.evaluate(() => ({
    active: document.querySelector('.hud-quality button.active')?.textContent,
    saved: localStorage.getItem('saturn.quality'),
    qualityInUrl: new URLSearchParams(location.search).has('quality'),
    focusInUrl: new URLSearchParams(location.search).get('focus'),
  }));
  ok(state.active === 'High', 'manual switch applies High after reload');
  ok(state.saved === 'high', 'manual switch persists High');
  ok(!state.qualityInUrl, 'manual switch removes the stale quality pin');
  ok(state.focusInUrl === 'saturn', 'manual switch preserves view state');
  await page.close();
}

async function pinAndDprContracts(browser) {
  console.log('pin persistence and DPR contracts');
  const pinned = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await pinned.goto(pageUrl('high', 'WebGL2', { notune: false }), {
    waitUntil: 'load', timeout: 300000,
  });
  await waitForSaturn(pinned);
  const pinState = await pinned.evaluate(() => {
    window.__saturn.engine.renderer.setAnimationLoop(null);
    localStorage.clear();
    window.__saturn.autoTuneDown(10);
    return {
      saved: localStorage.getItem('saturn.quality'),
      tuned: localStorage.getItem('saturn.autotuned'),
    };
  });
  ok(pinState.saved === null && pinState.tuned === null,
    'ephemeral quality pin cannot mutate persistent auto-tune state');
  await pinned.close();

  const lowDpr = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 0.5,
  });
  await lowDpr.goto(pageUrl('low', 'WebGL2'), { waitUntil: 'load', timeout: 300000 });
  await waitForSaturn(lowDpr);
  const dprState = await lowDpr.evaluate(() => ({
    renderer: window.__saturn.engine.renderer.getPixelRatio(),
    hud: document.querySelector('.dpr')?.textContent,
  }));
  ok(dprState.renderer === 0.75, 'device DPR 0.5 clamps to the 0.75 floor');
  ok(dprState.hud === '0.75×', 'HUD reports the exact applied DPR');
  await lowDpr.close();
}

async function main() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    throw new Error('dist/ missing — run `npm run build` before qa:quality');
  }
  const executablePath = findChromium();
  console.log(`chromium: ${executablePath}`);
  const server = await startPreview();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--enable-unsafe-swiftshader'],
    });
    await qualityMatrix(browser);
    await switchingFlow(browser);
    await pinAndDprContracts(browser);
  } finally {
    await browser?.close();
    server.kill();
  }
  console.log(failures === 0 ? '\nqa-quality: ALL SCENARIOS PASSED' : `\nqa-quality: ${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
