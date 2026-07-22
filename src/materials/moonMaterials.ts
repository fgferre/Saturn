/**
 * Procedural surfaces for the major moons. Each captures the moon's iconic
 * real features at "recognizable from orbit" fidelity: Herschel on Mimas,
 * tiger stripes on Enceladus, Ithaca Chasma on Tethys, Dione's wispy
 * terrain, Iapetus' two-tone dichotomy, Hyperion's sponge.
 *
 * All moons use local unit-sphere coordinates (geometry radius 1, scaled by
 * the mesh), so features stay put under tidal-locking rotation.
 */

import { Texture, Vector2, Vector3 } from 'three';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, cross, dot, faceDirection, float, mix,
  max, mul, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_float, normalize,
  normalView, normalWorld, oneMinus, positionLocal, positionView, positionWorld,
  pow, sign, sin, smoothstep, texture, vec3,
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { KM_PER_UNIT, MINOR_MOONS, MOONS } from '../data/saturn.ts';
import { MoonNodeMaterial, type HapkeParams } from './hapke.ts';
import { DirectMaskedStandardMaterial } from './directMaskedLighting.ts';
import { seasonalTiltUniform } from './sharedUniforms.ts';
import type { MoonRelief } from './textures.ts';

type NodeObj = ShaderNodeObject<Node>;

function icyBase(
  tint: [number, number, number], mottleScale: number, contrast: number, craterDepth = 0.18,
): NodeObj {
  const p = normalize(positionLocal);
  const mottle = mx_fractal_noise_float(p.mul(mottleScale), 5, 2.1, 0.55).mul(0.5).add(0.5);
  const craters = mx_worley_noise_float(p.mul(mottleScale * 2.3), 1.0);
  const brightness = mottle.mul(contrast).add(1 - contrast / 2)
    .mul(craters.mul(craterDepth).add(1 - craterDepth / 2));
  return vec3(...tint).mul(brightness) as unknown as NodeObj;
}

function makeMoonMaterial(colorNode: NodeObj): MeshStandardNodeMaterial {
  const m = new DirectMaskedStandardMaterial({ roughness: 0.95, metalness: 0 });
  m.colorNode = colorNode;
  return m;
}

/** Angular proximity (cos-space) of the surface point to a feature center. */
function capMask(center: Vector3, cosInner: number, cosOuter: number): NodeObj {
  const p = normalize(positionLocal);
  const d = dot(p, vec3(center.x, center.y, center.z));
  return smoothstep(cosOuter, cosInner, d) as unknown as NodeObj;
}

function mimas(): MeshStandardNodeMaterial {
  let color = icyBase([0.62, 0.61, 0.58], 6, 0.35);
  // Herschel crater: 130 km wide on a 198 km radius moon (~38° across),
  // centered on the leading hemisphere (+Z local under tidal locking).
  const center = new Vector3(0.3, 0.05, 0.95).normalize();
  const p = normalize(positionLocal);
  const d = dot(p, vec3(center.x, center.y, center.z));
  const floor = smoothstep(0.945, 0.965, d);
  const rim = smoothstep(0.925, 0.945, d).sub(smoothstep(0.955, 0.975, d));
  const peak = smoothstep(0.9985, 0.9995, d);
  color = mix(color, color.mul(0.78), floor) as typeof color;
  color = color.add(rim.mul(0.10)).add(peak.mul(0.15)) as typeof color;
  return makeMoonMaterial(color);
}

function enceladus(): MeshStandardNodeMaterial {
  const p = normalize(positionLocal);
  // Near-white, faintly blue — the most reflective body in the Solar System.
  let color = icyBase([0.98, 1.0, 1.02], 4, 0.08, 0.05);
  // Global curvilinear fractures (subtle).
  const cracks = smoothstep(0.03, 0.0, abs(mx_noise_float(p.mul(6.0), 1.0)));
  color = mix(color, vec3(0.72, 0.83, 0.86), cracks.mul(0.22)) as typeof color;
  // South polar terrain with the four "tiger stripe" sulci.
  const south = smoothstep(-0.62, -0.85, p.y);
  const stripeField = abs(sin(p.x.mul(14.0).add(mx_noise_float(p.mul(3.0), 1.0).mul(1.5))));
  const stripes = smoothstep(0.955, 0.995, stripeField).mul(south);
  color = mix(color, vec3(0.55, 0.72, 0.75), stripes.mul(0.6)) as typeof color;
  color = mix(color, color.mul(0.94), south.mul(0.4)) as typeof color;
  return makeMoonMaterial(color);
}

function tethys(): MeshStandardNodeMaterial {
  let color = icyBase([0.80, 0.79, 0.76], 5, 0.22);
  // Odysseus basin — 450 km on a 531 km radius moon.
  const ody = capMask(new Vector3(-0.5, 0.35, 0.79).normalize(), 0.93, 0.88);
  color = mix(color, color.mul(0.9).add(0.03), ody) as typeof color;
  // Ithaca Chasma: a great-circle trench ~3/4 around the moon.
  const p = normalize(positionLocal);
  const chasmaNormal = new Vector3(0.85, 0.15, -0.51).normalize();
  const band = abs(dot(p, vec3(chasmaNormal.x, chasmaNormal.y, chasmaNormal.z)));
  const trench = smoothstep(0.045, 0.015, band);
  color = mix(color, color.mul(0.75), trench.mul(0.8)) as typeof color;
  return makeMoonMaterial(color);
}

function dione(): MeshStandardNodeMaterial {
  const p = normalize(positionLocal);
  let color = icyBase([0.70, 0.69, 0.66], 5, 0.28);
  // Wispy terrain: bright ice-cliff filaments on the trailing hemisphere (-Z local).
  const filaments = smoothstep(0.025, 0.0, abs(mx_noise_float(p.mul(7.0), 1.0)));
  const trailing = smoothstep(0.0, 0.5, p.z.negate());
  color = color.add(filaments.mul(trailing).mul(0.22)) as typeof color;
  return makeMoonMaterial(color);
}

function rhea(): MeshStandardNodeMaterial {
  return makeMoonMaterial(icyBase([0.72, 0.70, 0.67], 7, 0.30));
}

function iapetus(): MeshStandardNodeMaterial {
  const p = normalize(positionLocal);
  const bright = icyBase([0.75, 0.73, 0.68], 5, 0.25);
  const dark = vec3(0.12, 0.085, 0.055).mul(
    mx_fractal_noise_float(p.mul(6), 4, 2.0, 0.5).mul(0.25).add(0.9),
  );
  // Cassini Regio covers the leading hemisphere (+Z local) with a ragged border.
  const border = mx_fractal_noise_float(p.mul(3.0), 4, 2.2, 0.55).mul(0.45);
  const leading = smoothstep(-0.15, 0.25, p.z.add(border));
  const color = mix(bright, dark, leading);
  return makeMoonMaterial(color as unknown as NodeObj);
}

interface IrregularSurfaceConfig {
  seed: number;
  base: [number, number, number];
  floor: [number, number, number];
  rim: [number, number, number];
  ridge: [number, number, number];
  macroScale: number;
  microScale: number;
  contrast: number;
  floorBlend: number;
  rimBlend: number;
  ridgeBlend: number;
  cavityDarken: number;
  bumpStrength: number;
  occlusion: number;
  roughness: number;
}

/**
 * Natural-color surface families for the CPU-sculpted irregular moons. These
 * deliberately avoid using a Worley field as albedo: regular cellular tiling
 * reads as scales, while Cassini shows discrete impacts over continuous ice or
 * dark regolith. Crater attributes come from irregularMoonGeometry.ts.
 */
const IRREGULAR_SURFACES: Record<string, IrregularSurfaceConfig> = {
  hyperion: {
    seed: 7.01, base: [0.56, 0.50, 0.41], floor: [0.105, 0.070, 0.045],
    rim: [0.79, 0.73, 0.62], ridge: [0.56, 0.50, 0.41],
    macroScale: 3.0, microScale: 13, contrast: 0.24,
    floorBlend: 0.94, rimBlend: 0.78, ridgeBlend: 0,
    cavityDarken: 0.08, bumpStrength: 0.025, occlusion: 0.20, roughness: 0.96,
  },
  pan: {
    seed: 1.01, base: [0.64, 0.62, 0.58], floor: [0.43, 0.41, 0.38],
    rim: [0.76, 0.74, 0.69], ridge: [0.72, 0.70, 0.66],
    macroScale: 4.0, microScale: 10, contrast: 0.12,
    floorBlend: 0.38, rimBlend: 0.30, ridgeBlend: 0.36,
    cavityDarken: 0.025, bumpStrength: 0.004, occlusion: 0.06, roughness: 0.97,
  },
  daphnis: {
    seed: 2.11, base: [0.67, 0.66, 0.62], floor: [0.48, 0.47, 0.43],
    rim: [0.79, 0.78, 0.73], ridge: [0.75, 0.74, 0.70],
    macroScale: 4.2, microScale: 10, contrast: 0.09,
    floorBlend: 0.30, rimBlend: 0.24, ridgeBlend: 0.42,
    cavityDarken: 0.018, bumpStrength: 0.003, occlusion: 0.04, roughness: 0.98,
  },
  atlas: {
    seed: 3.07, base: [0.61, 0.60, 0.56], floor: [0.41, 0.40, 0.37],
    rim: [0.75, 0.73, 0.68], ridge: [0.70, 0.68, 0.64],
    macroScale: 3.8, microScale: 11, contrast: 0.12,
    floorBlend: 0.38, rimBlend: 0.30, ridgeBlend: 0.38,
    cavityDarken: 0.025, bumpStrength: 0.004, occlusion: 0.06, roughness: 0.97,
  },
  prometheus: {
    seed: 4.01, base: [0.60, 0.59, 0.56], floor: [0.37, 0.36, 0.34],
    rim: [0.74, 0.73, 0.69], ridge: [0.60, 0.59, 0.56],
    macroScale: 3.4, microScale: 12, contrast: 0.16,
    floorBlend: 0.48, rimBlend: 0.38, ridgeBlend: 0,
    cavityDarken: 0.045, bumpStrength: 0.009, occlusion: 0.10, roughness: 0.96,
  },
  pandora: {
    seed: 5.03, base: [0.62, 0.60, 0.56], floor: [0.43, 0.41, 0.38],
    rim: [0.73, 0.72, 0.68], ridge: [0.62, 0.60, 0.56],
    macroScale: 3.2, microScale: 11, contrast: 0.12,
    floorBlend: 0.40, rimBlend: 0.24, ridgeBlend: 0,
    cavityDarken: 0.030, bumpStrength: 0.007, occlusion: 0.075, roughness: 0.98,
  },
  janus: {
    seed: 6.01, base: [0.63, 0.61, 0.57], floor: [0.37, 0.35, 0.32],
    rim: [0.78, 0.76, 0.71], ridge: [0.63, 0.61, 0.57],
    macroScale: 3.0, microScale: 12, contrast: 0.16,
    floorBlend: 0.56, rimBlend: 0.43, ridgeBlend: 0,
    cavityDarken: 0.050, bumpStrength: 0.010, occlusion: 0.12, roughness: 0.96,
  },
  epimetheus: {
    seed: 8.09, base: [0.61, 0.59, 0.55], floor: [0.34, 0.32, 0.29],
    rim: [0.77, 0.75, 0.70], ridge: [0.61, 0.59, 0.55],
    macroScale: 3.1, microScale: 12, contrast: 0.18,
    floorBlend: 0.62, rimBlend: 0.46, ridgeBlend: 0,
    cavityDarken: 0.055, bumpStrength: 0.011, occlusion: 0.13, roughness: 0.96,
  },
  phoebe: {
    seed: 9.07, base: [0.090, 0.082, 0.073], floor: [0.032, 0.027, 0.023],
    rim: [0.16, 0.145, 0.125], ridge: [0.090, 0.082, 0.073],
    macroScale: 3.6, microScale: 13, contrast: 0.24,
    floorBlend: 0.70, rimBlend: 0.58, ridgeBlend: 0,
    cavityDarken: 0.075, bumpStrength: 0.016, occlusion: 0.18, roughness: 0.98,
  },
};

const IRREGULAR_RADIUS_UNITS = new Map(
  [...MOONS, ...MINOR_MOONS].map((body) => [body.id, body.physical.radiusKm / KM_PER_UNIT]),
);

/** Screen-derivative bump mapping for seam-free object-space procedural noise. */
function proceduralNormal(height: NodeObj, strength: NodeObj): NodeObj {
  // Keep the view-position derivatives unnormalised: their pixel footprint is
  // what makes the surface-gradient formulation stable across distance/FOV.
  // The derivative limiter mirrors the reference asteroid shader and suppresses
  // sub-pixel sparkle without erasing close-up relief.
  const sigmaX = positionView.dFdx();
  const sigmaY = positionView.dFdy();
  const dHdX = height.dFdx();
  const dHdY = height.dFdy();
  const derivativeLimit = clamp(
    float(1).div(max(abs(dHdX), abs(dHdY)).mul(10).add(1)), 0.35, 1,
  );
  const r1 = cross(sigmaY, normalView);
  const r2 = cross(normalView, sigmaX);
  const determinant = dot(sigmaX, r1).mul(faceDirection);
  const gradient = sign(determinant).mul(
    dHdX.mul(r1).add(dHdY.mul(r2)).mul(strength).mul(derivativeLimit),
  );
  return normalize(abs(determinant).mul(normalView).sub(gradient)) as unknown as NodeObj;
}

function irregularSurface(id: string): MeshStandardNodeMaterial {
  const c = IRREGULAR_SURFACES[id];
  const radiusUnits = IRREGULAR_RADIUS_UNITS.get(id);
  if (radiusUnits === undefined) throw new Error(`Missing physical radius for irregular moon: ${id}`);
  const p = normalize(positionLocal);
  const offset = vec3(c.seed * 0.73, c.seed * -0.41, c.seed * 0.57);
  const macroRaw = mx_fractal_noise_float(p.mul(c.macroScale).add(offset), 5, 2.05, 0.52);
  const macro = clamp(macroRaw.mul(0.5).add(0.5), 0, 1);
  const microRaw = mx_fractal_noise_float(
    p.mul(c.microScale).add(offset.mul(3.1)), 4, 2.12, 0.48,
  );
  const micro = clamp(microRaw.mul(0.5).add(0.5), 0, 1);

  const floorMask = clamp(attribute('craterFloor', 'float'), 0, 1);
  const rimMask = clamp(attribute('craterRim', 'float'), 0, 1);
  const cavityMask = clamp(attribute('craterCavity', 'float'), 0, 1);
  const ridgeMask = clamp(attribute('accretionRidge', 'float'), 0, 1);

  const darkBase = vec3(...c.base).mul(1 - c.contrast);
  const lightBase = vec3(...c.base).mul(1 + c.contrast);
  let color: NodeObj = mix(darkBase, lightBase, macro) as unknown as NodeObj;
  color = color.mul(micro.mul(0.08).add(0.96));
  color = mix(color, vec3(...c.ridge), ridgeMask.mul(c.ridgeBlend));
  color = color.mul(oneMinus(cavityMask.mul(c.cavityDarken)));
  color = mix(color, vec3(...c.floor), floorMask.mul(c.floorBlend));
  color = mix(color, vec3(...c.rim), rimMask.mul(c.rimBlend));

  const material = makeMoonMaterial(clamp(color, 0, 1) as unknown as NodeObj);
  // Broad relief must dominate. A ridged high-frequency term made the moons
  // look uniformly scratched instead of impact-sculpted, especially under
  // grazing light; two isotropic FBM bands retain scale without that pattern.
  const bumpHeight = macroRaw.mul(0.62).add(microRaw.mul(0.38));
  const bumpAttenuation = oneMinus(ridgeMask.mul(0.68));
  material.normalNode = proceduralNormal(
    bumpHeight as unknown as NodeObj,
    // height is a fraction of local radius, while positionView is in scene
    // units; convert the amplitude so tiny moons do not receive giant slopes.
    float(c.bumpStrength * radiusUnits).mul(bumpAttenuation) as unknown as NodeObj,
  );
  material.roughnessNode = clamp(
    float(c.roughness).add(cavityMask.mul(0.025)).sub(rimMask.mul(0.035)), 0.74, 1,
  );
  material.aoNode = clamp(oneMinus(cavityMask.mul(c.occlusion)), 0.58, 1);
  return material;
}

function titanSurface(): MeshStandardNodeMaterial {
  // We never see Titan's surface — this is the top of its haze deck.
  const p = normalize(positionLocal);
  const lat = p.y;
  let color: NodeObj = mix(vec3(0.66, 0.40, 0.13), vec3(0.52, 0.29, 0.09), smoothstep(-0.2, 0.9, lat));
  // Seasonal polar hood: the detached haze cap sits over the WINTER pole and
  // migrates north↔south as Saturn's seasons turn, lagging insolation by ~2 yr
  // (West et al. 2016; Cassini ISS 2004–2017 recorded the cap's decay in the
  // spring hemisphere and its rebuild in the autumn one). Reuses the same
  // lagged forcing that grades Saturn's globe (F9.3): +value ⇒ north in winter.
  const forcing = seasonalTiltUniform;
  const AXIAL = float(0.4499); // ⚠ VERIFICAR: sin(Saturn obliquity 26.73°)
  // Winter-pole weight fades continuously through equinox as the sign flips.
  // ⚠ VERIFICAR: transition sharpness (forcing/AXIAL is a linear proxy; the
  // true cap turnover timescale is unpublished — West et al. 2016).
  const northWinter = clamp(forcing.div(AXIAL), 0, 1);
  const southWinter = clamp(forcing.negate().div(AXIAL), 0, 1);
  const northHood = smoothstep(0.72, 0.95, lat).mul(northWinter);
  const southHood = smoothstep(0.72, 0.95, lat.negate()).mul(southWinter);
  const hood = clamp(northHood.add(southHood), 0, 1);
  color = mix(color, vec3(0.45, 0.38, 0.28), hood.mul(0.5));
  // Extremely soft banding.
  const band = mx_noise_float(vec3(mul(lat, 6.0), 3.3, 7.7), 1.0).mul(0.05);
  color = color.add(band);
  const m = new DirectMaskedStandardMaterial({ roughness: 1, metalness: 0 });
  m.colorNode = color;
  // Haze scatters strongly toward the limb — bake a fresnel brightening in.
  // (Volumetric Titan haze shell is separate and not eclipsed in this wave.)
  const n = normalize(normalWorld);
  const V = normalize(cameraPosition.sub(positionWorld));
  const rim = pow(oneMinus(abs(dot(n, V))), 3.0);
  m.emissiveNode = vec3(0.95, 0.58, 0.25).mul(rim.mul(0.22));
  return m;
}

const BUILDERS: Record<string, () => MeshStandardNodeMaterial> = {
  mimas, enceladus, tethys, dione, rhea, iapetus, titan: titanSurface,
  hyperion: () => irregularSurface('hyperion'),
  pan: () => irregularSurface('pan'),
  daphnis: () => irregularSurface('daphnis'),
  atlas: () => irregularSurface('atlas'),
  prometheus: () => irregularSurface('prometheus'),
  pandora: () => irregularSurface('pandora'),
  janus: () => irregularSurface('janus'),
  epimetheus: () => irregularSurface('epimetheus'),
  phoebe: () => irregularSurface('phoebe'),
};

/**
 * The Schenk Cassini mosaics are IR/UV-enhanced color — great detail, but the
 * hues are exaggerated vs natural color (icy moons are near-neutral white).
 * Desaturate toward luminance and lift brightness per real albedo.
 */
const MAP_GRADING: Record<string, { desat: number; gain: number }> = {
  enceladus: { desat: 0.55, gain: 1.35 }, // brightest body in the Solar System
  mimas: { desat: 0.35, gain: 1.05 },
  tethys: { desat: 0.4, gain: 1.1 },
  dione: { desat: 0.35, gain: 1.0 },
  rhea: { desat: 0.35, gain: 1.0 },
  iapetus: { desat: 0.2, gain: 1.0 }, // keep Cassini Regio's reddish-brown
};

/**
 * Saturnshine: the night sides of the inner moons are visibly lit by the
 * planet (and its rings). Modeled as a soft cream glow on the Saturn-facing
 * hemisphere, falling off with the planet's apparent size squared.
 */
function saturnshine(): NodeObj {
  const toSaturn = normalize(positionWorld.negate()); // Saturn sits at the origin
  const facing = clamp(dot(normalize(normalWorld), toSaturn), 0, 1);
  const dist = positionWorld.length();
  // Gain lifted slightly after removing AmbientLight (F7.3).
  const apparent = clamp(pow(mul(60.268, 1).div(dist), 2).mul(0.62), 0, 0.10);
  return vec3(1.0, 0.93, 0.75).mul(facing.mul(apparent)) as unknown as NodeObj;
}

/** Per-moon Hapke photometry tweaks (icier = brighter surge). */
const HAPKE_TUNING: Record<string, Partial<HapkeParams>> = {
  enceladus: { surgeAmplitude: 1.3, g: -0.35 },
  mimas: { surgeAmplitude: 1.0 },
  tethys: { surgeAmplitude: 1.0 },
  iapetus: { surgeAmplitude: 0.6, g: -0.2 },
};

export function createMoonMaterial(
  id: string,
  map?: Texture | null,
  // Direct-sunlight mask: 0..1 scalar or an RGB vec3 (eclipse × atmosphere
  // tint, so umbral moons redden to copper instead of neutral grey). Both
  // lighting paths below do lightColor.mul(mask), so either type works.
  directLightMask?: Node,
  relief?: MoonRelief | null,
): MeshStandardNodeMaterial {
  // Real Cassini mosaic when available (Titan keeps its haze material and
  // Hyperion its sponge — their looks aren't well served by an albedo map).
  let m: MeshStandardNodeMaterial;
  if (map && id !== 'titan' && id !== 'hyperion') {
    m = new MoonNodeMaterial(HAPKE_TUNING[id]);
    const grade = MAP_GRADING[id] ?? { desat: 0.3, gain: 1.0 };
    // No explicit uvNode: passing one would bypass the texture matrix and
    // drop the offset.x=0.5 longitude alignment (three r178 TextureNode).
    const mapCol = texture(map).rgb;
    const lum = dot(mapCol, vec3(0.2126, 0.7152, 0.0722));
    // Subtle high-frequency mottle keeps close-ups from looking flat where
    // the mosaic resolution runs out.
    const p = normalize(positionLocal);
    const detail = mx_fractal_noise_float(p.mul(24), 3, 2.1, 0.5).mul(0.06).add(1.0);
    m.colorNode = clamp(
      mix(mapCol, vec3(lum, lum, lum), grade.desat).mul(grade.gain).mul(detail),
      0, 1,
    );

    if (relief) {
      // Real (or documented-synthetic) topography: radial displacement in the
      // vertex stage + physically scaled normal map. `.level(0)` keeps the
      // sample valid in the vertex stage on both backends.
      const h = texture(relief.height).level(float(0)).r;
      const radial = h.mul(relief.scale).add(1 + relief.bias);
      m.positionNode = positionLocal.mul(radial);
      m.normalMap = relief.normal;
      m.normalScale = new Vector2(1.2, 1.2);
    } else {
      // Grazing-light relief faked from the albedo map.
      m.bumpMap = map;
      m.bumpScale = 0.02;
    }
  } else {
    const builder = BUILDERS[id];
    m = builder ? builder() : makeMoonMaterial(icyBase([0.7, 0.7, 0.68], 5, 0.25));
  }

  // Eclipse / ring shadow: attenuate *direct* sunlight only (Onda 2).
  // Albedo and saturnshine emissive stay full so night-side planet-glow
  // remains visible inside Saturn's umbra. The mask is an RGB vec3 (F9.6):
  // reddened penumbral light tints the moon copper in the umbra.
  if (directLightMask) {
    if (m instanceof MoonNodeMaterial) {
      m.directLightMask = directLightMask;
    } else if (m instanceof DirectMaskedStandardMaterial) {
      m.directLightMask = directLightMask;
    }
  }
  // Saturnshine on the planet-facing hemisphere (emissive — not eclipsed).
  const shine = saturnshine();
  m.emissiveNode = m.emissiveNode ? (m.emissiveNode as NodeObj).add(shine) : shine;
  return m;
}
