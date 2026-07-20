/** Uniforms shared by several materials, updated once per frame from main. */

import { Vector3, Vector4 } from 'three';
import { uniform } from 'three/tsl';

/** Unit vector toward the Sun, scene (Saturn equatorial) frame. */
export const sunDirUniform = uniform(new Vector3(1, 0, 0));

export const MOON_SHADOW_COUNT = 8;

/**
 * Moon positions + radii (xyz = scene units, w = radius) for in-shader
 * shadow transits on Saturn's globe and rings. w = 0 disables a slot.
 */
export const moonShadowUniforms = Array.from(
  { length: MOON_SHADOW_COUNT },
  () => uniform(new Vector4(0, 0, 0, 0)),
);

/** Rotation phase of the B-ring spoke pattern (corotates with the magnetosphere). */
export const spokePhaseUniform = uniform(0);
