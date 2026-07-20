/**
 * Fake-scattering atmosphere shells: slightly inflated back-side spheres
 * with a fresnel limb glow modulated by sun direction. Cheap, robust and
 * very effective for planet-scale views. Used for Saturn's limb, Titan's
 * orange haze and Titan's detached blue high-haze layer.
 */

import { AdditiveBlending, BackSide, Mesh, SphereGeometry } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs, cameraPosition, clamp, dot, normalize, normalWorld, oneMinus,
  positionWorld, pow, vec3,
} from 'three/tsl';
import { sunDirUniform } from './sharedUniforms.ts';

export interface AtmosphereOptions {
  color: [number, number, number];
  /** Shell radius as a multiple of the body radius. */
  scale: number;
  /** Higher = thinner rim. */
  rimPower: number;
  intensity: number;
  /** Extra glow when the body is backlit (forward scattering). */
  forwardScatter?: number;
}

export function createAtmosphereShell(bodyRadiusUnits: number, opts: AtmosphereOptions, ySquash = 1): Mesh {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.side = BackSide;
  material.depthWrite = false;

  const n = normalize(normalWorld);
  const V = normalize(cameraPosition.sub(positionWorld));
  const S = sunDirUniform;

  const mu = abs(dot(n, V));
  const rim = pow(oneMinus(mu), opts.rimPower);
  // Illuminated-side weighting so the glow dies on the night limb.
  const day = clamp(dot(n, S).mul(0.5).add(0.55), 0.03, 1.0);

  let glow = vec3(...opts.color).mul(rim.mul(opts.intensity).mul(day));
  if (opts.forwardScatter) {
    const fwd = pow(clamp(dot(V.negate(), S), 0, 1), 5).mul(opts.forwardScatter);
    glow = glow.add(vec3(...opts.color).mul(rim.mul(fwd))) as typeof glow;
  }
  material.colorNode = glow;

  const geo = new SphereGeometry(bodyRadiusUnits * opts.scale, 96, 48);
  const mesh = new Mesh(geo, material);
  mesh.scale.y = ySquash;
  return mesh;
}
