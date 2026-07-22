/**
 * Onda 4 / F7 self-check — physical sun, single light source, penumbra, glare.
 * Run via `npm run check`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import {
  SUN_ANGULAR_RADIUS,
  solarAtmosphereTint,
  sunVisibilityFromCamera,
  saturnShadowOnMoon,
} from './physics/eclipse.ts';
import {
  SUN_APPARENT_SCALE,
  SUN_DISK_RADIUS,
  SUN_DISK_SCALE,
  SUN_DISK_UV_RADIUS,
  SUN_DISPLAY_RADIANCE,
  SUN_FOLLOW_DISTANCE,
  SUN_SEED_CORE_RADIANCE,
  SUN_SEED_SCALE,
  DISPLAY_SUN_LAYER,
  SOLAR_LAYER,
} from './scene/Sun.ts';
import {
  PRESETS,
  dprStepsFor,
  qualityPinFromSearch,
  quantizeDpr,
  resolveMsaaSamples,
} from './core/quality.ts';

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

const base = dirname(fileURLToPath(import.meta.url));

// --- F7.1 size from single physical source ----------------------------------
{
  const expectedR = SUN_ANGULAR_RADIUS * SUN_FOLLOW_DISTANCE * SUN_APPARENT_SCALE;
  assert.near(SUN_DISK_RADIUS, expectedR, 1e-9, 'disk radius from physics');
  const angDiaDeg = (2 * SUN_ANGULAR_RADIUS * SUN_APPARENT_SCALE * 180) / Math.PI;
  // Physical ~0.057°; with scale 3.5 ≈ 0.2° — still ≪ old ~1.3° blur.
  assert.ok(angDiaDeg > 0.05 && angDiaDeg < 0.5, `apparent diameter ${angDiaDeg}° out of band`);
  assert.ok(SUN_DISK_UV_RADIUS < 0.35, 'disk must leave AA margin inside the quad');
  assert.ok(SUN_DISPLAY_RADIANCE >= 40, 'display radiance must saturate AgX');
  assert.ok(SUN_SEED_SCALE > SUN_DISK_SCALE * 0.9, 'seed covers the disk footprint');
  assert.ok(Number(DISPLAY_SUN_LAYER) !== Number(SOLAR_LAYER), 'layers distinct');
}

// --- F7.3 no AmbientLight in Sun.ts ----------------------------------------
{
  const sunSrc = readFileSync(join(base, 'scene/Sun.ts'), 'utf8');
  assert.ok(
    !/new\s+AmbientLight/.test(sunSrc) && !/from 'three'[\s\S]*AmbientLight/.test(sunSrc.split('constructor')[0]),
    'F7.3: AmbientLight must not be constructed in Sun.ts',
  );
  assert.ok(!sunSrc.includes('new AmbientLight'), 'F7.3: no AmbientLight instance');
  assert.ok(sunSrc.includes('limb') || sunSrc.includes('Limb') || sunSrc.includes('mu'),
    'limb darkening present');
  assert.ok(!/circularFalloff\(0\.08,\s*0\.48\)/.test(sunSrc), 'old painted halo removed');
  assert.ok(sunSrc.includes('fwidth'), 'disk edge uses fwidth AA');
  assert.ok(sunSrc.includes('oneMinus(smoothstep'), 'portable smoothstep form');
  // Seed skirt windowed to 0 at quad edge (no faint square frame in FOV-close).
  assert.ok(
    sunSrc.includes('edgeVal') || sunSrc.includes('0.42') || /lorentz\.sub\(/.test(sunSrc),
    'seed Lorentz skirt must be windowed to zero at r=0.5',
  );
}

// --- F7.2 moon occultation of the solar disk -------------------------------
{
  const cam = new Vector3(0, 0, 300);
  const sunDir = new Vector3(0, 0, 1); // sun at +Z infinity
  // Moon between camera and sun (z > cam.z) covering the LOS.
  const moon = { pos: new Vector3(0, 0, 450), radius: 5 };
  const clear = sunVisibilityFromCamera(cam, sunDir, () => 0, []);
  assert.near(clear, 1, 1e-6, 'empty sky: full visibility');
  const eclipsed = sunVisibilityFromCamera(cam, sunDir, () => 0, [moon]);
  assert.ok(eclipsed < 0.2, `moon on LOS should occult glare (got ${eclipsed})`);
  // Moon off-axis: little occultation
  const side = sunVisibilityFromCamera(
    cam, sunDir, () => 0, [{ pos: new Vector3(80, 0, 450), radius: 2 }],
  );
  assert.ok(side > 0.85, `off-axis moon should barely affect glare (got ${side})`);
}

// --- F7.5 atmosphere tint reddens near the limb (strong enough for AgX) ---
{
  const out = new Vector3();
  solarAtmosphereTint(new Vector3(0, 0, 500), new Vector3(0, 0, 1), out);
  assert.near(out.x, 1, 0.05, 'far clear tint R');
  // REQ≈60.27, Ra≈61.77 — place at b=61.2 so the ray clips the shell.
  solarAtmosphereTint(new Vector3(61.2, 0, 0), new Vector3(0, 0, 1), out);
  assert.ok(out.z < out.x - 1e-4, `limb tint should be redder (R=${out.x} B=${out.z})`);
  // Must pull 90×radiance into AgX shoulder: tint·90 ≲ 8 on the blue channel.
  assert.ok(out.x * 90 < 25, `grazing R·90 should leave AgX white (got ${out.x * 90})`);
  assert.ok(out.z * 90 < 8, `grazing B·90 should be extinguished (got ${out.z * 90})`);
}

// --- F7.4 penumbra present in saturnMaterial --------------------------------
{
  const src = readFileSync(join(base, 'materials/saturnMaterial.ts'), 'utf8');
  assert.ok(src.includes('SUN_ANGULAR_RADIUS'), 'ring penumbra uses solar angular radius');
  assert.ok(src.includes('penRu') || src.includes('0.25'), '3-sample penumbra weights');
  assert.ok(src.includes('0.78') || src.includes('ringshine'), 'ringshine gain present');
}

// --- preset ladder: only WebGPU-expressible sample counts -------------------
{
  // 2× MSAA does not exist on WebGPU: three promotes the pipeline to 4 but
  // builds the attachment from the raw value, and the pass renders nothing.
  for (const p of Object.values(PRESETS)) {
    assert.ok(
      p.msaaSamples === 0 || p.msaaSamples === 4,
      `${p.name}: msaaSamples must be 0 or 4 (got ${p.msaaSamples}) — WebGPU has no 2×`,
    );
  }

  assert.near(resolveMsaaSamples(0, 'WebGPU'), 0, 0, 'WebGPU 0× stays disabled');
  assert.near(resolveMsaaSamples(2, 'WebGPU'), 4, 0, 'WebGPU 2× promotes to legal 4×');
  assert.near(resolveMsaaSamples(4, 'WebGPU'), 4, 0, 'WebGPU 4× stays 4×');
  assert.near(resolveMsaaSamples(2, 'WebGL2'), 2, 0, 'WebGL2 keeps legal 2×');

  assert.near(quantizeDpr(0.5, 1), 0.75, 0, 'DPR respects the 0.75 floor');
  assert.near(quantizeDpr(1.1, 2), 1, 0, 'non-step DPR quantizes at boot');
  assert.near(quantizeDpr(1.25, 2), 1.25, 0, 'exact DPR step survives');
  assert.near(quantizeDpr(2, 1.5), 1.5, 0, 'DPR cap is enforced');
  assert.ok(dprStepsFor(1.5).join(',') === '0.75,1,1.25,1.5', 'Med DPR ladder');

  assert.ok(qualityPinFromSearch('?quality=high') === 'high', 'valid quality pin');
  assert.ok(qualityPinFromSearch('?quality=__proto__') === null, 'prototype pin rejected');
  assert.ok(qualityPinFromSearch('?quality=bogus') === null, 'unknown quality pin rejected');

  // F10.1 is only real when the baked assets ship. A silent fallback to the
  // originals makes Low/Med pay the full download after seven avoidable 404s.
  const textureRoot = join(base, '..', 'public', 'textures');
  for (const tier of ['1k', '2k']) {
    for (const id of ['saturn', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'iapetus']) {
      assert.ok(existsSync(join(textureRoot, tier, `${id}.jpg`)), `${tier}/${id}.jpg baked`);
    }
  }
}

// --- Engine radial beauty bloom + painted solar path -----------------------
{
  const eng = readFileSync(join(base, 'core/Engine.ts'), 'utf8');
  assert.ok(eng.includes('bloomCamera.layers.set(0)'), 'beauty bloom never sees sun disk');
  assert.ok(eng.includes('radialBloom(bloomSrc'), 'beauty bloom uses the radial Gaussian path');
  assert.ok(!eng.includes('BloomNode.js'), 'Engine must not restore rectangular BloomNode mips');
  // Round glare from the painted seed pass, with no BloomNode softener.
  assert.ok(eng.includes('solarSource') || eng.includes('solarPass'), 'solar source pass present');
  assert.ok(eng.includes('solarGate') || eng.includes('solarTintUniform'), 'tint×vis gate');
  assert.ok(
    !/bloom\(solarPass/.test(eng) && !eng.includes('solarSoft'),
    'solar path has no mip softener (square-halo regression)',
  );
  assert.ok(
    /this\.postMode !== 'raw' && this\.postMode !== 'bloom'/.test(eng),
    '?post=bloom isolates beauty bloom from solar glare',
  );
  // Capture must not call setSize (black-frame regression on WebGPU PassNode).
  assert.ok(
    !/async capture[\s\S]*setSize\(/.test(eng),
    'capture must not resize the renderer (PassNode black-frame bug)',
  );
  // Concurrent captures cross their setRenderTarget restores and leak an RT.
  assert.ok(
    /async capture[\s\S]{0,400}if \(this\.capturing\) throw/.test(eng),
    'capture must reject a second in-flight call',
  );
  // WebGPU has no 2× MSAA: `samples: 2` (Med) rendered an empty frame.
  assert.ok(
    eng.includes('resolveMsaaSamples(quality.msaaSamples, this.backendName)'),
    'base pass must resolve a backend-legal MSAA sample count',
  );
  assert.ok(
    !/pass\(this\.scene, this\.camera, \{ samples: quality\.msaaSamples \}\)/.test(eng),
    'base pass must consume the clamped sample count, not the raw preset',
  );

  // A pinned ?quality must not survive an explicit HUD pick (load() reads the
  // pin first, so leaving it in place makes the buttons store-and-ignore).
  const qual = readFileSync(join(base, 'core/quality.ts'), 'utf8');
  assert.ok(
    /searchParams\.delete\('quality'\)[\s\S]{0,120}location\.replace/.test(qual),
    'setQuality must drop the ?quality pin when reloading',
  );
  assert.ok(
    /qualityPinFromSearch\(location\.search\)[\s\S]{0,120}localStorage\.getItem\(TUNED_KEY\)/
      .test(qual),
    'ephemeral quality pin must disable the persistent one-shot auto-tuner',
  );

  // Every resize event applying setSize = swapchain + PassNode RT realloc per
  // mouse move while dragging a window edge.
  assert.ok(
    /'resize',[\s\S]{0,200}requestAnimationFrame\(/.test(eng),
    'resize handler must coalesce to one apply per frame',
  );
}

// --- main: visibility smoothing + moon disks --------------------------------
{
  const main = readFileSync(join(base, 'main.ts'), 'utf8');
  assert.ok(main.includes('sunVisibilityFromCamera'), 'glare uses full visibility helper');
  assert.ok(main.includes('sunVisSmoothed') || main.includes('HALF_LIFE'), 'temporal smooth');
  assert.ok(main.includes('solarAtmosphereTint'), 'limb tint applied each frame');
  assert.ok(main.includes('dprStepsFor(quality.dprCap)'), 'runtime and HUD share DPR ladder');
  // Photo DPR bump must stay bounded — a phone viewport asks for ~4.8.
  assert.ok(
    /PHOTO_MAX_HEIGHT[\s\S]{0,600}Math\.min\(PHOTO_WIDTH \/ cssWidth, PHOTO_MAX_HEIGHT \/ cssHeight\)/
      .test(main),
    'photo pixel ratio must be capped by buffer height (mobile VRAM)',
  );
}

// saturnShadowOnMoon still used for moon eclipses (not removed)
assert.ok(typeof saturnShadowOnMoon === 'function', 'moon eclipse helper intact');

console.log('wave4 selfcheck: all assertions passed');
console.log(
  `  angular dia≈${((2 * SUN_ANGULAR_RADIUS * SUN_APPARENT_SCALE * 180) / Math.PI).toFixed(3)}° ` +
  `scale=${SUN_APPARENT_SCALE} diskR=${SUN_DISK_RADIUS.toFixed(3)} rad=${SUN_DISPLAY_RADIANCE}/${SUN_SEED_CORE_RADIANCE}`,
);
console.log('  no AmbientLight; moon glare occultation; limb tint; ring penumbra samples');
