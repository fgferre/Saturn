/**
 * In-shader moon shadow transits: for a surface point (on Saturn's globe or
 * on the rings), how much of the Sun's disk is blocked by each moon.
 * The classic Cassini sight of Titan's shadow crossing the globe emerges
 * from this — geometry only, no shadow maps.
 *
 * Penumbra comes from the Sun's angular size: the sun-disk radius grows
 * linearly with distance from the surface point to the occulting moon, and
 * a moon smaller than the local sun disk can only block a fraction of it
 * (annular shading).
 */

import {
  clamp, dot, float, length, max, oneMinus, pow, smoothstep, step,
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { moonShadowUniforms, sunDirUniform } from './sharedUniforms.ts';
import { SUN_ANGULAR_RADIUS } from '../physics/eclipse.ts';

type NodeObj = ShaderNodeObject<Node>;

/** Light fraction (0..1) reaching world position P past all moon disks. */
export function moonTransitLight(P: NodeObj): NodeObj {
  const S = sunDirUniform;
  let light: NodeObj = float(1);

  for (const u of moonShadowUniforms) {
    const M = u.xyz;
    const rM = u.w;
    const toM = M.sub(P);
    const t = dot(toM, S); // distance along the sun ray to the moon's plane
    const perp = length(toM.sub(S.mul(t)));
    // Sun-disk radius projected at the moon's distance.
    const rSun = max(t.mul(SUN_ANGULAR_RADIUS), 1e-4);
    const occ = oneMinus(smoothstep(rM.sub(rSun), rM.add(rSun), perp));
    // A moon smaller than the local sun disk cannot fully darken it.
    const depth = clamp(pow(rM.div(rSun), 2), 0, 1);
    const active = step(0.0, t).mul(step(1e-4, rM));
    light = light.mul(oneMinus(occ.mul(depth).mul(active).mul(0.97)));
  }
  return light;
}
