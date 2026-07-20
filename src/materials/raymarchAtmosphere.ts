/**
 * Single-scattering raymarched atmosphere (TSL — compiles to WGSL and GLSL).
 *
 * A BackSide shell sphere is marched in OBJECT space (where an oblate body
 * is a unit-ish sphere — the mesh's non-uniform scale maps it to the world
 * ellipsoid). Per sample: exponential density, wavelength-dependent Rayleigh
 * + Henyey-Greenstein Mie scattering, cheap sun transmittance from the local
 * sun zenith angle. Limb darkening, the bright limb arc and the reddened
 * terminator all emerge from the integral.
 *
 * Used for Saturn's limb haze; Titan reuses it with a dense multi-layer
 * profile (phase 4).
 */

import { BackSide, Mesh, SphereGeometry } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, Loop, cameraPosition, clamp, dot, exp, float, max,
  modelWorldMatrixInverse, normalize, positionLocal, pow, select, smoothstep,
  sqrt, vec3, vec4,
} from 'three/tsl';
import { sunDirUniform } from './sharedUniforms.ts';

export interface AtmosphereParams {
  /** Body (surface) radius in the mesh's local units. */
  bodyRadius: number;
  /** Outer shell radius, local units (geometry is built at this radius). */
  shellRadius: number;
  /** Density scale height as a fraction of bodyRadius. */
  scaleHeight: number;
  /** Rayleigh scattering coefficient per RGB channel (relative). */
  rayleigh: [number, number, number];
  /** Mie scattering strength (wavelength-neutral). */
  mie: number;
  /** Mie anisotropy g (0.6–0.9 = strongly forward). */
  mieG: number;
  /** Overall brightness multiplier. */
  intensity: number;
  /** March steps (JS constant — bake per quality preset). */
  steps?: number;
  /** Non-uniform Y squash applied to the mesh (oblate bodies). */
  ySquash?: number;
}

export function createRaymarchedAtmosphere(p: AtmosphereParams): Mesh {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = BackSide;

  const STEPS = p.steps ?? 16;
  const Rp = p.bodyRadius;
  const Ra = p.shellRadius;
  const H = p.scaleHeight * Rp;
  const sigmaR = p.rayleigh;
  const sigmaM = p.mie;
  const g = p.mieG;

  const output = Fn(() => {
    // Object-space ray.
    const ro = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz.toVar();
    const rd = normalize(positionLocal.sub(ro)).toVar();
    const sunL = normalize(modelWorldMatrixInverse.mul(vec4(sunDirUniform, 0)).xyz).toVar();

    // Ray–sphere intersections (atmosphere shell and body).
    const b = dot(ro, rd).toVar();
    const c2 = dot(ro, ro).toVar();
    const discA = b.mul(b).sub(c2.sub(Ra * Ra)).toVar();
    // BackSide shell guarantees a hit; clamp for safety.
    const sq = sqrt(max(discA, 0.0)).toVar();
    const t0 = max(b.negate().sub(sq), 0.0).toVar();
    const t1 = b.negate().add(sq).toVar();
    // Clip against the solid body.
    const discP = b.mul(b).sub(c2.sub(Rp * Rp)).toVar();
    const tP = b.negate().sub(sqrt(max(discP, 0.0))).toVar();
    const hitsBody = discP.greaterThan(0.0).and(tP.greaterThan(0.0));
    const tEnd = select(hitsBody, tP, t1).toVar();

    const dt = tEnd.sub(t0).div(STEPS).toVar();
    const cosTheta = dot(rd, sunL).toVar();
    // Phase functions.
    const phR = float(0.0596831).mul(cosTheta.mul(cosTheta).add(1.0)).toVar();
    const g2 = g * g;
    const phM = float((3 * (1 - g2)) / (8 * Math.PI * (2 + g2)))
      .mul(cosTheta.mul(cosTheta).add(1.0))
      .div(pow(float(1 + g2).sub(cosTheta.mul(2 * g)), 1.5)).toVar();

    const sR = vec3(...sigmaR).toVar();
    const inscatter = vec3(0).toVar();
    const transmittance = vec3(1).toVar();

    Loop({ start: 0, end: STEPS, type: 'int', condition: '<' }, ({ i }) => {
      const t = t0.add(dt.mul(float(i).add(0.5)));
      const pos = ro.add(rd.mul(t));
      const h = pos.length().sub(Rp).div(H);
      const density = exp(clamp(h, 0.0, 60.0).negate()).mul(dt);

      // Cheap sun transmittance: optical depth along the sun ray grows as
      // the sun sinks below the local horizon (smooth Chapman-ish ramp).
      const upSun = dot(normalize(pos), sunL);
      const sunPath = float(1.0).div(max(upSun.mul(0.9).add(0.12), 0.02));
      const sunDepth = exp(clamp(h, 0.0, 60.0).negate()).mul(sunPath).mul(H * 2.0);
      const sunTrans = exp(sR.add(sigmaM).mul(sunDepth).negate());

      inscatter.addAssign(
        sR.mul(phR).add(phM.mul(sigmaM)).mul(density).mul(sunTrans).mul(transmittance),
      );
      transmittance.mulAssign(exp(sR.add(sigmaM).mul(density).negate()));
    });

    const sunColor = vec3(1.0, 0.96, 0.90);
    const colorOut = inscatter.mul(sunColor).mul(p.intensity);
    // Alpha from how much the atmosphere occludes the background.
    const alpha = clamp(vec3(1).sub(transmittance).dot(vec3(0.34, 0.33, 0.33)).mul(1.2), 0.0, 1.0);
    // Fade the hard shell edge (grazing rays with near-zero path).
    const edgeFade = smoothstep(0.0, Ra * 0.004, tEnd.sub(t0));
    return vec4(colorOut, max(alpha, colorOut.dot(vec3(1)).mul(0.25)).mul(edgeFade));
  })();

  material.colorNode = output.rgb;
  material.opacityNode = output.a;

  const geo = new SphereGeometry(p.shellRadius, 96, 48);
  const mesh = new Mesh(geo, material);
  mesh.scale.y = p.ySquash ?? 1;
  return mesh;
}
