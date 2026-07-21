/**
 * Screen-space body labels: plain DOM elements projected each frame.
 * Labels hide when behind the camera or occluded by Saturn's globe.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { KM_PER_UNIT, SATURN } from '../data/saturn.ts';
import type { BodyDefinition } from '../orbital/types.ts';

const SATURN_R = SATURN.physical.radiusKm / KM_PER_UNIT;

/**
 * True when Saturn's globe sits between the camera and `bodyPos` (the body is
 * hidden behind the planet). Saturn is at the origin; we test the closest
 * approach of the camera→body segment to it. Shared by the label projector and
 * click-to-focus picking (F8.7) so both hide/ignore the same occluded bodies.
 */
export function occludedBySaturn(camPos: Vector3, bodyPos: Vector3): boolean {
  const dx = bodyPos.x - camPos.x;
  const dy = bodyPos.y - camPos.y;
  const dz = bodyPos.z - camPos.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 === 0) return false;
  const t = -(camPos.x * dx + camPos.y * dy + camPos.z * dz) / len2;
  if (t <= 0 || t >= 1) return false;
  const cx = camPos.x + dx * t;
  const cy = camPos.y + dy * t;
  const cz = camPos.z + dz * t;
  return Math.hypot(cx, cy, cz) < SATURN_R * 0.98;
}

export class BodyLabels {
  private readonly els = new Map<string, HTMLElement>();
  private readonly tmp = new Vector3();
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

      // Occlusion by Saturn's globe (skip for Saturn's own label).
      if (id !== 'saturn' && occludedBySaturn(camera.position, pos)) {
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
}
