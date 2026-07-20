/**
 * Screen-space body labels: plain DOM elements projected each frame.
 * Labels hide when behind the camera or occluded by Saturn's globe.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { KM_PER_UNIT, SATURN } from '../data/saturn.ts';
import type { BodyDefinition } from '../orbital/types.ts';

const SATURN_R = SATURN.physical.radiusKm / KM_PER_UNIT;

export class BodyLabels {
  private readonly els = new Map<string, HTMLElement>();
  private readonly tmp = new Vector3();
  private readonly camToBody = new Vector3();
  visible = true;

  constructor(bodies: BodyDefinition[], onClick: (id: string) => void) {
    for (const def of bodies) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'body-label';
      el.textContent = def.name;
      el.addEventListener('click', () => onClick(def.id));
      document.getElementById('hud')!.appendChild(el);
      this.els.set(def.id, el);
    }
  }

  update(
    camera: PerspectiveCamera,
    getBodyPos: (id: string, out: Vector3) => Vector3,
    focusedId: string,
  ): void {
    // Project with THIS frame's camera pose (rAF only refreshes it at render).
    camera.updateMatrixWorld();
    for (const [id, el] of this.els) {
      if (!this.visible) { el.classList.add('hidden'); continue; }

      // The focused body is what you're looking at — its label is just noise.
      if (id === focusedId) { el.classList.add('hidden'); continue; }

      const pos = getBodyPos(id, this.tmp);
      this.camToBody.copy(pos).sub(camera.position);
      const dist = this.camToBody.length();

      // Occlusion by Saturn's globe (skip for Saturn's own label).
      if (id !== 'saturn' && this.occludedBySaturn(camera.position, dist)) {
        el.classList.add('hidden');
        continue;
      }

      pos.project(camera);
      if (pos.z > 1 || Math.abs(pos.x) > 1.1 || Math.abs(pos.y) > 1.1) {
        el.classList.add('hidden');
        continue;
      }
      el.classList.remove('hidden');
      const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
      el.style.left = `${x.toFixed(1)}px`;
      el.style.top = `${y.toFixed(1)}px`;
    }
  }

  private occludedBySaturn(camPos: Vector3, bodyDist: number): boolean {
    // Saturn sits at the origin. Closest approach of the cam->body segment to it:
    const d = this.camToBody; // already bodyPos - camPos
    const t = -camPos.dot(d) / (bodyDist * bodyDist);
    if (t <= 0 || t >= 1) return false;
    const cx = camPos.x + d.x * t;
    const cy = camPos.y + d.y * t;
    const cz = camPos.z + d.z * t;
    return Math.hypot(cx, cy, cz) < SATURN_R * 0.98;
  }
}
