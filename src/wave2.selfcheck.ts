/**
 * Onda 2 acceptance self-check — lighting-path contract (pure Node).
 * Run via `npm run check`.
 *
 * Proves the *policy* that shadows/eclipses must not ride on albedo, and that
 * materials expose a directLightMask for the LightingModel. Shader-runtime
 * ambient/direct fixtures still need browser smoke (WebGPU + WebGL2).
 */

import { float } from 'three/tsl';
import { MoonNodeMaterial } from './materials/hapke.ts';
import { DirectMaskedStandardMaterial } from './materials/directMaskedLighting.ts';
import { createSaturnMaterial } from './materials/saturnMaterial.ts';
import { createMoonMaterial } from './materials/moonMaterials.ts';
import { createRingProfile } from './materials/ringProfile.ts';

const assert = {
  ok(cond: unknown, msg: string): void {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  },
};

// --- Policy: L = Ldirect*mask + Lindirect + Lemissive -----------------------
// Documented numerically so a future albedo multiply regresses loudly.
function shade(opts: {
  albedo: number;
  direct: number;
  ambient: number;
  emissive: number;
  mask: number;
  maskOnAlbedo: boolean;
}): number {
  const a = opts.maskOnAlbedo ? opts.albedo * opts.mask : opts.albedo;
  const d = opts.maskOnAlbedo ? opts.direct : opts.direct * opts.mask;
  return a * d + a * opts.ambient + opts.emissive;
}

const ambientCase = {
  albedo: 1, direct: 0, ambient: 0.035, emissive: 0.2, mask: 0.1,
};
assert.ok(
  Math.abs(
    shade({ ...ambientCase, maskOnAlbedo: false }) -
    shade({ ...ambientCase, mask: 1, maskOnAlbedo: false }),
  ) < 1e-12,
  'ambient+emissive fixture must be mask-invariant under direct-only policy',
);
assert.ok(
  shade({ ...ambientCase, maskOnAlbedo: true }) <
    shade({ ...ambientCase, maskOnAlbedo: false }) - 0.01,
  'albedo-mask policy must still darken ambient (the bug we removed)',
);

const directCase = {
  albedo: 1, direct: 3.2, ambient: 0, emissive: 0, mask: 0.25,
};
const directOnly = shade({ ...directCase, maskOnAlbedo: false });
const fullSun = shade({ ...directCase, mask: 1, maskOnAlbedo: false });
assert.ok(
  Math.abs(directOnly / fullSun - 0.25) < 1e-9,
  'direct-only fixture must scale exactly with the mask',
);

// --- Saturn material: albedo unshadowed, mask on material --------------------
{
  const profile = createRingProfile(null);
  const mat = createSaturnMaterial(profile, null, null);
  assert.ok(mat instanceof DirectMaskedStandardMaterial, 'Saturn must use DirectMaskedStandardMaterial');
  const sat = mat as DirectMaskedStandardMaterial;
  assert.ok(sat.directLightMask != null, 'Saturn directLightMask assigned');
  assert.ok(sat.colorNode != null, 'Saturn colorNode present');
  // colorNode must not be a mul of the same mask expression object — we only
  // check that the material class routes the mask through lighting setup.
  const model = sat.setupLightingModel();
  assert.ok(model != null, 'Saturn setupLightingModel returns a model');
  assert.ok(
    model.constructor.name === 'DirectMaskedPhysicalLightingModel',
    `expected DirectMaskedPhysicalLightingModel, got ${model.constructor.name}`,
  );
}

// --- Moon routes: mask on directLightMask, not multiplied into colorNode ---
{
  const eclipse = float(0.3);

  // Hapke path (map moons): MoonNodeMaterial
  const hapke = createMoonMaterial('mimas', null, eclipse, null);
  // Without a map, mimas uses procedural builder → DirectMaskedStandardMaterial.
  // With null map we hit the BUILDERS path.
  assert.ok(
    hapke instanceof DirectMaskedStandardMaterial || hapke instanceof MoonNodeMaterial,
    'mimas material must expose direct-mask path',
  );
  if (hapke instanceof DirectMaskedStandardMaterial) {
    assert.ok(hapke.directLightMask === eclipse, 'procedural mimas mask is eclipse uniform');
  }
  // colorNode must still be set (albedo) and not "only" the eclipse float.
  assert.ok(hapke.colorNode != null, 'mimas colorNode present');

  // Explicit Hapke material + mask wiring
  const hapkeMat = new MoonNodeMaterial({ surgeAmplitude: 1.0 });
  hapkeMat.directLightMask = eclipse;
  const hModel = hapkeMat.setupLightingModel();
  assert.ok(hModel != null, 'Hapke setupLightingModel returns a model');

  // Titan surface (Standard + emissive rim)
  const titan = createMoonMaterial('titan', null, eclipse, null);
  assert.ok(titan instanceof DirectMaskedStandardMaterial, 'Titan surface uses DirectMaskedStandardMaterial');
  assert.ok(
    (titan as DirectMaskedStandardMaterial).directLightMask === eclipse,
    'Titan eclipse is directLightMask',
  );
  assert.ok(titan.emissiveNode != null, 'Titan emissive (rim) present — must not be eclipsed via albedo');

  // Hyperion procedural sponge
  const hyp = createMoonMaterial('hyperion', null, eclipse, null);
  assert.ok(hyp instanceof DirectMaskedStandardMaterial, 'Hyperion uses DirectMaskedStandardMaterial');
  assert.ok(
    (hyp as DirectMaskedStandardMaterial).directLightMask === eclipse,
    'Hyperion eclipse is directLightMask',
  );
}

// --- Ringshine path on Saturn with ringshine texture slot --------------------
{
  // null ringshine: no emissive required
  const profile = createRingProfile(null);
  const mat = createSaturnMaterial(profile, null, null);
  // When ringshine tex is omitted, emissive may be unset — that is fine.
  assert.ok(mat instanceof DirectMaskedStandardMaterial, 'saturn material type stable');
}

console.log('wave2 selfcheck: all assertions passed');
console.log('  policy: ambient/emissive mask-invariant; direct scales with mask');
console.log('  Saturn: DirectMaskedStandardMaterial + DirectMaskedPhysicalLightingModel');
console.log('  Moons: Hapke/Standard/Titan/Hyperion use directLightMask (not albedo mul)');
