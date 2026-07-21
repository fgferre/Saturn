/**
 * OrbitControls wrapper that keeps the camera locked onto a moving body:
 * the target tracks the body every frame (so you orbit *with* a moon), and
 * switching focus flies the camera over smoothly.
 *
 * During a focus flight the interpolated pose is authoritative — OrbitControls
 * must not run its minDistance clamp on that pose (the old Saturn minDistance
 * ~81 would pin the camera until the final frame, then snap).
 *
 * Momentum / autoRotate policy (Onda 1 review):
 * - Do not toggle the public `autoRotate` flag for the duration of a flight
 *   (re-entrant focus and HUD/cinema Drift must keep their real intent).
 * - Drain residual damping via a public-API flush: one update with damping
 *   and autoRotate temporarily off, then restore the captured pose so the
 *   residual application is discarded and `_sphericalDelta` is zeroed.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const easeInOut = (t: number) => t * t * (3 - 2 * t);

/** Shared with selfchecks — wide system views; sun/sky are camera-centered. */
export const ORBIT_MAX_DISTANCE = 25000;

export class FocusControls {
  readonly controls: OrbitControls;
  focusId = 'saturn';

  private readonly camera: PerspectiveCamera;
  private readonly getBodyPos: (id: string, out: Vector3) => Vector3;
  private readonly getBodyRadius: (id: string) => number;

  private readonly bodyPos = new Vector3();
  private readonly prevBodyPos = new Vector3();
  private readonly _flushTarget = new Vector3();
  private readonly _flushPos = new Vector3();
  private transition: {
    t: number; duration: number;
    fromTarget: Vector3; fromOffset: Vector3; toOffset: Vector3;
    minDistance: number;
  } | null = null;

  constructor(
    camera: PerspectiveCamera,
    domElement: HTMLElement,
    getBodyPos: (id: string, out: Vector3) => Vector3,
    getBodyRadius: (id: string) => number,
  ) {
    this.camera = camera;
    this.getBodyPos = getBodyPos;
    this.getBodyRadius = getBodyRadius;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = ORBIT_MAX_DISTANCE;
    // Panning would drag the target off the followed body with no way back.
    this.controls.enablePan = false;
    this.getBodyPos(this.focusId, this.prevBodyPos);
  }

  /**
   * Consume OrbitControls residual damping/pan without private API.
   * With enableDamping=false, one update() applies any pending delta then
   * zeros it; we immediately rewrite the pre-flush pose so the application
   * is discarded and only the cleared internal state remains.
   */
  private flushOrbitMomentum(): void {
    this._flushTarget.copy(this.controls.target);
    this._flushPos.copy(this.camera.position);
    const autoRotate = this.controls.autoRotate;
    const damping = this.controls.enableDamping;

    this.controls.autoRotate = false;
    this.controls.enableDamping = false;
    this.controls.update();

    this.controls.target.copy(this._flushTarget);
    this.camera.position.copy(this._flushPos);
    this.camera.lookAt(this._flushTarget);

    this.controls.autoRotate = autoRotate;
    this.controls.enableDamping = damping;
  }

  /**
   * Rebuild OrbitControls' internal spherical state from the current camera
   * pose under neutral flags (no auto-rotate step, no damping application).
   */
  private syncOrbitFromPose(): void {
    const autoRotate = this.controls.autoRotate;
    const damping = this.controls.enableDamping;
    this.controls.autoRotate = false;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.autoRotate = autoRotate;
    this.controls.enableDamping = damping;
  }

  /**
   * Instantly frame a body at an explicit offset from it (URL / postcard
   * restore). No fly transition: snaps target+camera and re-derives the
   * internal spherical state so the first follow-frame doesn't jump.
   */
  snap(id: string, offset: Vector3): void {
    this.focusId = id;
    this.getBodyPos(id, this.bodyPos);
    this.controls.target.copy(this.bodyPos);
    this.camera.position.copy(this.bodyPos).add(offset);
    this.camera.lookAt(this.bodyPos);
    this.prevBodyPos.copy(this.bodyPos);
    this.transition = null;
    this.controls.enabled = true;
    this.controls.minDistance = Math.max(this.getBodyRadius(id) * 1.4, 0.02);
    this.syncOrbitFromPose();
  }

  /** Fly to a body. Re-focusing the current body re-frames it. */
  focus(id: string): void {
    // Drop any pre-focus drag momentum so it cannot freeze across the flight
    // and reappear on the final sync frame.
    this.flushOrbitMomentum();

    const radius = this.getBodyRadius(id);
    const fromOffset = this.camera.position.clone().sub(this.controls.target);

    // Aim for a pleasant framing: a few radii out, keeping current view direction.
    const dist = Math.max(radius * 5.5, 0.6);
    const toOffset = fromOffset.clone().normalize().multiplyScalar(dist);

    this.focusId = id;
    this.transition = {
      t: 0, duration: 1.4,
      fromTarget: this.controls.target.clone(), fromOffset, toOffset,
      minDistance: Math.max(radius * 1.4, 0.02),
    };
    // Block user input only. Leave autoRotate alone — skipping update() mid-
    // flight already prevents it from moving the camera, and preserving the
    // public flag keeps HUD/cinema/re-entrant focus truthful.
    this.controls.enabled = false;
  }

  update(dt: number): void {
    this.getBodyPos(this.focusId, this.bodyPos);

    if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(1, tr.t + dt / tr.duration);
      const k = easeInOut(tr.t);
      const offset = tr.fromOffset.clone().lerp(tr.toOffset, k);
      this.controls.target.copy(tr.fromTarget).lerp(this.bodyPos, k);
      this.camera.position.copy(this.controls.target).add(offset);
      // update() is skipped mid-flight, so lookAt must be applied here.
      this.camera.lookAt(this.controls.target);

      if (tr.t >= 1) {
        // Final pose is already written; install the new limit before any
        // OrbitControls update can run, then hand control back.
        this.controls.minDistance = tr.minDistance;
        this.controls.enabled = true;
        this.transition = null;
        this.prevBodyPos.copy(this.bodyPos);
        // Sync internal spherical from the authoritative final pose with
        // residual already cleared and autoRotate/damping not applying a step.
        this.syncOrbitFromPose();
      }
      return;
    }

    // Follow the moving body: translate target and camera together.
    const delta = this.bodyPos.clone().sub(this.prevBodyPos);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    this.prevBodyPos.copy(this.bodyPos);

    this.controls.update();
  }
}
