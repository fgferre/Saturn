/**
 * Saturn's rings: unlit node material with custom light transport —
 * lit/unlit face distinction, transmission through thin regions, forward
 * scattering when backlit, opposition surge, and the planet's shadow
 * (analytic oblate-ellipsoid occlusion).
 *
 * When the baked Björn Jónsson dataset is available, the lit-face, unlit-face
 * and forward-scattered brightness come from real measured radial profiles
 * (Voyager PPS + Cassini) instead of heuristics.
 */

import {
  ClampToEdgeWrapping, DataTexture, DoubleSide, LinearFilter, RGBAFormat,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs, add, atan2, cameraPosition, clamp, cos, dot, float, length, max, mix,
  mul, mx_fractal_noise_float, normalize, oneMinus, positionWorld, pow, sin,
  smoothstep, texture, uv, vec2, vec3,
} from 'three/tsl';
import { spokePhaseUniform, sunDirUniform } from './sharedUniforms.ts';
import { moonTransitLight } from './moonTransits.ts';
import { SUN_ANGULAR_RADIUS } from '../physics/eclipse.ts';
import type { RingProfile } from './ringProfile.ts';
import { KM_PER_UNIT, SATURN } from '../data/saturn.ts';

function scatterTexture(scatter: Uint8Array): DataTexture {
  // RGB8 -> RGBA8 (WebGPU-friendly), linear data (brightness profiles).
  const n = scatter.length / 3;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    rgba[i * 4 + 0] = scatter[i * 3 + 0];
    rgba[i * 4 + 1] = scatter[i * 3 + 1];
    rgba[i * 4 + 2] = scatter[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(rgba, n, 1, RGBAFormat);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function createRingsMaterial(profile: RingProfile, scatter?: Uint8Array | null): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });

  const sample = texture(profile.texture, vec2(uv().x, 0.5));
  // Calibrated against PIA21345 (Cassini natural color): the rings are a
  // muted warm khaki, distinctly darker than Saturn's creamy disk.
  const albedo = sample.rgb.mul(vec3(0.80, 0.75, 0.62));
  const alpha = sample.a;

  const P = positionWorld;
  const V = normalize(cameraPosition.sub(P));
  const S = sunDirUniform;

  // --- Planet shadow: does the ray P -> Sun hit Saturn's oblate ellipsoid? ---
  const requ = SATURN.physical.radiusKm / KM_PER_UNIT;
  const yScale = SATURN.physical.radiusKm / (SATURN.physical.polarRadiusKm ?? SATURN.physical.radiusKm);
  const q = vec3(P.x, P.y.mul(yScale), P.z);
  const sScaled = normalize(vec3(S.x, S.y.mul(yScale), S.z));
  const tStar = dot(q, sScaled).negate();
  const dMin = length(add(q, sScaled.mul(max(tStar, 0))));
  // Physical penumbra: half-width grows with distance behind the planet at
  // the Sun's angular radius (sharp near the globe, soft at the ring edge).
  const pen = max(tStar, 0).mul(SUN_ANGULAR_RADIUS).add(0.01);
  const planetShadow = clamp(dMin.sub(requ).div(pen).add(0.5), 0, 1);
  const shadow = planetShadow.mul(planetShadow.mul(-2).add(3)).mul(planetShadow)
    .mul(moonTransitLight(P));

  // --- Face illumination + scattering ---
  const sunElev = abs(S.y);
  const ill = sunElev.mul(0.9).add(0.10);
  const sameSide = smoothstep(float(-0.03), float(0.03), mul(S.y, V.y));
  const cosPhase = dot(V, S);
  const surge = pow(clamp(cosPhase, 0, 1), 30).mul(0.30).mul(sameSide);
  const scatterColor = vec3(1.0, 0.96, 0.9);

  let face, fwd;
  if (scatter) {
    // Real measured radial brightness profiles.
    const s = texture(scatterTexture(scatter), vec2(uv().x, 0.5));
    const lit = albedo.mul(s.r).mul(ill).mul(1.05);
    const unlitSide = albedo.mul(s.b).mul(ill).mul(0.8);
    face = mix(unlitSide, lit, sameSide);
    fwd = pow(clamp(cosPhase.negate(), 0, 1), 5).mul(s.g).mul(1.2);
  } else {
    const lit = albedo.mul(ill);
    const transmitted = albedo.mul(pow(oneMinus(alpha), 1.6)).mul(ill).mul(0.85).add(albedo.mul(0.018));
    face = mix(transmitted, lit, sameSide);
    fwd = pow(clamp(cosPhase.negate(), 0, 1), 8).mul(oneMinus(alpha).pow(2)).mul(alpha).mul(3.0);
  }

  // --- B-ring spokes: ghostly radial streaks of levitated dust that corotate
  // with the magnetosphere. Dark in backscattered light, bright when backlit.
  // Seasonal in reality (near-equinox phenomenon — which the mid-2020s are).
  const ang = atan2(P.z, P.x).add(spokePhaseUniform);
  const rr = uv().x;
  const bMask = smoothstep(0.34, 0.42, rr).mul(smoothstep(0.70, 0.60, rr));
  const spokeNoise = mx_fractal_noise_float(
    vec3(cos(ang).mul(2.5), sin(ang).mul(2.5), rr.mul(9)), 3, 2.0, 0.5,
  ).mul(0.5).add(0.5);
  const spoke = smoothstep(0.62, 0.85, spokeNoise).mul(bMask).mul(0.13);
  face = face.mul(oneMinus(spoke.mul(sameSide)));
  fwd = add(fwd, spoke.mul(0.5).mul(alpha));

  const color = face.mul(add(1.0, surge)).add(scatterColor.mul(fwd)).mul(shadow)
    .add(albedo.mul(0.012)); // faint Saturn-shine so shadowed rings never go pitch black

  material.colorNode = color;
  material.opacityNode = clamp(alpha.mul(0.98).add(fwd.mul(0.35)), 0, 1);
  return material;
}
