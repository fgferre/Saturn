/**
 * Procedural starfield: ~8400 stars on a distant sphere with blackbody-ish
 * color variation plus a denser, tilted Milky Way band. Deterministic seed.
 *
 * Rendered as ONE instanced-sprite mesh (WebGPU rasterizes Points primitives
 * at a fixed 1 pixel, so per-star sizes need camera-facing quads) — a single
 * draw call for the whole sky.
 */

import {
  AdditiveBlending, BackSide, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, PlaneGeometry, SphereGeometry, Texture, Vector3,
} from 'three';
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import { instancedBufferAttribute, oneMinus, smoothstep, texture, uv } from 'three/tsl';
import { makeRng } from '../utils/noise.ts';
import { icrfToSceneMatrix } from '../data/sunDirection.ts';

/** Local radius of the procedural star shell (camera-centered each frame). */
export const SKY_RADIUS = 50000;
const COUNT = 8400;

/**
 * Real celestial sphere: NASA SVS Deep Star Map on a giant back-side sphere,
 * rotated so the Milky Way sits where it truly is in Saturn's sky.
 *
 * Onda 3: mesh is camera-centered every frame (see main) so the sky has no
 * parallax and the camera can never "reach" the shell.
 */
export function createSky(map: Texture): Mesh {
  const material = new MeshBasicNodeMaterial();
  material.side = BackSide;
  material.depthWrite = false;
  // Slight lift so the Milky Way survives ACES tone mapping.
  material.colorNode = texture(map, uv()).rgb.mul(1.35);

  // Radius well beyond SUN_FOLLOW_DISTANCE and the system; centered on camera.
  const mesh = new Mesh(new SphereGeometry(SKY_RADIUS, 64, 32), material);
  mesh.setRotationFromMatrix(icrfToSceneMatrix());
  mesh.renderOrder = -2; // behind everything, before orbit lines
  mesh.frustumCulled = false;
  return mesh;
}

/** Rough star color from a 0..1 "temperature" parameter (cool -> hot). */
function starColor(t: number): [number, number, number] {
  if (t < 0.25) return [1.0, 0.72 + t, 0.55 + t * 0.8]; // orange-ish
  if (t < 0.6) return [1.0, 0.95, 0.88]; // warm white
  if (t < 0.85) return [0.95, 0.97, 1.0]; // white
  return [0.75, 0.85, 1.0]; // blue-white
}

function randomDir(rng: () => number): Vector3 {
  // Uniform on the sphere.
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return new Vector3(r * Math.cos(a), z, r * Math.sin(a));
}

export function createStarfield(): Mesh {
  const rng = makeRng(60268);

  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const scales = new Float32Array(COUNT);

  // Milky Way plane: tilted arbitrary great circle.
  const bandNormal = new Vector3(0.35, 0.8, 0.5).normalize();

  let i = 0;
  const addStar = (dir: Vector3, brightness: number) => {
    const [r, g, b] = starColor(rng());
    const v = 0.3 + brightness * 0.7;
    // Local positions: parent mesh is translated to the camera each frame.
    positions.set([dir.x * SKY_RADIUS, dir.y * SKY_RADIUS, dir.z * SKY_RADIUS], i * 3);
    colors.set([r * v, g * v, b * v], i * 3);
    // World-unit sprite size at SKY_RADIUS: ~1–3 px on a 1080p screen.
    scales[i] = 40 + Math.pow(brightness, 3) * 90;
    i++;
  };

  // Field stars.
  for (let k = 0; k < 5200; k++) addStar(randomDir(rng), Math.pow(rng(), 1.6));

  // Milky Way band: pulled toward the plane, individually dimmer.
  for (let k = 0; k < COUNT - 5200; k++) {
    const d = randomDir(rng);
    const off = d.dot(bandNormal);
    d.addScaledVector(bandNormal, -off * (0.82 + rng() * 0.12)).normalize();
    addStar(d, Math.pow(rng(), 2.2) * 0.75);
  }

  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.attributes.position = quad.attributes.position;
  geometry.attributes.uv = quad.attributes.uv;
  geometry.instanceCount = COUNT;
  geometry.setAttribute('starPos', new InstancedBufferAttribute(positions, 3));
  geometry.setAttribute('starColor', new InstancedBufferAttribute(colors, 3));
  geometry.setAttribute('starScale', new InstancedBufferAttribute(scales, 1));

  const material = new SpriteNodeMaterial();
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;

  material.positionNode = instancedBufferAttribute(geometry.attributes.starPos as InstancedBufferAttribute);
  material.scaleNode = instancedBufferAttribute(geometry.attributes.starScale as InstancedBufferAttribute);
  // Defined form: edge0 < edge1 (same portability rule as Sun.ts).
  const disc = oneMinus(smoothstep(0.1, 0.5, uv().sub(0.5).length()));
  material.colorNode = instancedBufferAttribute(geometry.attributes.starColor as InstancedBufferAttribute);
  material.opacityNode = disc;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return mesh;
}

/** Keep a camera-centered sky/starfield co-located with the viewer. */
export function followCamera(background: Mesh, cameraPos: Vector3): void {
  background.position.copy(cameraPos);
}
