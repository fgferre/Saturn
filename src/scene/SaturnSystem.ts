/**
 * Builds and updates the Saturn system scene graph from the data tables.
 * The same pattern (BodyDefinition[] -> meshes + Keplerian updates) is what
 * a future Solar System simulator will instantiate once per planet system.
 */

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CylinderGeometry, Group,
  IcosahedronGeometry, Line, LineBasicMaterial, Mesh, Object3D, RingGeometry,
  SphereGeometry, Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { vec3 as tslVec3 } from 'three/tsl';
import { uniform } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import type { BodyDefinition } from '../orbital/types.ts';
import { elementsToPosition, orbitalAngleAt, sampleOrbit } from '../orbital/kepler.ts';
import { KM_PER_UNIT, MOONS, SATURN } from '../data/saturn.ts';
import { createRingProfile, type RingProfile } from '../materials/ringProfile.ts';
import type { BodyMaps } from '../materials/textures.ts';
import { createRingsMaterial } from '../materials/ringsMaterial.ts';
import { createSaturnMaterial } from '../materials/saturnMaterial.ts';
import { createMoonMaterial } from '../materials/moonMaterials.ts';
import { createAtmosphereShell } from '../materials/atmospheres.ts';
import { createRaymarchedAtmosphere } from '../materials/raymarchAtmosphere.ts';
import { createEnceladusPlumes } from '../effects/plumes.ts';
import {
  cloudPhaseUniform, edgeOnUniform, moonShadowUniforms, spokePhaseUniform,
} from '../materials/sharedUniforms.ts';
import { createFRing } from '../materials/fRing.ts';
import { createRingSlab } from '../effects/ringSlab.ts';
import { saturnShadowOnMoon } from '../physics/eclipse.ts';
import { Ringshine } from '../physics/ringshine.ts';
import { fbm3D } from '../utils/noise.ts';

export interface SystemBody {
  def: BodyDefinition;
  /** Anchor object whose world position is the body center. */
  anchor: Object3D;
  mesh: Mesh;
  orbitLine?: Line;
  /** Sunlight fraction reaching this moon (eclipse/ring-shadow), CPU-updated. */
  eclipseLight?: UniformNode<number>;
}

const toUnits = (km: number) => km / KM_PER_UNIT;

function ringGeometry(profile: RingProfile): RingGeometry {
  const geo = new RingGeometry(toUnits(profile.innerKm), toUnits(profile.outerKm), 512, 8);
  // Remap UVs: u = radial 0..1 across the profile (RingGeometry's default UVs are planar).
  const pos = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  const inner = toUnits(profile.innerKm);
  const outer = toUnits(profile.outerKm);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uvAttr.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
  uvAttr.needsUpdate = true;
  geo.rotateX(-Math.PI / 2); // into the XZ (equatorial) plane
  return geo;
}

function hyperionGeometry(): IcosahedronGeometry {
  const geo = new IcosahedronGeometry(1, 5);
  const pos = geo.attributes.position;
  const v = new Vector3();
  const dent = new Vector3(0.7, 0.2, 0.68).normalize();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1 + (fbm3D(v.x * 1.8 + 9, v.y * 1.8, v.z * 1.8, 4, 7) - 0.5) * 0.55;
    // One giant impact depression (Hyperion's cup-like face).
    const d = v.dot(dent);
    if (d > 0.55) r -= (d - 0.55) * 0.55;
    pos.setXYZ(i, v.x * r, v.y * r * 0.78, v.z * r * 1.15); // irregular axes
  }
  geo.computeVertexNormals();
  return geo;
}

function orbitLine(def: BodyDefinition): Line {
  const pts = sampleOrbit(def.elements!, 360);
  const arr = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => arr.set([toUnits(p.x), toUnits(p.y), toUnits(p.z)], i * 3));
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(arr, 3));
  const mat = new LineBasicMaterial({
    color: 0x88aacc,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const line = new Line(geo, mat);
  line.renderOrder = -1; // always behind the other transparents (rings, shells)
  return line;
}

export class SaturnSystem {
  readonly group = new Group();
  readonly bodies = new Map<string, SystemBody>();
  readonly ringProfile: RingProfile;
  private readonly ringshine: Ringshine;
  private readonly orbitLines: Line[] = [];
  private readonly moonGeometry = new SphereGeometry(1, 96, 48);

  constructor(maps?: BodyMaps) {
    this.ringProfile = createRingProfile(maps?.ringProfile);
    this.ringshine = new Ringshine(maps?.ringProfile ?? null, maps?.ringScatter ?? null);

    // --- Saturn ---
    const saturnMesh = new Mesh(
      new SphereGeometry(toUnits(SATURN.physical.radiusKm), 128, 64),
      createSaturnMaterial(this.ringProfile, maps?.saturn, this.ringshine.texture),
    );
    const squash = (SATURN.physical.polarRadiusKm ?? SATURN.physical.radiusKm) / SATURN.physical.radiusKm;
    saturnMesh.scale.y = squash;
    const saturnAnchor = new Object3D();
    saturnAnchor.add(saturnMesh);
    this.group.add(saturnAnchor);
    this.bodies.set(SATURN.id, { def: SATURN, anchor: saturnAnchor, mesh: saturnMesh });

    // Raymarched limb/terminator atmosphere (replaces the fresnel shell).
    const requ = toUnits(SATURN.physical.radiusKm);
    saturnAnchor.add(createRaymarchedAtmosphere({
      bodyRadius: requ,
      shellRadius: requ * 1.025,
      scaleHeight: 0.006,
      // Saturn's visible haze is warm amber (ammonia aerosols), only a
      // faint blue Rayleigh component.
      rayleigh: [0.30, 0.26, 0.28],
      mie: 1.5,
      mieG: 0.72,
      intensity: 3.5,
      steps: 16,
      ySquash: squash,
    }));

    // --- Rings ---
    // No fixed renderOrder on the transparent set (rings/shells/plumes):
    // the renderer's back-to-front sort handles moons in front of vs behind
    // the rings correctly per frame.
    const rings = new Mesh(
      ringGeometry(this.ringProfile),
      createRingsMaterial(this.ringProfile, maps?.ringScatter),
    );
    saturnAnchor.add(rings);

    // F ring: kinked clumpy strands, strongly forward-scattering.
    for (const strand of createFRing()) saturnAnchor.add(strand);

    // Volumetric fly-through slab (fades in near the ring plane).
    saturnAnchor.add(createRingSlab(this.ringProfile.texture));

    // Edge-on rim: from grazing angles the infinitely thin plane vanishes;
    // this faint ribbon at the A-ring outer edge keeps a bright line alive.
    {
      const rimMat = new MeshBasicNodeMaterial();
      rimMat.transparent = true;
      rimMat.blending = AdditiveBlending;
      rimMat.depthWrite = false;
      rimMat.side = 2; // DoubleSide
      rimMat.colorNode = tslVec3(0.85, 0.80, 0.68);
      rimMat.opacityNode = edgeOnUniform;
      const rim = new Mesh(
        new CylinderGeometry(toUnits(136780), toUnits(136780), 0.05, 256, 1, true),
        rimMat,
      );
      saturnAnchor.add(rim);
    }

    // --- Moons ---
    for (const def of MOONS) {
      const radius = toUnits(def.physical.radiusKm);
      const eclipseLight = uniform(1);
      const mesh = def.id === 'hyperion'
        ? new Mesh(hyperionGeometry(), createMoonMaterial(def.id, null, eclipseLight))
        : new Mesh(
            this.moonGeometry,
            createMoonMaterial(def.id, maps?.moons.get(def.id), eclipseLight),
          );
      mesh.scale.setScalar(radius);

      const anchor = new Object3D();
      anchor.add(mesh);
      this.group.add(anchor);
      this.bodies.set(def.id, { def, anchor, mesh, eclipseLight });

      const line = orbitLine(def);
      line.visible = false; // cinematic default; HUD toggle re-enables
      this.orbitLines.push(line);
      this.group.add(line);

      if (def.id === 'titan') {
        // Main orange haze hugging the limb + detached blue upper haze layer.
        mesh.add(createAtmosphereShell(1, {
          color: [1.0, 0.62, 0.26], scale: 1.045, rimPower: 2.2, intensity: 1.3, forwardScatter: 2.0,
        }));
        mesh.add(createAtmosphereShell(1, {
          color: [0.45, 0.62, 1.0], scale: 1.10, rimPower: 5.0, intensity: 0.4, forwardScatter: 1.0,
        }));
      }
      if (def.id === 'enceladus') {
        mesh.add(createEnceladusPlumes());
      }
    }
  }

  setOrbitsVisible(visible: boolean): void {
    for (const l of this.orbitLines) l.visible = visible;
  }

  /** Position of a body's center in system-local (== world) units. */
  getBodyPosition(id: string, out = new Vector3()): Vector3 {
    const body = this.bodies.get(id);
    if (!body) return out.set(0, 0, 0);
    return body.anchor.getWorldPosition(out);
  }

  update(jd: number, sunDir?: Vector3): void {
    // Saturn's rotation (System III).
    const saturn = this.bodies.get(SATURN.id)!;
    const rotH = SATURN.physical.rotationPeriodH ?? 10.561;
    saturn.mesh.rotation.y = ((jd * 24) / rotH) * Math.PI * 2 % (Math.PI * 2);

    // B-ring spokes corotate with the magnetosphere (~System III rate).
    spokePhaseUniform.value = -(((jd * 24) / 10.66) * Math.PI * 2) % (Math.PI * 2);

    // Cloud advection: equatorial jet laps the planet in ~9.75 days.
    // Wrapped every 10 laps to keep f32 precision (rare, brief reset).
    cloudPhaseUniform.value = (jd % 97.5) / 9.75;

    if (sunDir) this.ringshine.update(sunDir);

    let slot = 0;
    for (const def of MOONS) {
      const body = this.bodies.get(def.id)!;
      const p = elementsToPosition(def.elements!, jd);
      body.anchor.position.set(toUnits(p.x), toUnits(p.y), toUnits(p.z));

      if (def.physical.tidallyLocked) {
        // Same face toward Saturn: co-rotate with the orbital angle.
        // The +π offset makes local +Z the leading hemisphere (matches the
        // Iapetus/Dione feature conventions in moonMaterials).
        body.mesh.rotation.y = orbitalAngleAt(def.elements!, jd) + Math.PI;
      } else if (def.id === 'hyperion') {
        // Chaotic tumble (visual approximation of a genuinely chaotic spin).
        body.mesh.rotation.set(
          Math.sin(jd * 1.7) * 2.1 + jd * 0.9,
          jd * 1.31,
          Math.cos(jd * 0.83) * 1.7,
        );
      }

      if (sunDir) {
        // Feed the shader transit slots (moon shadows on globe/rings)...
        const u = moonShadowUniforms[slot++];
        if (u) {
          u.value.set(
            body.anchor.position.x, body.anchor.position.y, body.anchor.position.z,
            toUnits(def.physical.radiusKm),
          );
        }
        // ...and darken the moon when it enters Saturn's umbra / ring shadow.
        if (body.eclipseLight) {
          body.eclipseLight.value = saturnShadowOnMoon(
            body.anchor.position, sunDir, this.ringProfile.opacityAt,
          );
        }
      }
    }
  }
}
