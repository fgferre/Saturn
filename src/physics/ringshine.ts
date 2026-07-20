/**
 * Ringshine: Saturn's night side is visibly lit by its rings (see Cassini
 * PIA08329, PIA12512). Per frame we integrate the rings as an extended
 * source into a small latitude LUT, which the globe shader samples.
 *
 * Model (deliberately compact, physically motivated):
 * for a surface point at planetographic latitude φ, sum over ring annuli
 * the ring radiance toward the planet × solid-angle weight × geometric
 * visibility (rings below the local horizon contribute nothing; the planet
 * shadows the far-side portion of the rings at night — approximated by the
 * lit-fraction factor).
 *
 * The ring radiance toward the planet reuses the real Björn Jónsson
 * brightness profiles: backscattered brightness for the sunlit face,
 * unlit-side brightness for the dark face.
 */

import { DataTexture, LinearFilter, RGBAFormat, ClampToEdgeWrapping, Vector3 } from 'three';
import { KM_PER_UNIT, RINGS, SATURN } from '../data/saturn.ts';

const LAT_SAMPLES = 64;
const RADIAL_SAMPLES = 24;

const REQ = SATURN.physical.radiusKm / KM_PER_UNIT;
const RPOL = (SATURN.physical.polarRadiusKm ?? SATURN.physical.radiusKm) / KM_PER_UNIT;

export class Ringshine {
  readonly texture: DataTexture;
  private readonly data: Uint8Array;
  /** (radiusU, litBrightness 0..1, alpha 0..1) per annulus, precomputed. */
  private readonly annuli: { r: number; back: number; unlit: number; alpha: number }[] = [];

  constructor(profile: Uint8Array | null, scatter: Uint8Array | null) {
    this.data = new Uint8Array(LAT_SAMPLES * 4);
    this.texture = new DataTexture(this.data, LAT_SAMPLES, 1, RGBAFormat);
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    // Precompute annulus properties from the baked profiles (or a flat guess).
    const innerU = RINGS.innerKm / KM_PER_UNIT;
    const outerU = RINGS.outerKm / KM_PER_UNIT;
    const n = profile ? profile.length / 4 : 0;
    for (let i = 0; i < RADIAL_SAMPLES; i++) {
      const t = (i + 0.5) / RADIAL_SAMPLES;
      const r = innerU + t * (outerU - innerU);
      let alpha = 0.5, back = 0.5, unlit = 0.1;
      if (profile && n > 0) {
        const idx = Math.min(n - 1, Math.floor(t * n));
        alpha = profile[idx * 4 + 3] / 255;
        if (scatter) {
          back = scatter[idx * 3] / 255;
          unlit = scatter[idx * 3 + 2] / 255;
        } else {
          back = alpha;
          unlit = (1 - alpha) * 0.3;
        }
      }
      this.annuli.push({ r, back, unlit, alpha });
    }
  }

  /**
   * Rebuild the latitude LUT for the current sun direction.
   * LUT u-coordinate maps latitude -90°..+90° (south..north).
   * RGB = ringshine irradiance (cream-tinted in shader), A unused.
   */
  update(sunDir: Vector3): void {
    const sunSouth = sunDir.y < 0; // which ring face is sunlit
    for (let li = 0; li < LAT_SAMPLES; li++) {
      const lat = ((li + 0.5) / LAT_SAMPLES - 0.5) * Math.PI; // -π/2..π/2
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);
      // Surface point on the oblate globe at this latitude (azimuth-averaged;
      // ringshine is azimuth-dependent only through the sun's night mask,
      // which the shader handles separately with its own day/night factor).
      const px = REQ * cosLat;
      const py = RPOL * sinLat;
      // Local outward normal of the ellipsoid.
      const nx = cosLat / REQ;
      const ny = sinLat / RPOL;
      const nl = Math.hypot(nx, ny);
      const nX = nx / nl, nY = ny / nl;

      let sum = 0;
      for (const a of this.annuli) {
        // Nearest point of the annulus (same azimuth as the surface point)
        // dominates the solid angle — treat the annulus as a strip there.
        const dx = a.r - px;
        const dy = -py;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-3) continue;
        // Direction from surface point to the strip.
        const dX = dx / dist, dY = dy / dist;
        const cosIncidence = nX * dX + nY * dY;
        if (cosIncidence <= 0) continue; // ring below local horizon
        // The observer sees the ring face on their side of the plane;
        // that face is either the sunlit one (backscatter brightness) or
        // the dark one (unlit-side brightness).
        const north = sinLat >= 0;
        const seesLitFace = north === !sunSouth;
        const faceB = seesLitFace ? a.back : a.unlit;
        // Strip solid-angle weight ~ width × (r/dist) falloff, cos of the
        // strip's emission angle toward the point ≈ |dy|/dist + floor.
        const emit = Math.min(1, Math.abs(py) / dist + 0.15);
        const width = (RINGS.outerKm - RINGS.innerKm) / KM_PER_UNIT / RADIAL_SAMPLES;
        const solid = (width * Math.min(a.r, dist)) / (dist * dist);
        sum += faceB * a.alpha * cosIncidence * emit * solid;
      }

      // Ring opening angle: the rings intercept (and re-emit) sunlight in
      // proportion to the sine of the solar elevation over the ring plane.
      const opening = 0.15 + 0.85 * Math.min(1, Math.abs(sunDir.y) / 0.45);
      // Normalize to a pleasing 0..1 range (scale factor folds the ring
      // albedo and solar irradiance; calibrated against PIA08329).
      const v = Math.min(1, sum * 0.55 * opening);
      const b = Math.round(v * 255);
      this.data[li * 4] = b;
      this.data[li * 4 + 1] = b;
      this.data[li * 4 + 2] = b;
      this.data[li * 4 + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }
}
