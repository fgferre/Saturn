/**
 * The F ring: a narrow, kinked, clumpy strand system shepherded by
 * Prometheus and Pandora. Three eccentric strands whose radial offsets and
 * clump brightness are noise-driven and slowly evolve; strongly
 * forward-scattering (it glows when backlit, nearly vanishes face-on).
 *
 * Geometry: flat angular ribbons in the ring plane; the strand's radial
 * wander happens in the vertex stage (positionNode), so kinks animate
 * without CPU work.
 */

import { AdditiveBlending, DoubleSide, Mesh, PlaneGeometry } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  cameraPosition, clamp, cos, dot, float, mix, mx_noise_float, normalize,
  oneMinus, positionWorld, pow, sin, uv, vec3,
} from 'three/tsl';
import { spokePhaseUniform, sunDirUniform } from './sharedUniforms.ts';
import { KM_PER_UNIT } from '../data/saturn.ts';

const F_RING_RADIUS_KM = 140180;
const STRANDS = [
  { offsetKm: 0, widthKm: 45, brightness: 1.0 },
  { offsetKm: -180, widthKm: 25, brightness: 0.45 },
  { offsetKm: 210, widthKm: 20, brightness: 0.35 },
];

export function createFRing(): Mesh[] {
  return STRANDS.map((strand, si) => {
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.blending = AdditiveBlending;
    material.side = DoubleSide;
    material.depthWrite = false;

    const baseR = (F_RING_RADIUS_KM + strand.offsetKm) / KM_PER_UNIT;
    const width = strand.widthKm / KM_PER_UNIT;

    // Ribbon: geometry u = angle 0..2π, v = across-strand -0.5..0.5.
    // Built from a plane and bent into an annulus in the vertex stage.
    const theta = uv().x.mul(Math.PI * 2);
    // Eccentric wobble + animated kinks (slow drift via spokePhase reuse).
    const kink = mx_noise_float(
      vec3(cos(theta).mul(3).add(si * 7.3), sin(theta).mul(3), spokePhaseUniform.mul(0.15)),
      1.0,
    ).mul(0.10);
    const ecc = cos(theta.add(si * 2.1)).mul(0.04);
    const r = float(baseR).add(kink).add(ecc)
      .add(uv().y.sub(0.5).mul(width * 8)); // v across the strand
    const bent = vec3(r.mul(cos(theta)), 0.0, r.mul(sin(theta)).negate());
    material.positionNode = bent;

    // Clumps along the strand.
    const clump = mx_noise_float(
      vec3(cos(theta).mul(14).add(si * 3.1), sin(theta).mul(14), spokePhaseUniform.mul(0.3)),
      1.0,
    ).mul(0.5).add(0.5);
    // Across-strand gaussian profile — from uv, NOT positionLocal: with a
    // positionNode override, fragment-stage positionLocal reads the bent
    // position (whose y is literally 0), never the original attribute.
    const across = pow(oneMinus(clamp(uv().y.sub(0.5).abs().mul(2), 0, 1)), 2);

    // Forward-scattering phase: bright backlit, dim frontlit.
    const V = normalize(cameraPosition.sub(positionWorld));
    const cosPhase = dot(V, sunDirUniform);
    const fwd = pow(clamp(cosPhase.negate().add(0.15), 0, 1.15), 4).mul(2.2).add(0.05);

    material.colorNode = vec3(0.9, 0.92, 1.0)
      .mul(across).mul(fwd).mul(strand.brightness)
      .mul(mix(float(0.4), float(1.6), clump));
    material.opacityNode = across.mul(0.5).mul(clamp(fwd, 0.08, 1.0));

    // High angular tessellation so the vertex-stage bend stays smooth.
    const geo = new PlaneGeometry(1, 1, 1024, 1);
    const mesh = new Mesh(geo, material);
    mesh.frustumCulled = false; // positionNode reshapes the plane entirely
    return mesh;
  });
}
