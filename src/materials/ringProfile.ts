/**
 * Generates a 1D radial profile of Saturn's rings as a DataTexture:
 * RGB = particle albedo color, A = normal optical depth mapped to opacity.
 * Region boundaries follow Cassini/PDS radii; fine striations are procedural
 * noise tuned to resemble the real radial structure.
 */

import {
  ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter,
  RGBAFormat, SRGBColorSpace,
} from 'three';
import { RINGS } from '../data/saturn.ts';
import { fbm1D, valueNoise1D } from '../utils/noise.ts';

export const RING_TEX_SIZE = 2048;

function inRegion(km: number, [a, b]: [number, number]): number {
  return km >= a && km <= b ? 1 : 0;
}

/** Smooth 0..1 ramp inside a region with soft edges (km units). */
function softRegion(km: number, [a, b]: [number, number], edge: number): number {
  const lo = (km - a) / edge;
  const hi = (b - km) / edge;
  return Math.max(0, Math.min(1, lo, hi));
}

/** Normal optical depth τ at radius km. */
function opticalDepth(km: number): number {
  const R = RINGS.regions;
  const x = km / 1000; // striation coordinate
  let tau = 0;

  // D ring — extremely faint.
  if (inRegion(km, R.d)) tau = 0.004 + 0.006 * fbm1D(x * 3, 3, 11);

  // C ring — translucent, with plateaus and ringlets.
  if (inRegion(km, R.c)) {
    tau = 0.06 + 0.09 * fbm1D(x * 1.6, 4, 21);
    // Plateaus in the outer C ring.
    tau += 0.12 * Math.pow(valueNoise1D(x * 0.9, 31), 6);
    if (inRegion(km, R.maxwellGap)) tau *= 0.06;
    // Maxwell ringlet inside its gap.
    if (Math.abs(km - 87491) < 45) tau = 0.9;
  }

  // B ring — dense and bright, strongest structure.
  if (inRegion(km, R.b)) {
    const t = (km - R.b[0]) / (R.b[1] - R.b[0]);
    const base = 1.1 + 1.6 * Math.sin(t * Math.PI) ** 0.6;
    const stria = 0.55 * fbm1D(x * 4.2, 5, 41) + 0.35 * fbm1D(x * 14, 3, 43);
    tau = base * (0.75 + stria);
  }

  // Cassini Division — faint but not empty.
  if (inRegion(km, R.cassini)) {
    tau = 0.04 + 0.08 * fbm1D(x * 2.4, 4, 51);
    if (Math.abs(km - 118265) < 90) tau += 0.25; // inner ringlet
  }

  // A ring — moderate, smoother than B.
  if (inRegion(km, R.a)) {
    const t = (km - R.a[0]) / (R.a[1] - R.a[0]);
    tau = 0.55 + 0.18 * fbm1D(x * 5, 4, 61) - 0.12 * t;
    if (inRegion(km, R.enckeGap)) tau *= 0.04;
    if (inRegion(km, R.keelerGap)) tau *= 0.05;
  }

  // F ring — narrow, clumpy strand just outside A.
  {
    const [fa, fb] = R.f;
    const c = (fa + fb) / 2;
    const w = (fb - fa) / 2;
    const d = Math.abs(km - c) / w;
    if (d < 3) tau += 0.35 * Math.exp(-d * d * 2.2) * (0.5 + 0.5 * fbm1D(x * 30, 3, 71));
  }

  return tau;
}

/** Particle albedo color at radius km (linear-ish sRGB values). */
function ringColor(km: number, tau: number): [number, number, number] {
  const R = RINGS.regions;
  const x = km / 1000;
  // Icy warm cream for dense regions, darker neutral for tenuous ones.
  const dust: [number, number, number] = [0.42, 0.39, 0.35];
  const ice: [number, number, number] = [0.93, 0.87, 0.76];
  const mixT = Math.min(1, tau / 0.5);
  let r = dust[0] + (ice[0] - dust[0]) * mixT;
  let g = dust[1] + (ice[1] - dust[1]) * mixT;
  let b = dust[2] + (ice[2] - dust[2]) * mixT;
  // Slight reddening in the inner B and C rings (tholin contamination).
  if (km < 104000) {
    r *= 1.04;
    b *= 0.93;
  }
  // Per-annulus subtle hue variation.
  const v = 0.92 + 0.16 * fbm1D(x * 2.2, 3, 81);
  r *= v; g *= v; b *= v;
  // Cassini division slightly grayer.
  if (inRegion(km, R.cassini)) { r *= 0.9; g *= 0.92; }
  return [Math.min(1, r), Math.min(1, g), Math.min(1, b)];
}

export interface RingProfile {
  texture: DataTexture;
  innerKm: number;
  outerKm: number;
  /** Opacity (0..1) lookup by radius, for CPU-side uses. */
  opacityAt(km: number): number;
}

/**
 * Build the radial profile texture. With `real` present (the baked binary
 * from scripts/bake-rings.mjs — Björn Jónsson's Cassini/Voyager dataset),
 * it is used directly; otherwise the whole profile is procedural.
 */
export function createRingProfile(real?: Uint8Array | null): RingProfile {
  const size = RING_TEX_SIZE;
  const { innerKm, outerKm } = RINGS;
  const opacities = new Float32Array(size);
  let data: Uint8Array;

  if (real && real.length === size * 4) {
    data = real;
    for (let i = 0; i < size; i++) opacities[i] = real[i * 4 + 3] / 255;
  } else {
    data = new Uint8Array(size * 4);
    for (let i = 0; i < size; i++) {
      const km = innerKm + ((i + 0.5) / size) * (outerKm - innerKm);
      const tau = opticalDepth(km);
      // Fade the extreme edges so the annulus never ends abruptly.
      const edge = softRegion(km, [innerKm, outerKm], 700);
      const alpha = (1 - Math.exp(-tau * 1.8)) * edge;
      const [r, g, b] = ringColor(km, tau);
      data[i * 4 + 0] = Math.round(Math.min(1, r) * 255);
      data[i * 4 + 1] = Math.round(Math.min(1, g) * 255);
      data[i * 4 + 2] = Math.round(Math.min(1, b) * 255);
      data[i * 4 + 3] = Math.round(Math.min(1, alpha) * 255);
      opacities[i] = Math.min(1, alpha);
    }
  }

  const texture = new DataTexture(data, size, 1, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  // Mipmaps + anisotropy keep the fine radial structure from shimmering
  // into grain at distance / grazing angles.
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 8;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return {
    texture,
    innerKm,
    outerKm,
    opacityAt(km: number) {
      const t = (km - innerKm) / (outerKm - innerKm);
      if (t <= 0 || t >= 1) return 0;
      return opacities[Math.floor(t * (size - 1))];
    },
  };
}
