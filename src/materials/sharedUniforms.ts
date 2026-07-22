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

/**
 * Daphnis' ring-frame azimuth (radians) — the angle atan(P.z, P.x) of the moon's
 * scene position, so the Keeler-gap edge waves (F11.2) stay locked to the moon
 * and travel with it. Updated once per frame in SaturnSystem.update from
 * orbitalAngleAt(Daphnis). Note the scene convention makes the ring azimuth the
 * NEGATIVE of the orbital angle (prograde = decreasing atan(z,x)).
 */
export const daphnisLonUniform = uniform(0);

/**
 * Prometheus' ring-frame azimuth (radians) — same convention as daphnisLonUniform
 * (the NEGATIVE of the orbital angle, matching the Y-up scene azimuth atan(z,x)).
 * Drives the F-ring "streamer-channels" (F11.2b): Prometheus is interior to the
 * F ring (faster), so the channels it draws out trail BEHIND it in longitude
 * (Murray et al. 2008). Updated once per frame in SaturnSystem.update.
 */
export const prometheusLonUniform = uniform(0);

/** Fine component of Saturn's cloud phase; see cloudPhaseCoarseUniform. */
export const cloudPhaseUniform = uniform(0);

/**
 * Coarse radix-64 component of Saturn's continuous cloud phase. Keeping the
 * components separate avoids both epoch-reset pops and large-f32 UV jitter.
 */
export const cloudPhaseCoarseUniform = uniform(0);

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

/**
 * Signed seasonal forcing (F9.3): +value ⇒ northern hemisphere in winter
 * (blues), −value ⇒ southern. Magnitude ≈ lagged sub-solar latitude sine
 * (±0.45). Drives a subtle hemispheric blue albedo grade on Saturn's globe.
 */
export const seasonalTiltUniform = uniform(0);
