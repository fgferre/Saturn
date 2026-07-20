/**
 * Bakes Björn Jónsson's Cassini/Voyager-derived ring data
 * (https://bjj.mmedia.is/data/s_rings/ — 13,177 samples, 5 km resolution,
 * spanning 74,510..140,390 km) into the runtime binary profiles:
 *
 *   public/textures/rings_profile.bin — 2048 × RGBA8 over 66,900..140,500 km
 *       RGB = particle color, A = opacity (1 - transparency)
 *   public/textures/rings_scatter.bin — 2048 × RGB8, same span
 *       R = backscattered brightness, G = forward-scattered, B = unlit side
 *       (each normalized to its own maximum)
 *
 * Usage: node scripts/bake-rings.mjs <dir-with-txt-files>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node bake-rings.mjs <dir with BJJ txt files>');

const STRIP_INNER = 74510;
const STRIP_OUTER = 140390;
const FULL_INNER = 66900;
const FULL_OUTER = 140500;
const OUT_W = 2048;

const lines = (name) => readFileSync(join(SRC, name), 'utf8').trim().split(/\r?\n/);

const color = lines('sat_rings_color.txt').map((l) => l.trim().split(/\s+/).map(Number));
const transparency = lines('transparency.txt').map(Number);
const back = lines('backscattered.txt').map(Number);
const fwd = lines('forwardscattered.txt').map(Number);
const unlit = lines('unlitside.txt').map(Number);

const n = transparency.length;
console.log(`samples: color=${color.length} transp=${n} back=${back.length} fwd=${fwd.length} unlit=${unlit.length}`);

const sampleAt = (arr, km, pick = (v) => v) => {
  const t = (km - STRIP_INNER) / (STRIP_OUTER - STRIP_INNER);
  if (t < 0 || t > 1) return null;
  const x = t * (arr.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = pick(arr[i]);
  const b = pick(arr[Math.min(i + 1, arr.length - 1)]);
  return a + (b - a) * f;
};

const maxOf = (arr) => arr.reduce((m, v) => Math.max(m, v), 0);
const backMax = maxOf(back);
const fwdMax = maxOf(fwd);
const unlitMax = maxOf(unlit);
console.log(`maxima: back=${backMax} fwd=${fwdMax} unlit=${unlitMax}`);

// Tiny deterministic noise for the (procedural) D ring.
const hash = (i) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296);
};

const profile = new Uint8Array(OUT_W * 4);
const scatter = new Uint8Array(OUT_W * 3);

for (let i = 0; i < OUT_W; i++) {
  const km = FULL_INNER + ((i + 0.5) / OUT_W) * (FULL_OUTER - FULL_INNER);
  let r = 0, g = 0, b = 0, a = 0, sB = 0, sF = 0, sU = 0;

  if (km >= STRIP_INNER && km <= STRIP_OUTER) {
    r = sampleAt(color, km, (v) => v[0]);
    g = sampleAt(color, km, (v) => v[1]);
    b = sampleAt(color, km, (v) => v[2]);
    a = 1 - sampleAt(transparency, km);
    sB = sampleAt(back, km) / backMax;
    sF = sampleAt(fwd, km) / fwdMax;
    sU = sampleAt(unlit, km) / unlitMax;
  } else if (km < STRIP_INNER) {
    // D ring: extremely tenuous dusty gray (not covered by the dataset).
    const t = (km - FULL_INNER) / (STRIP_INNER - FULL_INNER);
    const wisp = 0.5 + 0.5 * Math.sin(t * 40 + hash(i) * 2);
    r = 0.55; g = 0.52; b = 0.48;
    a = 0.012 * wisp * Math.min(1, t * 4) + 0.002;
    sB = 0.02; sF = 0.3 * wisp; sU = 0.02;
  }

  profile[i * 4 + 0] = Math.round(Math.min(1, r) * 255);
  profile[i * 4 + 1] = Math.round(Math.min(1, g) * 255);
  profile[i * 4 + 2] = Math.round(Math.min(1, b) * 255);
  profile[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
  scatter[i * 3 + 0] = Math.round(Math.min(1, sB) * 255);
  scatter[i * 3 + 1] = Math.round(Math.min(1, sF) * 255);
  scatter[i * 3 + 2] = Math.round(Math.min(1, sU) * 255);
}

writeFileSync('public/textures/rings_profile.bin', profile);
writeFileSync('public/textures/rings_scatter.bin', scatter);
console.log(`wrote rings_profile.bin (${profile.length} B) and rings_scatter.bin (${scatter.length} B)`);
