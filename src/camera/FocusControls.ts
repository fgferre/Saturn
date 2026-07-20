/**
 * OrbitControls wrapper that keeps the camera locked onto a moving body:
 * the target tracks the body every frame (so you orbit *with* a moon), and
 * switching focus flies the camera over smoothly.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const easeInOut = (t: number) => t * t * (3 - 2 * t);

export class FocusControls {
  readonly controls: OrbitControls;
  focusId = 'saturn';

  private readonly camera: PerspectiveCamera;
  private readonly getBodyPos: (id: string, out: Vector3) => Vector3;
  private readonly getBodyRadius: (id: string) => number;

  private readonly bodyPos = new Vector3();
  private readonly prevBodyPos = new Vector3();
  private transition: {
    t: number; duration: number;
    fromTarget: Vector3; fromOffset: Vector3; toOffset: Vector3;
    /** Applied on completion — clamping mid-flight would snap the camera. */
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
    this.controls.maxDistance = 25000;
    // Panning would drag the target off the followed body with no way back.
    this.controls.enablePan = false;
    this.getBodyPos(this.focusId, this.prevBodyPos);
  }

  /** Fly to a body. Re-focusing the current body re-frames it. */
  focus(id: string): void {
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
    // User input would fight the lerp; damped velocity decays out meanwhile.
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
      if (tr.t >= 1) {
        this.controls.minDistance = tr.minDistance;
        this.controls.enabled = true;
        this.transition = null;
        this.prevBodyPos.copy(this.bodyPos);
      }
    } else {
      // Follow the moving body: translate target and camera together.
      const delta = this.bodyPos.clone().sub(this.prevBodyPos);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      this.prevBodyPos.copy(this.bodyPos);
    }

    this.controls.update();
  }
}
