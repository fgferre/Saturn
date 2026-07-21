/**
 * Bakes per-preset resolution tiers of the albedo maps so the Low and Med
 * quality presets download far less data (see src/materials/textures.ts,
 * TEXTURE_TIER). Outputs, from the full-res originals in public/textures/:
 *
 *   public/textures/1k/<id>.jpg   (1024 px wide — Low preset)
 *   public/textures/2k/<id>.jpg   (2048 px wide — Med preset)
 *
 * Tiered assets: saturn + the six moon albedos. Deliberately NOT tiered:
 *   - starmap.jpg — stars are point sources; downscaling erases them by
 *     aliasing, so every preset loads the full-res star map.
 *   - relief PNGs (height/normal) — height maps are not tiered; the Low
 *     preset simply skips relief and uses the procedural bump fallback.
 *   - rings_*.bin — data buffers, not images.
 *
 * NO new npm dependency is added for this. The script uses `sharp` only if it
 * already happens to be installed (dynamic import); otherwise it prints the
 * exact one-liners to bake the tiers with a tool you already have — pick one:
 *
 *   ImageMagick:   magick input.jpg -resize 1024x output.jpg
 *   sharp-cli:     npx --yes sharp-cli -i input.jpg -o out/ resize 1024
 *
 * The runtime never depends on these files existing: if a tier directory is
 * absent, textures.ts falls back to the original, so the app looks identical
 * today and only gets lighter once the tiers are baked.
 *
 * Usage: node scripts/bake-texture-tiers.mjs
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEX_DIR = 'public/textures';
// Albedo maps that get tiers (starmap is intentionally excluded — see header).
const IDS = ['saturn', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'iapetus'];
const TIERS = [
  { dir: '1k', width: 1024 },
  { dir: '2k', width: 2048 },
];

// JPEG quality for the derivatives — visually lossless at these sizes while
// keeping the Low tier comfortably under budget.
const JPEG_QUALITY = 82;

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    return null;
  }
}

function printManualInstructions() {
  console.log(
    '`sharp` is not installed (and none is added by design). Bake the tiers ' +
      'with a tool you already have — run ONE of the blocks below.\n',
  );
  console.log('# ImageMagick (`magick` on PATH):');
  for (const { dir, width } of TIERS) {
    console.log(`mkdir -p ${TEX_DIR}/${dir}`);
    for (const id of IDS) {
      console.log(
        `magick ${TEX_DIR}/${id}.jpg -resize ${width}x -quality ${JPEG_QUALITY} ${TEX_DIR}/${dir}/${id}.jpg`,
      );
    }
  }
  console.log('\n# sharp-cli (no install; npx fetches it on demand):');
  for (const { dir, width } of TIERS) {
    console.log(`mkdir -p ${TEX_DIR}/${dir}`);
    for (const id of IDS) {
      console.log(
        `npx --yes sharp-cli -i ${TEX_DIR}/${id}.jpg -o ${TEX_DIR}/${dir}/ ` +
          `resize ${width} -- jpeg --quality ${JPEG_QUALITY}`,
      );
    }
  }
  console.log(
    '\nDo NOT tier starmap.jpg or the relief PNGs (see script header). ' +
      'The app runs fine without these files — this only lightens Low/Med.',
  );
}

async function bakeWithSharp(sharp) {
  for (const { dir, width } of TIERS) {
    const outDir = join(TEX_DIR, dir);
    mkdirSync(outDir, { recursive: true });
    for (const id of IDS) {
      const src = join(TEX_DIR, `${id}.jpg`);
      if (!existsSync(src)) {
        console.warn(`skip ${id}: ${src} not found`);
        continue;
      }
      const out = join(outDir, `${id}.jpg`);
      const info = await sharp(src)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toFile(out);
      console.log(`${out}: ${info.width}x${info.height}, ${(info.size / 1024).toFixed(0)} KB`);
    }
  }
  console.log('\nDone. Low → 1k, Med → 2k; High/Ultra keep the originals.');
}

const sharp = await loadSharp();
if (sharp) {
  await bakeWithSharp(sharp);
} else {
  printManualInstructions();
}
