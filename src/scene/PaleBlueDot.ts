/**
 * F12.1b — the "Pale Blue Dot": the Earth rendered as a single point in
 * Saturn's sky, recreating the geometry of Cassini's PIA17172 ("The Day the
 * Earth Smiled", 2013-07-19).
 *
 * Design notes:
 * - ONE camera-centered sprite (SpriteNodeMaterial — never Points; WebGPU
 *   rasterizes Points at 1 px, gotcha §6), placed at ~SKY_RADIUS along the
 *   Earth direction. Sitting out at the sky with depthTest on, Saturn's globe
 *   occludes it for free (the same reason the starfield hides behind the
 *   planet); the disk is drawn beyond the Sun's follow distance.
 * - FRAMING CAVEAT: the Earth's max elongation from the Sun seen from Saturn is
 *   ~6°, so it is ALWAYS close to the Sun in the sky. The only framing where it
 *   reads is with the Sun eclipsed by Saturn (camera in the planet's shadow) —
 *   exactly the PIA17172 geometry. The brightness is therefore boosted as the
 *   solar visibility drops so the dot only asserts itself in that dark-sky view.
 * - BRIGHTNESS IS ARTISTIC LICENSE (documented): the real Earth from Saturn is
 *   ~mag +6 — invisible to the eye. We render a fixed pale-blue glow (base +
 *   eclipse boost) so the dot is findable. It is NOT a focusable body; it wears
 *   its own subtle label.
 */

import {
  AdditiveBlending, Mesh, PerspectiveCamera, PlaneGeometry, Vector3,
} from 'three';
import { SpriteNodeMaterial } from 'three/webgpu';
import { float, oneMinus, smoothstep, uv, vec3 } from 'three/tsl';
import { sunVisibilityUniform } from '../materials/sharedUniforms.ts';
import { occludedBySaturn } from '../ui/labels.ts';
import { SKY_RADIUS } from './Starfield.ts';

/**
 * Distance from the camera to the Earth sprite (scene units). Beyond the Sun's
 * follow distance (40000) and just inside the star shell, so the globe/rings
 * occlude it and it never collides with the system.
 */
export const EARTH_FOLLOW_DISTANCE = SKY_RADIUS * 0.9;

/** World-unit sprite size at the follow distance — a touch above a bright star. */
export const EARTH_SPRITE_SCALE = 170;

/** Pale-blue tint (Rayleigh-ish; the whole point is that it reads as *blue*). */
const EARTH_COLOR: [number, number, number] = [0.60, 0.75, 1.0];

/**
 * Linear radiance before AgX. Base is always on; the boost is added as solar
 * visibility falls to 0 (camera in Saturn's shadow) so the dot pops only in the
 * eclipsed-Sun framing and never competes with the Sun's glare in daylight.
 */
export const EARTH_BASE_RADIANCE = 1.6;
export const EARTH_ECLIPSE_BOOST = 3.2;

export class PaleBlueDot {
  /** Camera-centered sprite carrying the point (DISPLAY-frame, depth-tested). */
  readonly mesh: Mesh;
  private readonly label: HTMLElement;
  private readonly world = new Vector3();
  private labelVisible = true;

  constructor(hudRoot: HTMLElement) {
    const material = new SpriteNodeMaterial();
    material.transparent = true;
    material.blending = AdditiveBlending;
    material.depthWrite = false;
    // Depth-tested so Saturn's opaque globe hides the dot when it passes behind.
    material.depthTest = true;

    // Soft round disc, same defined-form rule as the starfield (edge0 < edge1).
    const r = uv().sub(0.5).length();
    const disc = oneMinus(smoothstep(float(0.08), float(0.5), r));
    // base + boost·(1 − visibility): brightest with the Sun fully eclipsed.
    const brightness = float(EARTH_BASE_RADIANCE)
      .add(float(EARTH_ECLIPSE_BOOST).mul(oneMinus(sunVisibilityUniform)));
    material.colorNode = vec3(...EARTH_COLOR).mul(brightness).mul(disc);
    material.opacityNode = disc;

    this.mesh = new Mesh(new PlaneGeometry(1, 1), material);
    this.mesh.scale.setScalar(EARTH_SPRITE_SCALE);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1; // over the star shell (−2), under the system

    // Subtle, non-interactive label (its own tag; not in the focusable list).
    this.label = document.createElement('span');
    this.label.className = 'body-label';
    this.label.textContent = 'Earth';
    this.label.style.pointerEvents = 'none';
    this.label.style.opacity = '0.7';
    hudRoot.appendChild(this.label);
  }

  /** Toggle the label with the HUD's global labels switch. */
  setLabelVisible(v: boolean): void {
    this.labelVisible = v;
  }

  /**
   * Place the sprite along `earthDir` at the follow distance from the camera,
   * and reposition the label. Call after the frame's final camera pose is known
   * (same slot as `Sun.update`).
   */
  update(earthDir: Vector3, cameraPos: Vector3, camera: PerspectiveCamera): void {
    this.world.copy(cameraPos).addScaledVector(earthDir, EARTH_FOLLOW_DISTANCE);
    this.mesh.position.copy(this.world);

    // Project the world point for the label; hide it when off-screen, behind the
    // camera, or occluded by Saturn's globe (same test the body labels use).
    if (!this.labelVisible || occludedBySaturn(cameraPos, this.world)) {
      this.label.classList.add('hidden');
      return;
    }
    const ndc = this.world.clone().project(camera);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) {
      this.label.classList.add('hidden');
      return;
    }
    this.label.classList.remove('hidden');
    this.label.style.left = `${((ndc.x * 0.5 + 0.5) * window.innerWidth).toFixed(1)}px`;
    this.label.style.top = `${((-ndc.y * 0.5 + 0.5) * window.innerHeight).toFixed(1)}px`;
  }
}
