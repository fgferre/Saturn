/**
 * Texture/data loading with graceful degradation: every real map is optional —
 * if a file is missing or fails to decode, the caller falls back to the
 * procedural look. Assets live in /public/textures (see README for sources
 * and the bake script for the ring binaries).
 */

import { SRGBColorSpace, Texture, TextureLoader, RepeatWrapping } from 'three';

const loader = new TextureLoader();

/** Resolves to null instead of rejecting — missing maps are expected. */
export function tryLoadTexture(url: string, colorSpace = SRGBColorSpace): Promise<Texture | null> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = colorSpace;
        tex.anisotropy = 8;
        tex.wrapS = RepeatWrapping; // allows longitude-offset correction
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

async function tryFetchBin(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

export interface BodyMaps {
  saturn: Texture | null;
  /** 2048 × RGBA8 radial ring profile (color + opacity), 66,900..140,500 km. */
  ringProfile: Uint8Array | null;
  /** 2048 × RGB8 (backscattered, forward-scattered, unlit-side brightness). */
  ringScatter: Uint8Array | null;
  starmap: Texture | null;
  moons: Map<string, Texture>;
}

const MOON_MAP_IDS = ['mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'iapetus'] as const;

/** Kick off all loads in parallel; missing files simply resolve to null. */
export async function loadAllMaps(): Promise<BodyMaps> {
  const base = `${import.meta.env.BASE_URL}textures/`;
  const [saturn, ringProfile, ringScatter, starmap, ...moonTex] = await Promise.all([
    tryLoadTexture(`${base}saturn.jpg`),
    tryFetchBin(`${base}rings_profile.bin`),
    tryFetchBin(`${base}rings_scatter.bin`),
    tryLoadTexture(`${base}starmap.jpg`),
    ...MOON_MAP_IDS.map((id) => tryLoadTexture(`${base}${id}.jpg`)),
  ]);

  const moons = new Map<string, Texture>();
  MOON_MAP_IDS.forEach((id, i) => {
    const tex = moonTex[i];
    if (tex) {
      // The Cassini (Schenk) global mosaics run 360°W → 0°W left-to-right,
      // i.e. the sub-Saturn meridian sits at the texture seam. Our sphere
      // puts sub-Saturn at u=0.5 (+X local), so shift by half a turn —
      // this also lands the leading hemisphere (90°W) on local +Z.
      tex.offset.x = 0.5;
      moons.set(id, tex);
    }
  });

  return { saturn, ringProfile, ringScatter, starmap, moons };
}
