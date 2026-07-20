/**
 * The E ring: a vast, tenuous torus of micron-sized ice grains fed by
 * Enceladus' plumes. Micron grains are almost purely forward-scattering —
 * the ring is essentially invisible face-on and glows blue-white when
 * backlit, peaking near Enceladus' orbit (a ≈ 238,000 km).
 */

import { AdditiveBlending, DoubleSide, Mesh, RingGeometry } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  cameraPosition, clamp, dot, normalize, positionWorld, pow, uv, vec3,
} from 'three/tsl';
import { eRingVisUniform, sunDirUniform } from '../materials/sharedUniforms.ts';

const INNER = 170;
const OUTER = 330;
const PEAK = 238; // Enceladus' semi-major axis, scene units

export function createERing(): Mesh {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.side = DoubleSide;
  material.depthWrite = false;

  // Radial gaussian density around Enceladus' orbit (uv.x is radial after
  // the same remap the main ring geometry uses — here we bake it directly).
  const r = uv().x.mul(OUTER - INNER).add(INNER);
  const d = r.sub(PEAK).div(38);
  const density = d.mul(d).negate().exp();

  const V = normalize(cameraPosition.sub(positionWorld));
  const cosPhase = dot(V, sunDirUniform);
  // Strong forward-scattering lobe only.
  const fwd = pow(clamp(cosPhase.negate(), 0, 1), 6);

  material.colorNode = vec3(0.55, 0.75, 1.0);
  material.opacityNode = density.mul(fwd).mul(0.06).mul(eRingVisUniform);

  const geo = new RingGeometry(INNER, OUTER, 128, 4);
  // Remap uv.x to the radial coordinate (same convention as the main rings).
  const pos = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const rad = Math.hypot(pos.getX(i), pos.getY(i));
    uvAttr.setXY(i, (rad - INNER) / (OUTER - INNER), 0.5);
  }
  uvAttr.needsUpdate = true;
  geo.rotateX(-Math.PI / 2);

  const mesh = new Mesh(geo, material);
  return mesh;
}
