/**
 * Volumetric ring fly-through: an instanced-sprite particle slab that
 * materializes around the camera when it approaches the ring plane, giving
 * real 3D parallax through the rings. Fully stateless — every particle's
 * position derives from its instance index + camera uniforms in the vertex
 * stage (world-anchored tiling, so particles hold still while the camera
 * moves and the slab follows by re-tiling at its far edge).
 *
 * Density and color come from the same real radial ring profile the flat
 * ring uses, so the slab thins out in the gaps and vanishes off the rings.
 */

import {
  AdditiveBlending, InstancedBufferGeometry, Mesh, PlaneGeometry, Texture,
} from 'three';
import { SpriteNodeMaterial } from 'three/webgpu';
import {
  cameraPosition, clamp, dot, float, floor, hash, instanceIndex, normalize,
  oneMinus, pow, smoothstep, texture, uv, vec2, vec3,
} from 'three/tsl';
import { slabVisUniform, sunDirUniform } from '../materials/sharedUniforms.ts';
import { RINGS, KM_PER_UNIT } from '../data/saturn.ts';

/** Slab tile size around the camera, scene units (1 = 1000 km). */
const TILE = 7;
/** Visual slab thickness (real rings are ~10 m; exaggerated to stay visible). */
const THICKNESS = 0.012;

export function createRingSlab(profileTexture: Texture, count = 65536): Mesh {
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.attributes.position = quad.attributes.position;
  geometry.attributes.uv = quad.attributes.uv;
  geometry.instanceCount = count;

  const material = new SpriteNodeMaterial();
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;

  const idx = instanceIndex.toFloat();
  const h1 = hash(idx.add(0.17));
  const h2 = hash(idx.add(7.31));
  const h3 = hash(idx.add(19.7));
  const h4 = hash(idx.add(41.3));

  // World-anchored tiling: each particle owns a fixed offset inside a TILE
  // square; the square snaps to whichever tile is nearest the camera.
  const ox = h1.mul(TILE);
  const oz = h2.mul(TILE);
  const px = ox.add(floor(cameraPosition.x.sub(ox).div(TILE).add(0.5)).mul(TILE));
  const pz = oz.add(floor(cameraPosition.z.sub(oz).div(TILE).add(0.5)).mul(TILE));
  const py = h3.sub(0.5).mul(THICKNESS * 2);
  const worldPos = vec3(px, py, pz);
  material.positionNode = worldPos;

  // Radial profile lookup at the particle's ring radius.
  const innerU = RINGS.innerKm / KM_PER_UNIT;
  const outerU = RINGS.outerKm / KM_PER_UNIT;
  const r = worldPos.xz.length();
  const ru = clamp(r.sub(innerU).div(outerU - innerU), 0, 1);
  const smp = texture(profileTexture, vec2(ru, 0.5)).level(float(0));
  const density = smp.a;

  // Sprite look: soft disc, size varies per particle.
  const disc = smoothstep(0.5, 0.1, uv().sub(0.5).length());
  const camDist = worldPos.sub(cameraPosition).length();
  const distFade = smoothstep(float(TILE * 0.48), float(TILE * 0.2), camDist);
  // Only particles whose sprite footprint stays sub-camera-close vanish.
  const nearFade = smoothstep(0.005, 0.03, camDist);

  const V = normalize(cameraPosition.sub(worldPos));
  const cosPhase = dot(V, sunDirUniform);
  const fwd = pow(clamp(cosPhase.negate(), 0, 1), 4).mul(1.6);
  const lit = float(0.55).add(fwd);

  material.colorNode = smp.rgb.mul(vec3(0.80, 0.75, 0.62)).mul(lit);
  material.opacityNode = disc
    .mul(density)
    .mul(distFade)
    .mul(nearFade)
    .mul(slabVisUniform)
    .mul(pow(oneMinus(clamp(worldPos.y.abs().div(THICKNESS), 0, 1)), 1.5))
    .mul(0.30);
  material.scaleNode = h4.mul(0.010).add(0.004);

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
