/**
 * Cinema mode: the HUD and labels fade out, the camera drifts slowly, and the
 * view tours a fixed list of bodies on a timer. Extracted from main.ts (S27)
 * so the keyboard layer that shares its Esc handler has one owner.
 */

import type { FocusControls } from '../camera/FocusControls.ts';

/**
 * F12.3 — accessibility. Users who ask the OS for reduced motion get no
 * automatic camera movement: Drift never turns itself on, and Cinema, even when
 * launched by hand, holds a still frame instead of drifting and auto-touring.
 * Read live (never cached) so a mid-session OS change is honoured.
 */
const reducedMotionQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
export function prefersReducedMotion(): boolean {
  return reducedMotionQuery?.matches ?? false;
}

export interface CinemaDeps {
  controls: FocusControls;
  focusBody(id: string): void;
}

const STOPS = ['saturn', 'enceladus', 'titan', 'mimas', 'iapetus', 'saturn'];
const STOP_SECONDS = 22;

export class Cinema {
  active = false;
  private timer = 0;
  private stop = 0;
  private wasDrifting = false;
  private readonly controls: FocusControls;
  private readonly focusBody: (id: string) => void;

  constructor(deps: CinemaDeps) {
    this.controls = deps.controls;
    this.focusBody = deps.focusBody;

    const exit = document.createElement('div');
    exit.className = 'cinema-exit';
    exit.textContent = 'Esc to exit';
    document.body.appendChild(exit);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.exit();
    });
  }

  enter(): void {
    this.active = true;
    this.timer = 0;
    this.stop = 0;
    this.wasDrifting = this.controls.controls.autoRotate;
    document.body.classList.add('cinema');
    // Reduced motion: hold a still, HUD-free frame — no drift, no auto-tour.
    this.controls.controls.autoRotate = !prefersReducedMotion();
    this.controls.controls.autoRotateSpeed = 0.25;
    this.focusBody(STOPS[0]);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('cinema');
    // Restore the pre-cinema drift state so the HUD checkbox stays truthful.
    this.controls.controls.autoRotate = this.wasDrifting;
    this.controls.controls.autoRotateSpeed = 0.12;
  }

  update(dt: number): void {
    // Reduced motion suppresses the auto-tour: the view stays on the first stop.
    if (!this.active || prefersReducedMotion()) return;
    this.timer += dt;
    if (this.timer > STOP_SECONDS) {
      this.timer = 0;
      this.stop = (this.stop + 1) % STOPS.length;
      this.focusBody(STOPS[this.stop]);
    }
  }
}
