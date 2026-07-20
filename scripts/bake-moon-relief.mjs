/**
 * Bakes real moon topography into runtime height + normal maps.
 *
 * Real sources (public domain, NASA PDS/USGS):
 *   Mimas     — Gaskell SPC shape model V2.0 (ICQ quad, ASCII)
 *   Enceladus — Schenk & McKinnon 2024 global DEM (GeoTIFF float32, km)
 *   Tethys    — Gaskell SPC shape model V1.0 (ver ASCII: index x y z)
 *   Dione     — Weirich et al. 2025 SPC DTM (GeoTIFF float32)
 * Synthetic (no public DTM exists as of 2026 — documented in README):
 *   Rhea, Iapetus — procedural crater fields; Iapetus gets its real
 *   equatorial ridge (up to ~13 km) as a modeled feature.
 *
 * Outputs per moon into public/textures/relief/:
 *   <moon>_height.png (8-bit gray, 0..1 normalized height)
 *   <moon>_normal.png (8-bit RGB tangent-space normal, physically scaled)
 * plus relief.json with { scale, bias } in units of the moon radius.
 *
 * Longitude layout matches the Schenk color mosaics (east longitude 0..360
 * left->right), which pair with the runtime texture offset of 0.5.
 *
 * Usage: node scripts/bake-moon-relief.mjs <dtm-dir>
 */

import { readFileSync, writeFileSync, mkdirSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node bake-moon-relief.mjs <dir with DTM files>');
mkdirSync('public/textures/relief', { recursive: true });

// ---------------------------------------------------------------- PNG writer
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Write an 8-bit PNG; channels = 1 (gray) or 3 (rgb). data = Uint8Array. */
function writePng(path, width, height, channels, data) {
  const colorType = channels === 1 ? 0 : 2;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType; // bit depth, color type
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

// ------------------------------------------------------- minimal TIFF reader
/** Reads a single-band little-endian float32 TIFF into { width, height, data }. */
function readFloatTiff(path) {
  const buf = readFileSync(path);
  if (buf.readUInt16LE(0) !== 0x4949) throw new Error('not little-endian TIFF');
  let ifd = buf.readUInt32LE(4);
  const tags = {};
  const n = buf.readUInt16LE(ifd);
  for (let i = 0; i < n; i++) {
    const off = ifd + 2 + i * 12;
    const tag = buf.readUInt16LE(off);
    const type = buf.readUInt16LE(off + 2);
    const count = buf.readUInt32LE(off + 4);
    const sizes = { 1: 1, 3: 2, 4: 4, 11: 4, 12: 8 };
    const size = (sizes[type] ?? 4) * count;
    const valOff = size <= 4 ? off + 8 : buf.readUInt32LE(off + 8);
    const read = (idx) => (type === 3 ? buf.readUInt16LE(valOff + idx * 2) : buf.readUInt32LE(valOff + idx * 4));
    tags[tag] = { count, read };
  }
  // Guard the assumptions this minimal reader makes: uncompressed single
  // strip-organized float32 samples (both our sources comply).
  if (tags[259] && tags[259].read(0) !== 1) throw new Error('compressed TIFF unsupported');
  if (tags[258] && tags[258].read(0) !== 32) throw new Error('expected 32-bit samples');
  if (tags[339] && tags[339].read(0) !== 3) throw new Error('expected float samples');

  const width = tags[256].read(0);
  const height = tags[257].read(0);
  const rowsPerStrip = tags[278] ? tags[278].read(0) : height;
  const nStrips = tags[273].count;
  const data = new Float32Array(width * height);
  let dst = 0;
  for (let s = 0; s < nStrips; s++) {
    const so = tags[273].read(s);
    const bc = tags[279].read(s);
    for (let b = 0; b < bc; b += 4) data[dst++] = buf.readFloatLE(so + b);
  }
  void rowsPerStrip;
  return { width, height, data };
}

// ----------------------------------------------------- ICQ shape-model reader
/** Streams an ICQ/ver .tab into an equirect height grid (km, relative to mean r). */
async function readShapeModel(path, hasIndexColumn, W, H) {
  const sum = new Float64Array(W * H);
  const cnt = new Uint32Array(W * H);
  let vertexBudget = Infinity; // "ver" files append a facet-index table — stop before it
  let first = true;
  let meanR = 0, nR = 0;

  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (first) {
      first = false;
      if (hasIndexColumn) vertexBudget = Number(line.trim().split(/\s+/)[0]);
      continue;
    }
    if (vertexBudget-- <= 0) break;
    const parts = line.trim().split(/\s+/).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) continue;
    const [x, y, z] = hasIndexColumn ? parts.slice(1, 4) : parts.slice(0, 3);
    if (x === undefined || z === undefined) continue;
    const r = Math.hypot(x, y, z);
    if (r < 1) continue;
    const lat = Math.asin(z / r);
    let lonE = Math.atan2(y, x);
    if (lonE < 0) lonE += Math.PI * 2;
    const px = Math.min(W - 1, Math.floor((lonE / (Math.PI * 2)) * W));
    const py = Math.min(H - 1, Math.floor(((Math.PI / 2 - lat) / Math.PI) * H));
    sum[py * W + px] += r;
    cnt[py * W + px]++;
    meanR += r; nR++;
  }
  meanR /= nR;

  const grid = new Float32Array(W * H);
  const filled = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (cnt[i]) { grid[i] = sum[i] / cnt[i] - meanR; filled[i] = 1; }
  }
  // Hole fill: iterative neighbor averaging (poles/bin gaps).
  for (let pass = 0; pass < 24; pass++) {
    let holes = 0;
    for (let yPix = 0; yPix < H; yPix++) {
      for (let xPix = 0; xPix < W; xPix++) {
        const i = yPix * W + xPix;
        if (filled[i]) continue;
        let s = 0, c = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = (xPix + dx + W) % W;
          const ny = yPix + dy;
          if (ny < 0 || ny >= H) continue;
          const j = ny * W + nx;
          if (filled[j]) { s += grid[j]; c++; }
        }
        if (c >= 2) { grid[i] = s / c; filled[i] = 2; }
        else holes++;
      }
    }
    for (let i = 0; i < W * H; i++) if (filled[i] === 2) filled[i] = 1;
    if (!holes) break;
  }
  // Fully empty polar rows deadlock the >=2-neighbor rule (their horizontal
  // neighbors are equally empty) — propagate the nearest filled row into any
  // remaining holes.
  for (let yPix = 0; yPix < H; yPix++) {
    for (let xPix = 0; xPix < W; xPix++) {
      const i = yPix * W + xPix;
      if (filled[i]) continue;
      for (let d = 1; d < H; d++) {
        const below = yPix + d, above = yPix - d;
        if (below < H && filled[below * W + xPix]) { grid[i] = grid[below * W + xPix]; break; }
        if (above >= 0 && filled[above * W + xPix]) { grid[i] = grid[above * W + xPix]; break; }
      }
      filled[i] = 1;
    }
  }
  return { grid, meanR };
}

// -------------------------------------------------------- synthetic topography
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Procedural cratered terrain (km heights) for moons lacking real DTMs. */
function synthTopo(W, H, radiusKm, seed, { craters = 900, ridge = false } = {}) {
  const grid = new Float32Array(W * H);
  const rng = mulberry(seed);

  // Low-frequency undulation.
  const lf = [];
  for (let k = 0; k < 24; k++) {
    lf.push({
      // Random unit vector + phase for a spherical harmonic-ish wave.
      x: rng() * 2 - 1, y: rng() * 2 - 1, z: rng() * 2 - 1,
      f: 2 + rng() * 6, p: rng() * Math.PI * 2, a: (rng() - 0.3) * 0.6,
    });
  }
  const dir = (px, py) => {
    const lon = (px / W) * Math.PI * 2;
    const lat = Math.PI / 2 - (py / H) * Math.PI;
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  };
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const [dx, dy, dz] = dir(px, py);
      let h = 0;
      for (const w of lf) h += Math.sin((dx * w.x + dy * w.y + dz * w.z) * w.f + w.p) * w.a;
      grid[py * W + px] = h;
    }
  }

  // Crater field: bowls with raised rims, power-law sizes.
  for (let c = 0; c < craters; c++) {
    const cx = rng() * W;
    const cy = (0.08 + rng() * 0.84) * H;
    const R = (2 + Math.pow(rng(), 2.6) * 46) * (W / 1024);
    const depth = R * 0.09 * (radiusKm / 700) * (0.5 + rng());
    const [cdx, cdy, cdz] = dir(cx, cy);
    const cosLat = Math.max(0.15, Math.cos(Math.PI / 2 - (cy / H) * Math.PI));
    const y0 = Math.max(0, Math.floor(cy - R * 1.5));
    const y1 = Math.min(H - 1, Math.ceil(cy + R * 1.5));
    for (let py = y0; py <= y1; py++) {
      const xSpan = Math.ceil((R * 1.5) / cosLat);
      for (let ox = -xSpan; ox <= xSpan; ox++) {
        const px = ((Math.round(cx) + ox) % W + W) % W;
        const [ddx, ddy, ddz] = dir(px, py);
        const angular = Math.acos(Math.min(1, cdx * ddx + cdy * ddy + cdz * ddz));
        const d = (angular / (Math.PI * 2)) * W / (R); // 0 center, 1 rim
        if (d > 1.5) continue;
        const i = py * W + px;
        if (d < 0.85) grid[i] -= depth * (1 - (d / 0.85) ** 2) * 0.9;
        else if (d < 1.25) grid[i] += depth * 0.35 * (1 - Math.abs(d - 1.05) / 0.2);
      }
    }
  }

  // Iapetus' real equatorial ridge (~13 km high, spanning Cassini Regio).
  if (ridge) {
    for (let py = 0; py < H; py++) {
      const lat = Math.PI / 2 - (py / H) * Math.PI;
      const band = Math.exp(-((lat / 0.028) ** 2));
      if (band < 0.01) continue;
      for (let px = 0; px < W; px++) {
        const lon = (px / W) * Math.PI * 2;
        // Ridge strongest around the leading hemisphere, gappy elsewhere.
        const seg = 0.5 + 0.5 * Math.sin(lon * 3 + 1.2);
        const strength = Math.max(0, Math.sin(lon + 0.6)) * 0.85 + seg * 0.15;
        grid[py * W + px] += 11 * band * strength;
      }
    }
  }
  return { grid, meanR: radiusKm };
}

// -------------------------------------------------------------- bake pipeline
function downsample(src, sw, sh, W, H) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y / H) * sh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) / H) * sh));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x / W) * sw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) / W) * sw));
      let s = 0, c = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const v = src[yy * sw + xx];
          if (Number.isFinite(v)) { s += v; c++; }
        }
      }
      out[y * W + x] = c ? s / c : 0;
    }
  }
  return out;
}

function smooth(grid, W, H, passes = 1) {
  let g = grid;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0, c = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = (x + dx + W) % W, ny = y + dy;
          if (ny < 0 || ny >= H) continue;
          s += g[ny * W + nx]; c++;
        }
        out[y * W + x] = s / c;
      }
    }
    g = out;
  }
  return g;
}

const manifest = {};

function bake(name, grid, W, H, meanRKm) {
  // Robust range (clip outliers at 0.2/99.8 percentiles).
  const sorted = Float32Array.from(grid).sort();
  const lo = sorted[Math.floor(sorted.length * 0.002)];
  const hi = sorted[Math.floor(sorted.length * 0.998)];
  const range = hi - lo || 1;

  const heightPx = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    heightPx[i] = Math.round(Math.min(1, Math.max(0, (grid[i] - lo) / range)) * 255);
  }
  writePng(`public/textures/relief/${name}_height.png`, W, H, 1, heightPx);

  // Physically scaled tangent-space normal from the float grid.
  const kmPerPxY = (Math.PI * meanRKm) / H;
  const normalPx = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
    const kmPerPxX = kmPerPxY * Math.max(0.15, Math.cos(lat));
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
      const dhdx = (grid[y * W + xp] - grid[y * W + xm]) / (2 * kmPerPxX);
      const dhdy = (grid[yp * W + x] - grid[ym * W + x]) / (2 * kmPerPxY);
      const inv = 1 / Math.hypot(dhdx, dhdy, 1);
      const i = (y * W + x) * 3;
      normalPx[i] = Math.round((-dhdx * inv * 0.5 + 0.5) * 255);
      normalPx[i + 1] = Math.round((dhdy * inv * 0.5 + 0.5) * 255);
      normalPx[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
    }
  }
  writePng(`public/textures/relief/${name}_normal.png`, W, H, 3, normalPx);

  manifest[name] = {
    scale: range / meanRKm,
    bias: lo / meanRKm,
  };
  console.log(`${name}: ${W}x${H}, height ${lo.toFixed(2)}..${hi.toFixed(2)} km of r=${meanRKm.toFixed(1)} km`);
}

// Enceladus: real DEM, elevation in km. NoData fill values are huge
// negatives — mask anything outside a plausible ±50 km.
{
  const { width, height, data } = readFloatTiff(join(SRC, 'enceladus_dem.tif'));
  console.log(`enceladus tiff: ${width}x${height}`);
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > 50) data[i] = NaN;
  const W = 2048, H = 1024;
  bake('enceladus', smooth(downsample(data, width, height, W, H), W, H, 1), W, H, 252.1);
}

// Dione: real DTM storing ABSOLUTE radius in meters — convert to km of
// elevation relative to the grid median.
{
  const { width, height, data } = readFloatTiff(join(SRC, 'dione_eqradius_g.tif'));
  console.log(`dione tiff: ${width}x${height}`);
  for (let i = 0; i < data.length; i++) {
    const km = data[i] / 1000;
    data[i] = km > 100 && km < 1000 ? km : NaN;
  }
  const finite = Float32Array.from(data.filter(Number.isFinite)).sort();
  const median = finite[Math.floor(finite.length / 2)];
  for (let i = 0; i < data.length; i++) data[i] -= median;
  const W = 1024, H = 512;
  bake('dione', smooth(downsample(data, width, height, W, H), W, H, 1), W, H, 561.4);
}

// Mimas + Tethys: Gaskell shape models -> equirect grids.
{
  const W = 1024, H = 512;
  const m = await readShapeModel(join(SRC, 'mimas_quad512q.tab'), false, W, H);
  bake('mimas', smooth(m.grid, W, H, 1), W, H, m.meanR);
  const t = await readShapeModel(join(SRC, 'tethys_ver256q.tab'), true, W, H);
  bake('tethys', smooth(t.grid, W, H, 1), W, H, t.meanR);
}

// Rhea + Iapetus: no public DTM exists — synthetic (documented).
{
  const W = 1024, H = 512;
  const r = synthTopo(W, H, 763.8, 1337, { craters: 1100 });
  bake('rhea', smooth(r.grid, W, H, 1), W, H, 763.8);
  const i = synthTopo(W, H, 734.5, 4242, { craters: 800, ridge: true });
  bake('iapetus', smooth(i.grid, W, H, 1), W, H, 734.5);
}

writeFileSync('public/textures/relief/relief.json', JSON.stringify(manifest, null, 2));
console.log('wrote relief.json:', JSON.stringify(manifest));
