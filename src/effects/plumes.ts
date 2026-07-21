/**
 * Enceladus' south-polar geysers as GPU compute particles: a ballistic
 * kernel integrates each grain (launch from a tiger-stripe vent, local
 * gravity pulls it back; escaped grains recycle) into storage buffers that
 * an instanced-sprite material renders with forward-scattered lighting —
 * the plumes glow when backlit, exactly as Cassini photographed them.
 *
 * On WebGPU the kernel is a real compute pass; the WebGL2 fallback runs it
 * via transform feedback (the kernel only does 1:1 writes, no atomics).
 *
 * Coordinates are the moon's local unit-sphere frame (mesh scale maps to
 * world), so the vents stay locked to the tiger stripes.
 */

import { InstancedBufferGeometry, Mesh, PlaneGeometry } from 'three';
import { AdditiveBlending } from 'three';
import { SpriteNodeMaterial } from 'three/webgpu';
import type { ComputeNode, UniformNode } from 'three/webgpu';
import {
  Fn, If, cameraPosition, clamp, cos, dot, exp, float, hash, instanceIndex,
  instancedArray, max, mix, modelWorldMatrixInverse, normalize, pow, sin,
  smoothstep, uniform, uv, vec3, vec4,
} from 'three/tsl';
import { plumeActivityUniform, sunDirUniform } from '../materials/sharedUniforms.ts';

/** Local gravity strength tuned so arcs top out ~2.5 radii up. */
const GRAVITY = 0.16;

export interface PlumeSystem {
  mesh: Mesh;
  init: ComputeNode;
  update: ComputeNode;
  /** Real-seconds timestep uniform, set each frame. */
  dt: { value: number };
}

export function createEnceladusPlumes(
  count = 262144,
  eclipseLight?: UniformNode<number>,
): PlumeSystem {
  const posBuf = instancedArray(count, 'vec3');
  const velBuf = instancedArray(count, 'vec3');
  const lifeBuf = instancedArray(count, 'float');

  const dtUniform = uniform(0);

  const init = Fn(() => {
    const i = instanceIndex.toFloat();
    posBuf.element(instanceIndex).assign(vec3(0, -2, 0)); // hidden until spawn
    velBuf.element(instanceIndex).assign(vec3(0, 0, 0));
    // Staggered negative life ramps the plume in over the first seconds.
    lifeBuf.element(instanceIndex).assign(hash(i.add(3.7)).mul(-9.0));
  })().compute(count);

  const update = Fn(() => {
    const i = instanceIndex.toFloat();
    const pos = posBuf.element(instanceIndex).toVar();
    const vel = velBuf.element(instanceIndex).toVar();
    const life = lifeBuf.element(instanceIndex).toVar();

    // Negative life = staggered pre-spawn countdown; positive = airborne.
    const wasAlive = life.greaterThan(0.0).toVar();
    If(wasAlive, () => {
      life.subAssign(dtUniform);
      pos.addAssign(vel.mul(dtUniform));
      // Inverse-square local gravity toward the moon's center.
      const r = max(pos.length(), 0.35);
      vel.subAssign(normalize(pos).mul(float(GRAVITY).div(r.mul(r))).mul(dtUniform));
    }).Else(() => {
      life.addAssign(dtUniform);
    });

    // (Re)spawn: countdown finished, flight expired, re-impacted, or escaped.
    const born = wasAlive.not().and(life.greaterThanEqual(0.0));
    const expired = wasAlive.and(life.lessThanEqual(0.0));
    If(born.or(expired)
      .or(pos.length().lessThan(0.995)).or(pos.length().greaterThan(6.0)), () => {
      // Vent on one of 8 tiger-stripe jets, derived from the particle index.
      const jet = i.mod(8);
      const hj = hash(i.add(0.17));
      const hk = hash(i.add(9.31));
      const lon = jet.div(8).mul(Math.PI * 2).add(hj.mul(0.6));
      const lat = float(-Math.PI / 2).add(0.10).add(hk.mul(0.14));
      const origin = vec3(cos(lat).mul(cos(lon)), sin(lat), cos(lat).mul(sin(lon)));

      const h1 = hash(i.add(1.3));
      const h2 = hash(i.add(5.9));
      const h3 = hash(i.add(11.1));
      const dir = normalize(origin.add(vec3(
        h1.sub(0.5).mul(0.45),
        float(-0.30),
        h2.sub(0.5).mul(0.45),
      )));
      pos.assign(origin.mul(1.002));
      // 0.32..0.58 vs escape speed sqrt(2*GRAVITY) ≈ 0.566: most grains arc
      // back ballistically, the fastest few escape — those feed the E ring.
      vel.assign(dir.mul(h3.mul(0.26).add(0.32)));
      life.assign(h1.mul(5.0).add(5.0));
    });

    posBuf.element(instanceIndex).assign(pos);
    velBuf.element(instanceIndex).assign(vel);
    lifeBuf.element(instanceIndex).assign(life);
  })().compute(count);

  // --- Render: instanced soft sprites reading the storage buffers ---
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

  const pos = posBuf.toAttribute();
  const life = lifeBuf.toAttribute();
  material.positionNode = pos;

  const alt = pos.length().sub(1.0);
  const disc = smoothstep(0.5, 0.06, uv().sub(0.5).length());
  // Forward scattering: icy grains glow against the light. Both vectors in
  // the moon's LOCAL frame (particle positions are local; the camera and
  // sun direction must be transformed in).
  const camLocal = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
  const sunLocal = normalize(modelWorldMatrixInverse.mul(vec4(sunDirUniform, 0)).xyz);
  const V = normalize(camLocal.sub(pos));
  const fwd = pow(clamp(dot(V, sunLocal).negate(), 0, 1), 3).mul(2.4).add(0.18);

  const visible = smoothstep(0.0, 0.15, life); // hidden while life < 0
  // Saturn's shadow on Enceladus: the geysers dim with the moon as it enters
  // the umbra (scalar eclipseLight at the moon center — the plume extends
  // ≤6 radii ≪ the umbra radius, so a per-cloud scalar is a valid approx).
  // plumeActivityUniform (0.25..1) modulates output over the diurnal tidal
  // cycle; composes multiplicatively with the eclipse dimming (both scalars).
  material.opacityNode = disc
    .mul(visible)
    .mul(exp(alt.negate().div(1.4)))
    .mul(fwd)
    .mul(eclipseLight ?? float(1))
    .mul(plumeActivityUniform)
    .mul(0.055);
  material.colorNode = mix(vec3(0.80, 0.90, 1.0), vec3(0.95, 0.97, 1.0), clamp(alt.div(3), 0, 1));
  material.scaleNode = clamp(alt.mul(0.05).add(0.015), 0.012, 0.16)
    .mul(hash(instanceIndex.toFloat().add(2.9)).mul(0.7).add(0.65));

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  return { mesh, init, update, dt: dtUniform };
}
