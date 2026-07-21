/**
 * Texture/data loading with graceful degradation: every real map is optional —
 * if a file is missing or fails to decode, the caller falls back to the
 * procedural look. Assets live in /public/textures (see README for sources
 * and the bake script for the ring binaries).
 */

import { NoColorSpace, SRGBColorSpace, Texture, TextureLoader, RepeatWrapping } from 'three';

type ColorSpaceName = typeof SRGBColorSpace | typeof NoColorSpace;

const loader = new TextureLoader();

/** Resolves to null instead of rejecting — missing maps are expected. */
export function tryLoadTexture(
  url: string,
  colorSpace: ColorSpaceName = SRGBColorSpace,
): Promise<Texture | null> {
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

export interface MoonRelief {
  height: Texture;
  normal: Texture;
  /** Displacement span / bias as fractions of the moon radius. */
  scale: number;
  bias: number;
}

export interface BodyMaps {
  saturn: Texture | null;
  /** 2048 × RGBA8 radial ring profile (color + opacity), 66,900..140,500 km. */
  ringProfile: Uint8Array | null;
  /** 2048 × RGB8 (backscattered, forward-scattered, unlit-side brightness). */
  ringScatter: Uint8Array | null;
  starmap: Texture | null;
  moons: Map<string, Texture>;
  relief: Map<string, MoonRelief>;
}

const MOON_MAP_IDS = ['mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'iapetus'] as const;

/**
 * Kick off all loads in parallel; missing files simply resolve to null.
 * `onProgress(done, total)` fires as each asset settles (for the boot screen).
 */
export async function loadAllMaps(
  onProgress?: (done: number, total: number) => void,
): Promise<BodyMaps> {
  const base = `${import.meta.env.BASE_URL}textures/`;
  const reliefBase = `${base}relief/`;

  // 5 singletons (saturn, 2 ring bins, starmap, relief.json) + 3 sets of moon maps.
  const total = 5 + MOON_MAP_IDS.length * 3;
  let done = 0;
  const track = <T>(p: Promise<T>): Promise<T> => {
    // Side-channel tick — these promises never reject, but count either way.
    p.then(() => onProgress?.(++done, total), () => onProgress?.(++done, total));
    return p;
  };

  const reliefMetaP: Promise<Record<string, { scale: number; bias: number }> | null> =
    fetch(`${reliefBase}relief.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  const [saturn, ringProfile, ringScatter, starmap, reliefMeta, ...moonTex] = await Promise.all([
    track(tryLoadTexture(`${base}saturn.jpg`)),
    track(tryFetchBin(`${base}rings_profile.bin`)),
    track(tryFetchBin(`${base}rings_scatter.bin`)),
    track(tryLoadTexture(`${base}starmap.jpg`)),
    track(reliefMetaP),
    ...MOON_MAP_IDS.map((id) => track(tryLoadTexture(`${base}${id}.jpg`))),
    ...MOON_MAP_IDS.map((id) => track(tryLoadTexture(`${reliefBase}${id}_height.png`, NoColorSpace))),
    ...MOON_MAP_IDS.map((id) => track(tryLoadTexture(`${reliefBase}${id}_normal.png`, NoColorSpace))),
  ]);

  const nMoons = MOON_MAP_IDS.length;
  const moons = new Map<string, Texture>();
  const relief = new Map<string, MoonRelief>();
  MOON_MAP_IDS.forEach((id, i) => {
    const tex = moonTex[i] as Texture | null;
    if (tex) {
      // The Cassini (Schenk) global mosaics run 360°W → 0°W left-to-right,
      // i.e. the sub-Saturn meridian sits at the texture seam. Our sphere
      // puts sub-Saturn at u=0.5 (+X local), so shift by half a turn —
      // this also lands the leading hemisphere (90°W) on local +Z.
      tex.offset.x = 0.5;
      moons.set(id, tex);
    }
    const height = moonTex[nMoons + i] as Texture | null;
    const normal = moonTex[nMoons * 2 + i] as Texture | null;
    const meta = reliefMeta?.[id];
    if (height && normal && meta) {
      // Relief maps share the mosaics' longitude layout — same half-turn shift.
      height.offset.x = 0.5;
      normal.offset.x = 0.5;
      relief.set(id, { height, normal, scale: meta.scale, bias: meta.bias });
    }
  });

  return { saturn, ringProfile, ringScatter, starmap, moons, relief };
}
