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

/** Cloud-advection phase for Saturn's zonal jets (sim-time driven, wraps). */
export const cloudPhaseUniform = uniform(0);

/** 0..1 — how much of the solar disk the camera can see (drives lens flare). */
export const sunVisibilityUniform = uniform(1);

/** 0..1 — how edge-on the camera is to the ring plane (drives the rim ribbon). */
export const edgeOnUniform = uniform(0);

/** 0..1 — proximity of the camera to the ring plane (drives the particle slab). */
export const slabVisUniform = uniform(0);

/** 0..1 — E-ring visibility (fades out when the camera is inside the torus). */
export const eRingVisUniform = uniform(1);

/**
 * 0.25..1 — Enceladus' plume activity over its diurnal tidal cycle. Peaks near
 * apoapsis when the tiger stripes are pulled open; multiplies the plume opacity.
 */
export const plumeActivityUniform = uniform(1);
