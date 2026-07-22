/**
 * Deterministic high-detail geometry for Saturn's non-spherical moons.
 *
 * The macro silhouette, impact bowls and the material masks are generated from
 * the same crater field. This keeps a dark crater floor inside its actual bowl
 * instead of painting an unrelated cellular pattern over the surface.
 *
 * Scientific morphology references (Cassini / NASA):
 * - Hyperion dimensions, deep craters, bright ice walls and dark floors:
 *   https://science.nasa.gov/saturn/moons/hyperion/
 * - Pan / Atlas / Daphnis equatorial accretion ridges and smooth mantles:
 *   https://science.nasa.gov/missions/cassini/cassini-finds-saturns-rings-coat-tiny-moons/
 * - Prometheus is irregular and less cratered than Pandora / Janus / Epimetheus:
 *   https://science.nasa.gov/saturn/moons/prometheus/
 * - Pandora's craters are softened by fine icy debris:
 *   https://science.nasa.gov/saturn/moons/pandora/
 * - Janus / Epimetheus dimensions and ancient, dust-softened crater fields:
 *   https://science.nasa.gov/saturn/moons/janus/
 *   https://science.nasa.gov/saturn/moons/epimetheus/
 * - Phoebe is roughly spherical, very dark and captured:
 *   https://science.nasa.gov/saturn/moons/phoebe/
 */

import {
  BufferAttribute, type BufferGeometry, IcosahedronGeometry, Vector3,
} from 'three';
import { fbm3D, makeRng } from '../utils/noise.ts';
import { weldProceduralMoonGeometry } from './proceduralMoonGeometry.ts';

export const PROCEDURAL_MOON_IDS = [
  'hyperion', 'pan', 'daphnis', 'atlas', 'prometheus', 'pandora',
  'janus', 'epimetheus', 'phoebe',
] as const;

export type ProceduralMoonId = typeof PROCEDURAL_MOON_IDS[number];

interface FeaturedCrater {
  center: [number, number, number];
  radius: number;
  depth: number;
  rim: number;
  darkness: number;
}

export interface ProceduralMoonShape {
  /** Geometry density. detail=18 is 7,220 triangles before welding. */
  detail: number;
  seed: number;
  /** Semi-axis / catalog mean-radius ratios in local X/Y/Z. */
  axes: [number, number, number];
  macroScale: number;
  macroStrength: number;
  craterCount: number;
  craterRadius: [number, number];
  craterDepth: [number, number];
  craterRim: [number, number];
  /** >1 rounds and softens the bowl; near 1 preserves a crisp impact wall. */
  craterSoftness: number;
  floorDarkness: [number, number];
  ridge?: { height: number; power: number };
  featuredCraters?: FeaturedCrater[];
}

/**
 * Shape ratios use published dimensions where Cassini resolved them. Values
 * without a complete shape model are conservative visual approximations, not
 * ephemeris-grade topography; the source-backed morphology remains the gate.
 */
export const PROCEDURAL_MOON_SHAPES: Record<ProceduralMoonId, ProceduralMoonShape> = {
  hyperion: {
    detail: 20, seed: 701, axes: [1.52, 0.96, 0.81],
    macroScale: 1.45, macroStrength: 0.16,
    craterCount: 34, craterRadius: [0.11, 0.36], craterDepth: [0.035, 0.145],
    craterRim: [0.004, 0.015], craterSoftness: 1.02, floorDarkness: [0.32, 1],
    featuredCraters: [
      { center: [0.68, 0.10, 0.72], radius: 0.52, depth: 0.24, rim: 0.018, darkness: 1 },
      { center: [-0.42, 0.52, 0.74], radius: 0.34, depth: 0.14, rim: 0.014, darkness: 0.72 },
    ],
  },
  pan: {
    detail: 18, seed: 101, axes: [0.97, 0.74, 0.90],
    macroScale: 2.2, macroStrength: 0.055,
    craterCount: 4, craterRadius: [0.14, 0.25], craterDepth: [0.012, 0.036],
    craterRim: [0.001, 0.004], craterSoftness: 1.55, floorDarkness: [0.18, 0.38],
    ridge: { height: 0.26, power: 12 },
  },
  daphnis: {
    detail: 18, seed: 211, axes: [0.94, 0.72, 0.88],
    macroScale: 2.4, macroStrength: 0.045,
    craterCount: 3, craterRadius: [0.13, 0.22], craterDepth: [0.010, 0.030],
    craterRim: [0.001, 0.003], craterSoftness: 1.65, floorDarkness: [0.12, 0.30],
    ridge: { height: 0.22, power: 11 },
  },
  atlas: {
    detail: 18, seed: 307, axes: [0.98, 0.63, 0.84],
    macroScale: 2.0, macroStrength: 0.065,
    craterCount: 5, craterRadius: [0.13, 0.24], craterDepth: [0.012, 0.038],
    craterRim: [0.001, 0.004], craterSoftness: 1.50, floorDarkness: [0.18, 0.40],
    ridge: { height: 0.39, power: 10 },
  },
  prometheus: {
    detail: 18, seed: 401, axes: [1.58, 0.92, 0.68],
    macroScale: 1.75, macroStrength: 0.11,
    craterCount: 8, craterRadius: [0.12, 0.28], craterDepth: [0.020, 0.070],
    craterRim: [0.002, 0.007], craterSoftness: 1.30, floorDarkness: [0.22, 0.52],
  },
  pandora: {
    detail: 18, seed: 503, axes: [1.28, 1.01, 0.77],
    macroScale: 1.9, macroStrength: 0.085,
    craterCount: 15, craterRadius: [0.11, 0.29], craterDepth: [0.018, 0.065],
    craterRim: [0.001, 0.005], craterSoftness: 1.65, floorDarkness: [0.18, 0.44],
  },
  janus: {
    detail: 18, seed: 601, axes: [1.095, 1.073, 0.838],
    macroScale: 1.8, macroStrength: 0.075,
    craterCount: 19, craterRadius: [0.11, 0.31], craterDepth: [0.020, 0.080],
    craterRim: [0.002, 0.007], craterSoftness: 1.48, floorDarkness: [0.24, 0.56],
    featuredCraters: [
      { center: [-0.38, 0.52, 0.76], radius: 0.36, depth: 0.095, rim: 0.008, darkness: 0.55 },
    ],
  },
  epimetheus: {
    detail: 18, seed: 809, axes: [1.164, 0.931, 0.905],
    macroScale: 1.75, macroStrength: 0.095,
    craterCount: 17, craterRadius: [0.11, 0.31], craterDepth: [0.022, 0.085],
    craterRim: [0.002, 0.008], craterSoftness: 1.42, floorDarkness: [0.26, 0.60],
    // Cassini: pronounced south-polar flattening is the remnant of a large crater.
    featuredCraters: [
      { center: [0.05, -0.98, 0.18], radius: 0.49, depth: 0.13, rim: 0.009, darkness: 0.68 },
    ],
  },
  phoebe: {
    detail: 20, seed: 907, axes: [1.03, 0.98, 1.00],
    macroScale: 2.5, macroStrength: 0.065,
    craterCount: 25, craterRadius: [0.10, 0.30], craterDepth: [0.020, 0.085],
    craterRim: [0.002, 0.008], craterSoftness: 1.25, floorDarkness: [0.24, 0.66],
    featuredCraters: [
      { center: [0.22, 0.78, 0.58], radius: 0.43, depth: 0.14, rim: 0.010, darkness: 0.62 },
    ],
  },
};

interface Crater {
  center: Vector3;
  radius: number;
  depth: number;
  rim: number;
  darkness: number;
}

interface CraterSample {
  displacement: number;
  floor: number;
  rim: number;
  cavity: number;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smooth01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function makeCraters(config: ProceduralMoonShape): Crater[] {
  const rng = makeRng(config.seed ^ 0x6d2b79f5);
  const craters: Crater[] = (config.featuredCraters ?? []).map((c) => ({
    center: new Vector3(...c.center).normalize(),
    radius: c.radius,
    depth: c.depth,
    rim: c.rim,
    darkness: c.darkness,
  }));

  for (let i = 0; i < config.craterCount; i++) {
    let candidate: Crater | null = null;
    // Mild blue-noise rejection avoids accidental flower-like clusters while
    // retaining realistic overlap between generations of impacts.
    for (let attempt = 0; attempt < 48; attempt++) {
      const z = rng() * 2 - 1;
      const theta = rng() * Math.PI * 2;
      const radial = Math.sqrt(Math.max(0, 1 - z * z));
      const radiusT = Math.pow(rng(), 1.65); // many small, few large craters
      const radius = lerp(config.craterRadius[0], config.craterRadius[1], radiusT);
      const depthT = clamp01(radiusT * 0.72 + rng() * 0.28);
      candidate = {
        center: new Vector3(radial * Math.cos(theta), z, radial * Math.sin(theta)),
        radius,
        depth: lerp(config.craterDepth[0], config.craterDepth[1], depthT),
        rim: lerp(config.craterRim[0], config.craterRim[1], rng()),
        darkness: lerp(config.floorDarkness[0], config.floorDarkness[1], rng()),
      };
      const separated = craters.every((other) => {
        const chord = Math.sqrt(Math.max(0, 2 * (1 - candidate!.center.dot(other.center))));
        return chord > (candidate!.radius + other.radius) * 0.30;
      });
      if (separated) break;
    }
    if (candidate) craters.push(candidate);
  }
  return craters;
}

function sampleCraters(p: Vector3, craters: Crater[], softness: number): CraterSample {
  let deepestBowl = 0;
  let highestRim = 0;
  let floor = 0;
  let rim = 0;
  let cavity = 0;

  for (const crater of craters) {
    const chord = Math.sqrt(Math.max(0, 2 * (1 - p.dot(crater.center))));
    if (chord >= crater.radius) continue;
    const t = chord / crater.radius;
    const bowl = -Math.pow(Math.max(0, 1 - t * t), softness) * crater.depth;
    // A broad wall/rim transition spans several tessellation rings. A narrow
    // one-vertex mask aliases into a sawtooth in close-up even with smooth
    // normals, while Cassini shows broad exposed-ice crater walls on Hyperion.
    const rimBand = smooth01((t - 0.55) / 0.23) * (1 - smooth01((t - 0.78) / 0.22));
    // Overlapping crater rims must not add into artificial spikes. The younger /
    // deeper impact owns the bowl while the strongest local rim owns the lip —
    // an erosion-like envelope similar to the reference asteroid conditioning.
    deepestBowl = Math.min(deepestBowl, bowl);
    highestRim = Math.max(highestRim, rimBand * crater.rim);
    floor = Math.max(floor, (1 - smooth01((t - 0.42) / 0.30)) * crater.darkness);
    rim = Math.max(rim, rimBand);
    cavity = Math.max(cavity, 1 - smooth01((t - 0.12) / 0.88));
  }

  return {
    displacement: Math.max(-0.34, Math.min(0.07, deepestBowl + highestRim)),
    floor: clamp01(floor),
    rim: clamp01(rim),
    cavity: clamp01(cavity),
  };
}

/** Build one scientifically differentiated non-spherical moon. */
export function createIrregularMoonGeometry(id: ProceduralMoonId): BufferGeometry {
  const config = PROCEDURAL_MOON_SHAPES[id];
  const geometry = new IcosahedronGeometry(1, config.detail);
  const position = geometry.getAttribute('position');
  const craterFloor = new Float32Array(position.count);
  const craterRim = new Float32Array(position.count);
  const craterCavity = new Float32Array(position.count);
  const accretionRidge = new Float32Array(position.count);
  const craters = makeCraters(config);
  const p = new Vector3();

  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).normalize();
    const crater = sampleCraters(p, craters, config.craterSoftness);
    const macro = (fbm3D(
      p.x * config.macroScale + config.seed * 0.013,
      p.y * config.macroScale - config.seed * 0.009,
      p.z * config.macroScale + config.seed * 0.006,
      4,
      config.seed,
    ) - 0.5) * config.macroStrength;
    const radial = Math.max(0.56, 1 + macro + crater.displacement);

    const equator = Math.hypot(p.x, p.z);
    const ridgeMask = config.ridge ? Math.pow(equator, config.ridge.power) : 0;
    const ridgeHeight = config.ridge ? config.ridge.height * ridgeMask : 0;
    const [axisX, axisY, axisZ] = config.axes;
    position.setXYZ(
      i,
      p.x * radial * (axisX + ridgeHeight),
      p.y * radial * axisY,
      p.z * radial * (axisZ + ridgeHeight),
    );
    craterFloor[i] = crater.floor;
    craterRim[i] = crater.rim;
    craterCavity[i] = crater.cavity;
    accretionRidge[i] = ridgeMask;
  }

  position.needsUpdate = true;
  geometry.setAttribute('craterFloor', new BufferAttribute(craterFloor, 1));
  geometry.setAttribute('craterRim', new BufferAttribute(craterRim, 1));
  geometry.setAttribute('craterCavity', new BufferAttribute(craterCavity, 1));
  geometry.setAttribute('accretionRidge', new BufferAttribute(accretionRidge, 1));
  return weldProceduralMoonGeometry(geometry);
}
