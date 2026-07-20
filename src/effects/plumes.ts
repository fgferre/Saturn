/**
 * Enceladus' south-polar geysers: GPU-animated instanced sprites erupting
 * from the tiger-stripe region. Positions, sizes and fading are computed
 * entirely in TSL (no per-frame CPU work).
 *
 * Instanced camera-facing quads (SpriteNodeMaterial) rather than THREE.Points:
 * WebGPU rasterizes point primitives as exactly 1 pixel, so Points cannot
 * express particle size on that backend.
 *
 * Coordinates are in the moon's local unit-sphere frame (the mesh scale
 * turns them into world units), so the jets stay locked to the stripes.
 */

import {
  AdditiveBlending, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, PlaneGeometry, Vector3,
} from 'three';
import { SpriteNodeMaterial } from 'three/webgpu';
import {
  cos, float, fract, instancedBufferAttribute, mix, oneMinus, pow, sin,
  smoothstep, time, uv, vec3,
} from 'three/tsl';
import { makeRng } from '../utils/noise.ts';

const PARTICLE_COUNT = 1600;
const JET_COUNT = 8;
/** Max plume height in unit-sphere units (≈ 500 km for Enceladus' 252 km radius). */
const MAX_HEIGHT = 3.2;

export function createEnceladusPlumes(): Mesh {
  const rng = makeRng(20260719);

  // Jet sources along the tiger stripes (south polar, ~75–85°S).
  const jets: { origin: Vector3; dir: Vector3 }[] = [];
  for (let j = 0; j < JET_COUNT; j++) {
    const lon = (j / JET_COUNT) * Math.PI * 2 + rng() * 0.6;
    const lat = -(Math.PI / 2) + (0.10 + rng() * 0.14); // near south pole
    const origin = new Vector3(
      Math.cos(lat) * Math.cos(lon),
      Math.sin(lat),
      Math.cos(lat) * Math.sin(lon),
    );
    // Mostly along the local "down" (away from center), canted slightly.
    const dir = origin.clone()
      .add(new Vector3((rng() - 0.5) * 0.35, -0.15, (rng() - 0.5) * 0.35))
      .normalize();
    jets.push({ origin, dir });
  }

  const origins = new Float32Array(PARTICLE_COUNT * 3);
  const dirs = new Float32Array(PARTICLE_COUNT * 3);
  const rand = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const jet = jets[i % JET_COUNT];
    const spread = 0.10;
    origins.set([jet.origin.x, jet.origin.y, jet.origin.z], i * 3);
    dirs.set([
      jet.dir.x + (rng() - 0.5) * spread,
      jet.dir.y + (rng() - 0.5) * spread * 0.5,
      jet.dir.z + (rng() - 0.5) * spread,
    ], i * 3);
    rand[i] = rng();
  }

  // One shared quad, instanced per particle.
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.attributes.position = quad.attributes.position;
  geometry.attributes.uv = quad.attributes.uv;
  geometry.instanceCount = PARTICLE_COUNT;
  geometry.setAttribute('jetOrigin', new InstancedBufferAttribute(origins, 3));
  geometry.setAttribute('jetDir', new InstancedBufferAttribute(dirs, 3));
  geometry.setAttribute('seed', new InstancedBufferAttribute(rand, 1));

  const material = new SpriteNodeMaterial();
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;

  const seed = instancedBufferAttribute(geometry.attributes.seed as InstancedBufferAttribute);
  const origin = instancedBufferAttribute(geometry.attributes.jetOrigin as InstancedBufferAttribute);
  const dir = instancedBufferAttribute(geometry.attributes.jetDir as InstancedBufferAttribute);

  // Each particle loops on its own phase; slow stately rise (~40 s cycle).
  const p = fract(time.mul(0.025).add(seed.mul(7.31)));
  // Ballistic ease-out: fast at the vent, slowing with altitude.
  const h = oneMinus(oneMinus(p).mul(oneMinus(p))).mul(MAX_HEIGHT);
  // Slight lateral curl so jets feather outward as they climb.
  const ang = seed.mul(6.2832).add(p.mul(2.0));
  const lateral = vec3(cos(ang), float(0), sin(ang)).mul(p.mul(p).mul(0.22));
  material.positionNode = origin.add(dir.mul(h)).add(lateral);

  // Soft round particle from the quad's uv.
  const disc = smoothstep(0.5, 0.05, uv().sub(0.5).length());
  const fadeIn = smoothstep(0.0, 0.04, p);
  const fadeOut = pow(oneMinus(p), 1.8);
  material.opacityNode = fadeIn.mul(fadeOut).mul(disc).mul(0.085);
  material.colorNode = mix(vec3(0.85, 0.93, 1.0), vec3(0.55, 0.70, 0.95), p);
  // World-ish (local-unit) size: grows as the spray expands and thins.
  material.scaleNode = float(0.025).add(p.mul(0.28));

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false; // animated positions exceed the static bounds
  return mesh;
}
