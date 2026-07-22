/**
 * Screen-space body labels: plain DOM elements projected each frame.
 * Labels hide when behind the camera or occluded by Saturn's globe.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { KM_PER_UNIT, SATURN } from '../data/saturn.ts';
import type { BodyDefinition } from '../orbital/types.ts';

const SATURN_R = SATURN.physical.radiusKm / KM_PER_UNIT;

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Small padded overlap test shared with the runtime collision pass/selfcheck. */
export function labelBoxesOverlap(a: LabelBox, b: LabelBox, padding = 3): boolean {
  return a.left < b.right + padding
    && a.right + padding > b.left
    && a.top < b.bottom + padding
    && a.bottom + padding > b.top;
}

/** Map normalized-device coordinates into the renderer's CSS viewport. */
export function projectNdcToViewport(
  ndcX: number,
  ndcY: number,
  rect: ViewportRect,
): { x: number; y: number } {
  return {
    x: rect.left + (ndcX * 0.5 + 0.5) * rect.width,
    y: rect.top + (-ndcY * 0.5 + 0.5) * rect.height,
  };
}

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
  private readonly defs = new Map<string, BodyDefinition>();
  private readonly tmp = new Vector3();
  private readonly viewport: HTMLElement;
  visible = true;

  constructor(
    bodies: BodyDefinition[],
    onClick: (id: string) => void,
    viewport: HTMLElement,
  ) {
    this.viewport = viewport;
    for (const def of bodies) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'body-label';
      el.textContent = def.name;
      el.addEventListener('click', () => onClick(def.id));
      document.getElementById('hud')!.appendChild(el);
      this.els.set(def.id, el);
      this.defs.set(def.id, def);
    }
  }

  update(
    camera: PerspectiveCamera,
    getBodyPos: (id: string, out: Vector3) => Vector3,
    focusedId: string,
  ): void {
    // Project with THIS frame's camera pose (rAF only refreshes it at render).
    camera.updateMatrixWorld();
    const rect = this.viewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      this.els.forEach((el) => el.classList.add('hidden'));
      return;
    }
    const candidates: Array<{
      el: HTMLElement;
      x: number;
      y: number;
      score: number;
      box: LabelBox;
    }> = [];
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
      const worldDistance = camera.position.distanceTo(pos);
      const { x, y } = projectNdcToViewport(pos.x, pos.y, rect);
      // Approximate the stable uppercase label box without forcing a DOM layout
      // read after every position write. The largest apparent body wins when
      // boxes collide; tiny co-orbitals no longer turn into an unreadable knot.
      const width = 14 + (el.textContent?.length ?? 0) * 8.2;
      const height = 18;
      candidates.push({
        el,
        x,
        y,
        score: (this.defs.get(id)?.physical.radiusKm ?? 0) / Math.max(worldDistance, 1e-6),
        box: {
          left: x - width / 2,
          right: x + width / 2,
          top: y - height * 1.4,
          bottom: y - height * 0.4,
        },
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    const accepted: LabelBox[] = [];
    for (const candidate of candidates) {
      if (accepted.some((box) => labelBoxesOverlap(candidate.box, box))) {
        candidate.el.classList.add('hidden');
        continue;
      }
      accepted.push(candidate.box);
      candidate.el.classList.remove('hidden');
      candidate.el.style.left = `${candidate.x.toFixed(1)}px`;
      candidate.el.style.top = `${candidate.y.toFixed(1)}px`;
    }
  }
}
