/**
 * Texture/data loading with graceful degradation: every real map is optional —
 * if a file is missing or fails to decode, the caller falls back to the
 * procedural look. Assets live in /public/textures (see README for sources
 * and the bake script for the ring binaries).
 */

import { NoColorSpace, SRGBColorSpace, Texture, TextureLoader, RepeatWrapping } from 'three';
import { quality, type QualityName } from '../core/quality';

type ColorSpaceName = typeof SRGBColorSpace | typeof NoColorSpace;

const loader = new TextureLoader();

/**
 * Per-preset albedo resolution tier: Low → 1k, Med → 2k, High/Ultra → the
 * full-resolution originals at the root of textures/. The empty string means
 * "no tier dir — load the original directly". Baked by
 * scripts/bake-texture-tiers.mjs; the directories may not exist yet, so
 * `loadTiered` always falls back to the original before going procedural.
 *
 * starmap.jpg is deliberately absent from tiering — stars are point sources
 * that downscaling erases through aliasing, so it always loads at full res.
 */
const TEXTURE_TIER: Record<QualityName, string> = {
  low: '1k',
  med: '2k',
  high: '',
  ultra: '',
};

/**
 * Load an sRGB albedo map honouring the active resolution tier, with a
 * mandatory safe fallback chain: `textures/{tier}/{id}.jpg` → the original
 * `textures/{id}.jpg` → null (procedural look in the caller). The app never
 * breaks if the tier directories haven't been baked yet.
 */
function loadTiered(base: string, tier: string, id: string): Promise<Texture | null> {
  if (!tier) return tryLoadTexture(`${base}${id}.jpg`);
  return tryLoadTexture(`${base}${tier}/${id}.jpg`).then(
    (tex) => tex ?? tryLoadTexture(`${base}${id}.jpg`),
  );
}

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
  const tier = TEXTURE_TIER[quality.name];

  // Low skips relief (DTM) entirely: the height/normal PNGs total ~10 MB and
  // the 96×48 Low tessellation can't resolve them, so the procedural bump
  // fallback (already built into the materials) is the better trade. Med and
  // up load relief at its single native resolution.
  const loadRelief = quality.name !== 'low';
  const nMoons = MOON_MAP_IDS.length;

  // Tracked loads: saturn + 2 ring bins + starmap + moon albedos, plus
  // relief.json + per-moon height + normal only when relief is loaded.
  const total = 4 + nMoons + (loadRelief ? 1 + nMoons * 2 : 0);
  let done = 0;
  const track = <T>(p: Promise<T>): Promise<T> => {
    // Side-channel tick — these promises never reject, but count either way.
    p.then(() => onProgress?.(++done, total), () => onProgress?.(++done, total));
    return p;
  };

  const reliefMetaP: Promise<Record<string, { scale: number; bias: number }> | null> = loadRelief
    ? track(fetch(`${reliefBase}relief.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null))
    : Promise.resolve(null);

  // Kick every load off synchronously so they run concurrently, then await.
  const singletonsP = Promise.all([
    track(loadTiered(base, tier, 'saturn')),
    track(tryFetchBin(`${base}rings_profile.bin`)),
    track(tryFetchBin(`${base}rings_scatter.bin`)),
    track(tryLoadTexture(`${base}starmap.jpg`)), // exempt from tiers (see TEXTURE_TIER)
  ] as const);
  const albedoP = Promise.all(MOON_MAP_IDS.map((id) => track(loadTiered(base, tier, id))));
  const heightP: Promise<(Texture | null)[]> = loadRelief
    ? Promise.all(MOON_MAP_IDS.map((id) => track(tryLoadTexture(`${reliefBase}${id}_height.png`, NoColorSpace))))
    : Promise.resolve([]);
  const normalP: Promise<(Texture | null)[]> = loadRelief
    ? Promise.all(MOON_MAP_IDS.map((id) => track(tryLoadTexture(`${reliefBase}${id}_normal.png`, NoColorSpace))))
    : Promise.resolve([]);

  const [saturn, ringProfile, ringScatter, starmap] = await singletonsP;
  const albedo = await albedoP;
  const reliefMeta = await reliefMetaP;
  const heights = await heightP;
  const normals = await normalP;

  const moons = new Map<string, Texture>();
  const relief = new Map<string, MoonRelief>();
  MOON_MAP_IDS.forEach((id, i) => {
    const tex = albedo[i];
    if (tex) {
      // The Cassini (Schenk) global mosaics run 360°W → 0°W left-to-right,
      // i.e. the sub-Saturn meridian sits at the texture seam. Our sphere
      // puts sub-Saturn at u=0.5 (+X local), so shift by half a turn —
      // this also lands the leading hemisphere (90°W) on local +Z.
      tex.offset.x = 0.5;
      moons.set(id, tex);
    }
    const height = heights[i] ?? null;
    const normal = normals[i] ?? null;
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
