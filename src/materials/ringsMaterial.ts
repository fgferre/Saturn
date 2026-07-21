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
  abs, add, atan, cameraPosition, clamp, cos, dot, float, fwidth,
  max, mix, mul, mx_fractal_noise_float, normalize, oneMinus, positionWorld,
  pow, sin, smoothstep, texture, uv, vec2, vec3,
} from 'three/tsl';
import { spokePhaseUniform, sunDirUniform } from './sharedUniforms.ts';
import { moonTransitLight } from './moonTransits.ts';
import { planetShadow } from './planetShadow.ts';
import type { RingProfile } from './ringProfile.ts';

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

  // --- Planet shadow (Saturn's oblate umbra + penumbra, shared with the F/E
  // rings) combined with in-shader moon transits. ---
  const shadow = planetShadow(P).mul(moonTransitLight(P));

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
  const rawAng = atan(P.z, P.x);
  const ang = rawAng.add(spokePhaseUniform);
  const rr = uv().x;
  const bMask = smoothstep(0.34, 0.42, rr).mul(smoothstep(0.70, 0.60, rr));
  const spokeNoise = mx_fractal_noise_float(
    vec3(cos(ang).mul(2.5), sin(ang).mul(2.5), rr.mul(9)), 3, 2.0, 0.5,
  ).mul(0.5).add(0.5);
  // Spokes are a near-equinox phenomenon: they fade as the Sun climbs above
  // the ring plane (unobservable by solar elevation ≳ 15–17°). sin 17° ≈ 0.29
  // (⚠ VERIFICAR: fotos Cassini 2009–2010). In 2026 (1yr post-equinox) the
  // elevation is only ~6–7° → season ≈ 1, strong spokes as the comment notes.
  const season = oneMinus(smoothstep(0.17, 0.29, abs(S.y)));
  const spoke = smoothstep(0.62, 0.85, spokeNoise).mul(bMask).mul(0.13).mul(season);
  face = face.mul(oneMinus(spoke.mul(sameSide)));
  fwd = add(fwd, spoke.mul(0.5).mul(alpha));

  // --- Self-gravity wakes: elongated clumps pitched ~22° from the orbital
  // tangent make ring brightness depend on viewing azimuth (the real
  // quadrant asymmetry seen in A-ring photos). Strongest in the A ring.
  const PITCH = 22 * Math.PI / 180;
  const wakeAng = rawAng.add(Math.PI / 2 + PITCH); // wake long-axis azimuth
  const wakeDir = vec3(cos(wakeAng), 0.0, sin(wakeAng));
  const vH = normalize(vec3(V.x, 0.0, V.z));
  const alongWake = dot(vH, wakeDir);
  // Quadrupole modulation: dimmer looking along the wakes, brighter across.
  const wakeMaskA = smoothstep(0.74, 0.78, rr).mul(smoothstep(0.96, 0.90, rr));
  const wakeMaskB = smoothstep(0.34, 0.40, rr).mul(smoothstep(0.70, 0.62, rr)).mul(0.35);
  const wakeAmp = wakeMaskA.add(wakeMaskB).mul(0.15);
  const wakes = oneMinus(alongWake.mul(alongWake).mul(2).sub(1).mul(wakeAmp));
  face = face.mul(wakes);

  // --- Azimuthal granularity: fine clumpiness along the rings, faded out
  // before it can alias at distance (fwidth-based).
  const grainCoord = vec3(cos(rawAng).mul(60), sin(rawAng).mul(60), rr.mul(30));
  const grain = mx_fractal_noise_float(grainCoord, 2, 2.0, 0.5).mul(0.5).add(0.5);
  const grainFade = clamp(oneMinus(fwidth(rawAng).mul(30)), 0.0, 1.0);
  face = face.mul(grain.sub(0.5).mul(0.09).mul(grainFade).add(1.0));

  // Saturnshine (planet-reflected fill on shadowed ring faces) — not ambient.
  // Slightly raised after F7.3 removed the global AmbientLight.
  const color = face.mul(add(1.0, surge)).add(scatterColor.mul(fwd)).mul(shadow)
    .add(albedo.mul(0.016));

  material.colorNode = color;
  // Slant path: grazing views traverse more ring material — optical depth
  // scales with 1/|cos| of the view angle to the plane.
  const slant = clamp(float(1.0).div(max(abs(V.y), 0.15)), 1.0, 6.0);
  const tau = oneMinus(alpha).max(1e-4).log().negate(); // alpha -> optical depth
  const slantAlpha = oneMinus(tau.mul(slant).negate().exp());
  material.opacityNode = clamp(slantAlpha.mul(0.98).add(fwd.mul(0.35)), 0, 1);
  return material;
}
