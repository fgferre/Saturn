/**
 * Saturn's globe: procedural banded atmosphere (TSL noise, compiled to WGSL
 * or GLSL automatically) plus the rings' shadow projected onto the planet by
 * sampling the same radial ring profile used to render the rings.
 */

import { Texture } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  abs, add, clamp, float, mix, mul, mx_fractal_noise_float, mx_noise_float,
  oneMinus, positionWorld, smoothstep, sqrt, step, texture, uv, vec2, vec3,
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { sunDirUniform } from './sharedUniforms.ts';
import { moonTransitLight } from './moonTransits.ts';
import type { RingProfile } from './ringProfile.ts';
import { KM_PER_UNIT } from '../data/saturn.ts';

/** Procedural banding — the fallback when no real map is available. */
function proceduralBands(): ShaderNodeObject<Node> {
  const u = uv().x;
  const v = uv().y; // 0 at north pole, 1 at south pole (three.js spheres)
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
  // North polar region: subtle blue-green cast (Cassini's northern hues).
  const north = oneMinus(v);
  color = mix(color, vec3(0.42, 0.52, 0.55), smoothstep(0.955, 0.995, north).mul(0.55));
  return color;
}

export function createSaturnMaterial(profile: RingProfile, map?: Texture | null): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 1.0, metalness: 0.0 });

  // Real global map when available, procedural bands otherwise.
  // (No explicit uvNode — that would bypass the texture matrix; see moonMaterials.)
  // The Solar System Scope map runs a bit more saturated/contrasty than
  // Cassini natural color — grade it toward the PIA21345 look.
  let color;
  if (map) {
    const mapCol = texture(map).rgb;
    const lum = mapCol.dot(vec3(0.2126, 0.7152, 0.0722));
    color = mix(mapCol, vec3(lum, lum, lum), 0.25).mul(vec3(1.02, 1.0, 0.94)).mul(1.05);
  } else {
    color = proceduralBands();
  }

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
  return material;
}
