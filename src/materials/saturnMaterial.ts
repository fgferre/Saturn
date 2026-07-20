/**
 * Saturn's globe: real global map (or procedural bands) with differential
 * zonal-jet flow animation, the north-polar hexagon, ring shadows projected
 * from the real ring profile, moon shadow transits, and ringshine lighting
 * the night side (LUT computed per frame from the ring brightness data).
 */

import { Texture } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  abs, add, atan2, clamp, cos, float, fract, mix, mul,
  mx_fractal_noise_float, mx_noise_float, oneMinus, positionLocal,
  positionWorld, smoothstep, sqrt, step, texture, uv, vec2, vec3,
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { cloudPhaseUniform, sunDirUniform } from './sharedUniforms.ts';
import { moonTransitLight } from './moonTransits.ts';
import type { RingProfile } from './ringProfile.ts';
import { KM_PER_UNIT } from '../data/saturn.ts';

type NodeObj = ShaderNodeObject<Node>;

/** Procedural banding — the fallback when no real map is available. */
function proceduralBands(bandUv: NodeObj): NodeObj {
  const u = bandUv.x;
  const v = bandUv.y; // 0 at north pole, 1 at south pole (three.js spheres)
  const latAbs = abs(v.sub(0.5)).mul(2); // 0 equator .. 1 poles

  // Slight longitudinal wobble so band edges are not perfect circles.
  const wobble = mx_noise_float(vec3(u.mul(14), v.mul(90), 2.0)).mul(0.004);
  const bandCoord = v.add(wobble);
  const bands = mx_fractal_noise_float(vec3(bandCoord.mul(26), 3.71, 8.13), 4, 2.0, 0.58)
    .mul(0.5).add(0.5);
  const fine = mx_fractal_noise_float(vec3(bandCoord.mul(90), 7.31, 1.77), 3, 2.0, 0.5)
    .mul(0.5).add(0.5);

  const deepTan = vec3(0.72, 0.60, 0.44);
  const cream = vec3(0.95, 0.88, 0.72);
  const gold = vec3(0.90, 0.78, 0.58);

  let color = mix(deepTan, cream, smoothstep(0.15, 0.85, bands));
  color = mix(color, gold, fine.mul(0.25));
  // Brighter, warmer equatorial zone.
  color = mix(color, vec3(0.97, 0.89, 0.70), smoothstep(0.22, 0.0, latAbs).mul(0.35));
  // Dusky olive toward the poles.
  color = mix(color, vec3(0.55, 0.52, 0.42), smoothstep(0.62, 0.98, latAbs).mul(0.45));
  return color as NodeObj;
}

/**
 * Differential zonal flow: Saturn's jets move cloud bands at different
 * speeds by latitude (equatorial jet ~450 m/s eastward). We advect the
 * base map longitude by a per-latitude speed profile driven by
 * cloudPhaseUniform (simulation-time based), plus a curl-noise wiggle
 * blended dual-phase so the distortion never accumulates.
 */
function animatedSurface(map: Texture): NodeObj {
  const baseUv = uv();
  const v = baseUv.y;
  const lat = v.sub(0.5).mul(-3.14159); // planetographic-ish latitude

  // Zonal jet profile (relative longitudinal speed, eastward positive):
  // strong equatorial jet + alternating weaker jets toward the poles.
  const jets = cos(lat.mul(2.0)).pow(8).mul(1.0) // equatorial super-jet
    .add(cos(lat.mul(9.0)).mul(0.12))
    .add(0.05);
  const drift = cloudPhaseUniform.mul(jets);

  // Dual-phase flow wiggle: two offset samples of a curl-ish noise field,
  // triangle-blended so distortion resets before it smears.
  const phase = fract(cloudPhaseUniform.mul(0.13));
  const w0 = abs(phase.mul(2).sub(1)); // 1..0..1 triangle
  const wiggleA = mx_noise_float(vec3(baseUv.x.mul(10), v.mul(24), phase.mul(4)), 1.0).mul(0.004);
  const wiggleB = mx_noise_float(vec3(baseUv.x.mul(10), v.mul(24), phase.mul(4).add(2)), 1.0).mul(0.004);

  const uvA = vec2(baseUv.x.add(drift).add(wiggleA), v);
  const uvB = vec2(baseUv.x.add(drift).add(wiggleB), v);
  // ponytail: same drift for both samples — only the wiggle is dual-phased;
  // the map itself is periodic in x so drift wraps for free.
  const colA = texture(map, uvA).rgb;
  const colB = texture(map, uvB).rgb;
  const mapCol = mix(colA, colB, oneMinus(w0));

  // Grade the Solar System Scope map toward Cassini natural color.
  const lum = mapCol.dot(vec3(0.2126, 0.7152, 0.0722));
  return mix(mapCol, vec3(lum, lum, lum), 0.25).mul(vec3(1.02, 1.0, 0.94)).mul(1.05) as NodeObj;
}

/** North-polar hexagon: six-lobed jet contour ringing the polar collar. */
function polarHexagon(color: NodeObj): NodeObj {
  const p = positionLocal.normalize(); // geometry radius is 60.268 units
  const lat = p.y; // sin(latitude) after normalize
  const lon = atan2(p.z, p.x);
  // Hexagonal radius modulation of the collar boundary (~78°N: sinLat≈0.978).
  const hexEdge = float(0.9724).add(cos(lon.mul(6).add(cloudPhaseUniform.mul(0.35))).mul(0.0035));
  const inHex = smoothstep(hexEdge.sub(0.0015), hexEdge.add(0.0015), lat);
  // Inside the hexagon: darker blue-gray polar vortex with a bright rim.
  const rim = smoothstep(hexEdge.sub(0.004), hexEdge, lat)
    .mul(oneMinus(smoothstep(hexEdge, hexEdge.add(0.004), lat)));
  let c: NodeObj = mix(color, vec3(0.38, 0.44, 0.47).mul(color.dot(vec3(1.2, 1.2, 1.2))), inHex.mul(0.75));
  c = add(c, rim.mul(0.10));
  return c;
}

export interface SaturnMaterialResult {
  material: MeshStandardNodeMaterial;
}

export function createSaturnMaterial(
  profile: RingProfile,
  map?: Texture | null,
  ringshineTex?: Texture | null,
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 1.0, metalness: 0.0 });

  // Animated real map when available, procedural bands otherwise.
  let color: NodeObj = map ? animatedSurface(map) : proceduralBands(uv());
  color = polarHexagon(color);

  // --- Ring shadow on the globe ---
  const P = positionWorld;
  const S = sunDirUniform;
  const innerU = profile.innerKm / KM_PER_UNIT;
  const outerU = profile.outerKm / KM_PER_UNIT;
  // Intersection of the ray P -> Sun with the ring plane (y = 0).
  const denom = add(S.y, mul(step(abs(S.y), float(1e-5)), 1e-5)); // avoid /0
  const t = P.y.negate().div(denom);
  const hx = add(P.x, mul(S.x, t));
  const hz = add(P.z, mul(S.z, t));
  const r = sqrt(add(mul(hx, hx), mul(hz, hz)));
  const ru = r.sub(innerU).div(outerU - innerU);
  const inside = mul(step(0.0, ru), oneMinus(step(1.0, ru)));
  const toward = step(0.0, t);
  const ringAlpha = texture(profile.texture, vec2(clamp(ru, 0, 1), 0.5)).a;
  // Slightly lifted (0.86): the real shadow reads soft, never pitch black.
  const transmission = oneMinus(ringAlpha.mul(0.86));
  const shadow = mix(1.0, transmission, mul(inside, toward));

  // Moon shadow transits crossing the globe (Titan's shadow, etc.).
  const transits = moonTransitLight(P);

  // ponytail: shadow multiplies albedo instead of the light term — with one
  // sun and near-zero ambient the visual result is equivalent.
  material.colorNode = color.mul(shadow).mul(transits);

  // --- Ringshine: the rings light the night side (LUT by latitude) ---
  if (ringshineTex) {
    const latU = oneMinus(uv().y); // LUT: u=0 south pole .. u=1 north pole
    const shine = texture(ringshineTex, vec2(latU, 0.5)).r;
    // Strongest where the sun doesn't reach; fades out on the day side.
    const night = oneMinus(clamp(positionWorld.normalize().dot(S).mul(2.5).add(0.5), 0, 1));
    material.emissiveNode = color.mul(shine).mul(night).mul(vec3(1.0, 0.94, 0.80)).mul(0.6);
  }

  return material;
}
