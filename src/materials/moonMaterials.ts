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
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  abs, cameraPosition, clamp, dot, float, mix, mul, mx_fractal_noise_float,
  mx_noise_float, mx_worley_noise_float, normalize, normalWorld, oneMinus,
  positionLocal, positionWorld, pow, sin, smoothstep, texture, vec3,
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { MoonNodeMaterial, type HapkeParams } from './hapke.ts';
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
  const m = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
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

function hyperion(): MeshStandardNodeMaterial {
  const p = normalize(positionLocal);
  // Sponge look: worley cells as deep dark pores.
  const pores = mx_worley_noise_float(p.mul(9.0), 1.0);
  const tan = vec3(0.58, 0.49, 0.37);
  const color = tan.mul(clamp(pow(pores, 1.4).mul(1.15).add(0.12), 0, 1))
    .mul(mx_fractal_noise_float(p.mul(4), 4, 2.0, 0.5).mul(0.3).add(0.85));
  return makeMoonMaterial(color as unknown as NodeObj);
}

function titanSurface(): MeshStandardNodeMaterial {
  // We never see Titan's surface — this is the top of its haze deck.
  const p = normalize(positionLocal);
  const lat = p.y;
  let color: NodeObj = mix(vec3(0.82, 0.55, 0.24), vec3(0.70, 0.42, 0.16), smoothstep(-0.2, 0.9, lat));
  // North polar hood: darker, slightly bluish collar.
  color = mix(color, vec3(0.45, 0.38, 0.28), smoothstep(0.72, 0.95, lat).mul(0.5));
  // Extremely soft banding.
  const band = mx_noise_float(vec3(mul(lat, 6.0), 3.3, 7.7), 1.0).mul(0.05);
  color = color.add(band);
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  m.colorNode = color;
  // Haze scatters strongly toward the limb — bake a fresnel brightening in.
  const n = normalize(normalWorld);
  const V = normalize(cameraPosition.sub(positionWorld));
  const rim = pow(oneMinus(abs(dot(n, V))), 3.0);
  m.emissiveNode = vec3(0.95, 0.58, 0.25).mul(rim.mul(0.22));
  return m;
}

const BUILDERS: Record<string, () => MeshStandardNodeMaterial> = {
  mimas, enceladus, tethys, dione, rhea, iapetus, hyperion, titan: titanSurface,
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
  const apparent = clamp(pow(mul(60.268, 1).div(dist), 2).mul(0.5), 0, 0.08);
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
  eclipseLight?: Node,
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

  // Eclipse darkening (Saturn's umbra + ring shadows), computed on the CPU.
  if (eclipseLight && m.colorNode) {
    m.colorNode = (m.colorNode as NodeObj).mul(eclipseLight);
  }
  // Saturnshine on the planet-facing hemisphere.
  const shine = saturnshine();
  m.emissiveNode = m.emissiveNode ? (m.emissiveNode as NodeObj).add(shine) : shine;
  return m;
}
