/**
 * The Sun: a single DirectionalLight plus camera-centered billboards.
 *
 * F7 — physical display disk + seed-carried glare (no BloomNode square mips):
 * - Display disk (DISPLAY_SUN_LAYER): small, sharp, limb-darkened photosphere.
 * - Seed (SOLAR_LAYER): round glare profile painted radially (core + r⁻² skirt)
 *   and composited directly in the post graph — never through a wide BloomNode.
 * - solarTintUniform = atmosphere transmittance only (no visibility bake-in).
 * - Disk and glare both multiply tint × visibility in the graph (lockstep).
 */

import {
  AdditiveBlending, DirectionalLight, Group, Mesh, PlaneGeometry, Vector3,
} from 'three';
import { SpriteNodeMaterial } from 'three/webgpu';
import {
  add, clamp, float, fwidth, max, oneMinus, smoothstep, sqrt, uniform, uv, vec3,
} from 'three/tsl';
import { SUN_ANGULAR_RADIUS } from '../physics/eclipse.ts';
import { sunVisibilityUniform } from '../materials/sharedUniforms.ts';

/** Layer for the solar glare seed (post chain only). */
export const SOLAR_LAYER = 1;

/**
 * Layer for the visible sun disk. Base camera enables 0 + this layer so the
 * disk shares depth with occluders; bloom camera stays on layer 0 only.
 */
export const DISPLAY_SUN_LAYER = 2;

/**
 * Distance from the camera to the billboards (scene units). Large enough that
 * the disk sits beyond the solar system and never collides with moons.
 */
export const SUN_FOLLOW_DISTANCE = 40000;

/**
 * Presentation scale over the true angular radius. 1 = physical (~0.057° dia);
 * 3.5 ≈ readable still-small disk without returning to the old 1° blur blob.
 */
export const SUN_APPARENT_SCALE = 3.5;

/** Quad half-extent / disk radius — only a thin AA margin outside the disk. */
const DISK_PAD = 2.5;

/** Physical disk radius in scene units at the follow distance. */
export const SUN_DISK_RADIUS =
  SUN_ANGULAR_RADIUS * SUN_FOLLOW_DISTANCE * SUN_APPARENT_SCALE;

/** Full PlaneGeometry scale for the photosphere billboard. */
export const SUN_DISK_SCALE = SUN_DISK_RADIUS * 2 * DISK_PAD;

/**
 * Seed billboard is larger so the r⁻² glare skirt has room in UV space.
 * Still a radial sprite → round at any FOV (no BloomNode mips).
 */
export const SUN_SEED_SCALE = SUN_DISK_SCALE * 7;

/**
 * Display-path core radiance (linear, before AgX @ exposure 1.4).
 * Calibrated to saturate the disk centre under clear sky; limb extinction
 * must pull this down into the AgX shoulder for orange sunsets.
 */
export const SUN_DISPLAY_RADIANCE = 90;

/** Seed core / skirt linear peaks (glare energy for direct composite). */
export const SUN_SEED_CORE_RADIANCE = 28;
export const SUN_SEED_SKIRT_RADIANCE = 3.5;

/** UV radius of the physical disk within the padded quad (0.5 / DISK_PAD). */
export const SUN_DISK_UV_RADIUS = 0.5 / DISK_PAD;

/**
 * Atmosphere transmittance only (RGB). Visibility is applied separately so
 * disk and glare share one routing: × tint × sunVisibility.
 */
export const solarTintUniform = uniform(new Vector3(1, 1, 1));

/** DirectionalLight intensity at Saturn's mean heliocentric distance. */
export const SUN_LIGHT_INTENSITY = 3.4;

/**
 * Heliocentric irradiance factor (mean/r)², 1 at the mean distance and updated
 * per frame from main. Multiplies the disk's display radiance ONLY — kept
 * separate from SUN_DISPLAY_RADIANCE (the wave4 AgX anchors assert 90 at the
 * mean distance, so the constant must stay 90 and this must default to 1).
 */
export const solarIrradianceUniform = uniform(1);

export class Sun {
  readonly group = new Group();
  readonly light: DirectionalLight;
  /** Visible sun (DISPLAY_SUN_LAYER — depth-tested in the base pass). */
  readonly disk: Mesh;
  /** Round glare carrier for the solar-only post pass (SOLAR_LAYER). */
  readonly seed: Mesh;

  constructor() {
    // Sole direct light for the whole system (warm ~5800 K-ish). Intensity is
    // the mean-distance value; update() scales it by (mean/r)² each frame.
    this.light = new DirectionalLight(0xfff1e0, SUN_LIGHT_INTENSITY);
    this.group.add(this.light);
    this.group.add(this.light.target);
    // F7.3: no AmbientLight — night is ringshine / saturnshine only.

    // --- Display disk: sharp limb-darkened photosphere ---
    {
      const material = new SpriteNodeMaterial();
      material.transparent = true;
      material.blending = AdditiveBlending;
      material.depthWrite = false;
      material.depthTest = true;

      const r = uv().sub(0.5).length();
      const R = float(SUN_DISK_UV_RADIUS);
      const fw = max(fwidth(r), float(1e-4));
      const diskMask = oneMinus(smoothstep(R.sub(fw), R.add(fw), r));

      const rho = clamp(r.div(R), 0, 1);
      const mu = sqrt(max(float(0), oneMinus(rho.mul(rho))));
      const limb = vec3(
        oneMinus(float(0.72).mul(oneMinus(mu))),
        oneMinus(float(0.58).mul(oneMinus(mu))),
        oneMinus(float(0.42).mul(oneMinus(mu))),
      );

      // Photosphere × limb × HDR × atmosphere × visibility (same gate as glare).
      const photosphere = vec3(1.0, 0.96, 0.90);
      material.colorNode = photosphere
        .mul(limb)
        .mul(SUN_DISPLAY_RADIANCE)
        .mul(solarIrradianceUniform)
        .mul(solarTintUniform)
        .mul(sunVisibilityUniform);
      material.opacityNode = diskMask;

      this.disk = new Mesh(new PlaneGeometry(1, 1), material);
      this.disk.scale.setScalar(SUN_DISK_SCALE);
      this.disk.frustumCulled = false;
      // After atmosphere shells so normal-blend haze cannot cut a black hole.
      this.disk.renderOrder = 1000;
      this.disk.layers.set(DISPLAY_SUN_LAYER);
      this.group.add(this.disk);
    }

    // --- Glare seed: round by construction (core + Lorentzian skirt) ---
    {
      const material = new SpriteNodeMaterial();
      material.transparent = true;
      material.blending = AdditiveBlending;
      material.depthWrite = false;
      material.depthTest = false;

      const r = uv().sub(0.5).length();
      // Tight core (the star point).
      const core = oneMinus(smoothstep(float(0.0), float(0.055), r));
      const core2 = core.mul(core);
      // Wide warm skirt ~ 1/(1+(kr)²), windowed to exact 0 at the quad edge
      // so FOV-close never shows a faint square frame (Lorentz ~1% at r=0.5).
      const kr = r.mul(20);
      const lorentz = float(1).div(add(float(1), kr.mul(kr)));
      const edgeVal = float(1 / (1 + 10 * 10)); // Lorentz at r=0.5
      const skirt = max(float(0), lorentz.sub(edgeVal)).div(float(1).sub(edgeVal));
      const warm = vec3(1.0, 0.94, 0.82);
      const energy = core2.mul(SUN_SEED_CORE_RADIANCE).add(skirt.mul(SUN_SEED_SKIRT_RADIANCE));
      // Encode the radiance profile once through additive alpha. Engine still
      // multiplies tint × visibility exactly once for glow/flare.
      const peakEnergy = SUN_SEED_CORE_RADIANCE + SUN_SEED_SKIRT_RADIANCE;
      material.colorNode = warm.mul(peakEnergy);
      material.opacityNode = clamp(energy.div(peakEnergy), 0, 1);

      this.seed = new Mesh(new PlaneGeometry(1, 1), material);
      this.seed.scale.setScalar(SUN_SEED_SCALE);
      this.seed.frustumCulled = false;
      this.seed.renderOrder = -1;
      this.seed.layers.set(SOLAR_LAYER);
      this.group.add(this.seed);
    }
  }

  /**
   * Apply the heliocentric distance scaling for the frame. `distanceScale =
   * mean/r`: irradiance (light + disk radiance) scales by its square, the disk's
   * apparent diameter linearly — so the Sun is brighter and larger at perihelion.
   * The seed's glare footprint stays fixed (it represents a point source).
   */
  setDistanceScale(distanceScale: number): void {
    const irradiance = distanceScale * distanceScale;
    this.light.intensity = SUN_LIGHT_INTENSITY * irradiance;
    solarIrradianceUniform.value = irradiance;
    this.disk.scale.setScalar(SUN_DISK_SCALE * distanceScale);
  }

  /**
   * Align light (infinite) and both billboards (camera-centered along sunDir).
   * Call **after** the frame's final camera pose is known.
   */
  update(sunDir: Vector3, cameraPos: Vector3): void {
    this.light.position.copy(sunDir).multiplyScalar(1000);
    this.light.target.position.set(0, 0, 0);
    this.light.target.updateMatrixWorld();

    const pos = cameraPos.clone().addScaledVector(sunDir, SUN_FOLLOW_DISTANCE);
    this.disk.position.copy(pos);
    this.seed.position.copy(pos);
  }
}
