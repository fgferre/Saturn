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
import {
  elementsToPosition, meanAnomalyAt, orbitalAngleAt, sampleOrbit,
} from '../orbital/kepler.ts';
import { KM_PER_UNIT, MOONS, SATURN } from '../data/saturn.ts';
import { createRingProfile, type RingProfile } from '../materials/ringProfile.ts';
import type { BodyMaps } from '../materials/textures.ts';
import { createRingsMaterial } from '../materials/ringsMaterial.ts';
import { createSaturnMaterial } from '../materials/saturnMaterial.ts';
import { createMoonMaterial } from '../materials/moonMaterials.ts';
import { createRaymarchedAtmosphere } from '../materials/raymarchAtmosphere.ts';
import { createEnceladusPlumes, type PlumeSystem } from '../effects/plumes.ts';
import { createERing } from '../effects/eRing.ts';
import {
  cloudPhaseUniform, edgeOnUniform, moonShadowUniforms, plumeActivityUniform,
  seasonalTiltUniform, spokePhaseUniform,
} from '../materials/sharedUniforms.ts';
import { seasonalTilt } from '../data/season.ts';
import { createFRing } from '../materials/fRing.ts';
import { createRingSlab } from '../effects/ringSlab.ts';
import { saturnShadowOnMoon, solarAtmosphereTint } from '../physics/eclipse.ts';
import { Ringshine } from '../physics/ringshine.ts';
import { quality } from '../core/quality.ts';
import { fbm3D } from '../utils/noise.ts';

export interface SystemBody {
  def: BodyDefinition;
  /** Anchor object whose world position is the body center. */
  anchor: Object3D;
  mesh: Mesh;
  orbitLine?: Line;
  /** Sunlight fraction reaching this moon (eclipse/ring-shadow), CPU-updated. */
  eclipseLight?: UniformNode<number>;
  /**
   * RGB direct-light mask for this moon: eclipseLight (scalar) × the Rayleigh
   * transmittance of the penumbral ray through Saturn's high atmosphere, so a
   * moon sliding into the umbra reddens (copper) instead of greying to neutral.
   * Fed to the material's directLightMask; the scalar `eclipseLight` above is
   * kept separate for the HUD "Sunlight %" read.
   */
  eclipseTint?: UniformNode<Vector3>;
  /** Mesh radius in scene units — used by the geometry LOD (screen-size proxy). */
  lodRadius?: number;
  /** DTM relief active: pins the fine geometry while the moon is on screen. */
  lodRelief?: boolean;
  /** Current LOD sphere index: 2 fine, 1 mid, 0 coarse. */
  lodTier?: number;
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
  readonly plumeSystems: PlumeSystem[] = [];
  /** Fly-through ring slab; `.visible` toggled per frame by slab proximity. */
  readonly slabMesh: Mesh;
  /** E-ring torus; `.visible` toggled per frame by E-ring proximity. */
  readonly eRingMesh: Mesh;
  private readonly ringshine: Ringshine;
  private readonly orbitLines: Line[] = [];
  // Three shared unit spheres, coarse → fine. The fine tier is the preset's
  // full tessellation (== the old single geometry, so close-ups are unchanged);
  // real DTM displacement needs those vertices for the limb silhouette. Mid/low
  // are clamped so they never exceed the preset (Low is only 96×48).
  private readonly moonGeomHigh = new SphereGeometry(1, ...quality.moonSegments);
  private readonly moonGeomMid = new SphereGeometry(
    1, Math.min(128, quality.moonSegments[0]), Math.min(64, quality.moonSegments[1]),
  );
  private readonly moonGeomLow = new SphereGeometry(
    1, Math.min(64, quality.moonSegments[0]), Math.min(32, quality.moonSegments[1]),
  );
  /** Moons that swap between the three shared spheres (excludes Hyperion). */
  private readonly lodBodies: SystemBody[] = [];
  /** Throttle: LOD is re-evaluated every ~0.5 s (wall-clock), not per frame. */
  private lodClock = 0;
  private readonly lodScratch = new Vector3();

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
      mie: [1.5, 1.5, 1.5],
      mieG: 0.72,
      intensity: 3.5,
      steps: quality.raymarchSteps,
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

    // E ring: tenuous forward-scattering torus fed by Enceladus.
    this.eRingMesh = createERing();
    saturnAnchor.add(this.eRingMesh);

    // Volumetric fly-through slab (fades in near the ring plane).
    this.slabMesh = createRingSlab(this.ringProfile.texture, quality.slabCount);
    saturnAnchor.add(this.slabMesh);

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
      // Direct-light mask fed to the material: scalar eclipse × atmosphere tint
      // (reddened penumbral light). Starts at full white (no eclipse).
      const eclipseTint = uniform(new Vector3(1, 1, 1));
      const relief = maps?.relief.get(def.id);
      const mesh = def.id === 'hyperion'
        ? new Mesh(hyperionGeometry(), createMoonMaterial(def.id, null, eclipseTint))
        // Start on the fine sphere: first frame (before updateLOD runs) is the
        // full-detail geometry, so nothing regresses on load.
        : new Mesh(
            this.moonGeomHigh,
            createMoonMaterial(
              def.id, maps?.moons.get(def.id), eclipseTint, relief,
            ),
          );
      mesh.scale.setScalar(radius);

      const anchor = new Object3D();
      anchor.add(mesh);
      this.group.add(anchor);
      const body: SystemBody = { def, anchor, mesh, eclipseLight, eclipseTint };
      // Hyperion keeps its own irregular geometry — never LOD-swapped.
      if (def.id !== 'hyperion') {
        body.lodRadius = radius;
        body.lodRelief = relief != null;
        body.lodTier = 2; // fine, matching the geometry assigned above
        this.lodBodies.push(body);
      }
      this.bodies.set(def.id, body);

      const line = orbitLine(def);
      line.visible = false; // cinematic default; HUD toggle re-enables
      this.orbitLines.push(line);
      this.group.add(line);

      if (def.id === 'titan') {
        // Raymarched haze: dense chromatic Mie (orange limb, reddened
        // backlight) + a thin blue Rayleigh upper layer — the colors emerge
        // from the scattering integral instead of painted shells.
        mesh.add(createRaymarchedAtmosphere({
          bodyRadius: 1,
          shellRadius: 1.28,
          scaleHeight: 0.075,
          rayleigh: [0.05, 0.09, 0.24],
          mie: [5.5, 3.0, 0.85],
          mieG: 0.70,
          intensity: 2.2,
          steps: quality.raymarchSteps,
        }));
      }
      if (def.id === 'enceladus') {
        const plumes = createEnceladusPlumes(quality.plumeCount, eclipseLight);
        mesh.add(plumes.mesh);
        this.plumeSystems.push(plumes);
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

  /**
   * Swap each moon between the three shared spheres by apparent size, so a
   * whole-system view isn't paying for 256×128 spheres on sub-pixel moons.
   * Metric is d/r (camera distance over mesh radius) — scale-free and, for a
   * fixed vertical FOV, inversely proportional to the moon's pixel height.
   *
   * Thresholds carry a ±10% hysteresis band so a moon hovering on a boundary
   * doesn't swap geometry every evaluation. Throttled to ~2 Hz; call it every
   * frame from the main loop with the final camera position.
   *
   * ARMADILHA: a moon with DTM relief must stay on the fine sphere while its
   * displaced limb is visible (coarse spheres have too few vertices and the
   * terrain collapses to a smooth ball), so relief moons use far larger high /
   * mid boundaries — effectively fine until they shrink toward a few pixels.
   */
  updateLOD(cameraPos: Vector3): void {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this.lodClock < 500) return;
    this.lodClock = now;

    const H = 0.1; // hysteresis fraction on each boundary
    for (const body of this.lodBodies) {
      const radius = body.lodRadius ?? 1;
      const dist = body.anchor.getWorldPosition(this.lodScratch).distanceTo(cameraPos);
      const ratio = dist / radius; // small = large on screen
      // Boundaries between fine|mid and mid|coarse. Relief moons hold fine far
      // longer so displacement never collapses while it's readable.
      const b1 = body.lodRelief ? 600 : 90;
      const b2 = body.lodRelief ? 1600 : 500;
      const cur = body.lodTier ?? 2;
      let next = cur;
      // Apply hysteresis: to gain detail cross the tighter (×(1−H)) edge; to
      // shed detail cross the looser (×(1+H)) edge.
      if (cur === 2) {
        if (ratio > b1 * (1 + H)) next = ratio > b2 * (1 + H) ? 0 : 1;
      } else if (cur === 1) {
        if (ratio < b1 * (1 - H)) next = 2;
        else if (ratio > b2 * (1 + H)) next = 0;
      } else {
        if (ratio < b1 * (1 - H)) next = 2;
        else if (ratio < b2 * (1 - H)) next = 1;
      }
      if (next === cur) continue;
      body.lodTier = next;
      body.mesh.geometry = next === 2 ? this.moonGeomHigh
        : next === 1 ? this.moonGeomMid : this.moonGeomLow;
    }
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

    // Seasonal hemispheric hue: pure lagged forcing (no in-loop filter, so it
    // stays correct under time-scrub / reverse). +value blues the north.
    seasonalTiltUniform.value = seasonalTilt(jd);

    // Enceladus' plume brightness swings ~4× over its diurnal tidal cycle,
    // peaking near apoapsis (M=π) as the tiger stripes are pulled open. By
    // the mean anomaly (r/a is degenerate at e=0.0047): 0.25 at periapsis,
    // 1.0 at apoapsis — an exact 4:1 ratio. Peak lags apoapsis by hours
    // (Hedman et al. 2013 / Nimmo et al. 2014 — ⚠ VERIFICAR: lag magnitude).
    const enceladus = MOONS.find((m) => m.id === 'enceladus');
    if (enceladus?.elements) {
      const meanAnomaly = meanAnomalyAt(enceladus.elements, jd);
      plumeActivityUniform.value = 0.625 - 0.375 * Math.cos(meanAnomaly);
    }

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
          const scalar = saturnShadowOnMoon(
            body.anchor.position, sunDir, this.ringProfile.opacityAt,
          );
          body.eclipseLight.value = scalar; // scalar kept for the HUD Sunlight %
          // Penumbral light has grazed Saturn's high atmosphere and arrives
          // reddened. Tint the direct-light mask so the moon goes copper in the
          // umbra, never neutral grey. solarAtmosphereTint writes into the
          // uniform's Vector3 in place (no per-frame allocation).
          if (body.eclipseTint) {
            solarAtmosphereTint(body.anchor.position, sunDir, body.eclipseTint.value)
              .multiplyScalar(scalar);
          }
        }
      }
    }
  }
}
