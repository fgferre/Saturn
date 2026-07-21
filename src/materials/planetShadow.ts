/**
 * Saturn's shadow (analytic oblate-ellipsoid umbra + penumbra) for a
 * world-space point: how much sunlight reaches it past the planet's body.
 * Returns 0 (deep umbra) .. 1 (full sunlight); the penumbra half-width grows
 * with distance behind the globe at the Sun's angular radius (sharp near the
 * body, soft out at the ring edge).
 *
 * Shared by the main rings, the F ring and the E ring so every transparent
 * that crosses the shadow darkens with the same geometry the moons use
 * (CPU-side saturnShadowOnMoon in physics/eclipse.ts).
 */

import { add, clamp, dot, length, max, normalize, vec3 } from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { sunDirUniform } from './sharedUniforms.ts';
import { SUN_ANGULAR_RADIUS } from '../physics/eclipse.ts';
import { KM_PER_UNIT, SATURN } from '../data/saturn.ts';

type NodeObj = ShaderNodeObject<Node>;

const REQ = SATURN.physical.radiusKm / KM_PER_UNIT;
const Y_SCALE = SATURN.physical.radiusKm / (SATURN.physical.polarRadiusKm ?? SATURN.physical.radiusKm);

/** Sunlight fraction (0..1) reaching world position `P`, past Saturn's oblate umbra. */
export function planetShadow(P: NodeObj): NodeObj {
  const S = sunDirUniform;
  // Work in the sphere-ized space of Saturn's oblate ellipsoid.
  const q = vec3(P.x, P.y.mul(Y_SCALE), P.z);
  const sScaled = normalize(vec3(S.x, S.y.mul(Y_SCALE), S.z));
  const tStar = dot(q, sScaled).negate();
  const dMin = length(add(q, sScaled.mul(max(tStar, 0))));
  const pen = max(tStar, 0).mul(SUN_ANGULAR_RADIUS).add(0.01);
  const s = clamp(dMin.sub(REQ).div(pen).add(0.5), 0, 1);
  // Smoothstep shaping (identical to the original inline main-ring result).
  return s.mul(s.mul(-2).add(3)).mul(s);
}
