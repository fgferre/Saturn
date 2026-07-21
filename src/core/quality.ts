/**
 * Quality presets (Low / Med / High / Ultra). Most knobs are build-time
 * constants (shader loop lengths, MSAA sample counts, particle totals), so
 * switching applies via a page reload — preset persisted in localStorage.
 *
 * The auto-tuner measures the first seconds of the default preset and steps
 * down once if the frame rate is clearly short of target (never upgrades on
 * its own; Ultra is always a manual choice and may run at ~24 fps).
 */

export type QualityName = 'low' | 'med' | 'high' | 'ultra';

export interface QualityPreset {
  name: QualityName;
  label: string;
  dprCap: number;
  msaaSamples: number;
  raymarchSteps: number;
  plumeCount: number;
  slabCount: number;
  moonSegments: [number, number];
  dof: boolean;
  lensflare: boolean;
  filmGrain: number;
}

export const PRESETS: Record<QualityName, QualityPreset> = {
  low: {
    name: 'low', label: 'Low', dprCap: 1, msaaSamples: 0, raymarchSteps: 8,
    plumeCount: 16384, slabCount: 8192, moonSegments: [96, 48],
    dof: false, lensflare: false, filmGrain: 0,
  },
  med: {
    name: 'med', label: 'Med', dprCap: 1.5, msaaSamples: 2, raymarchSteps: 12,
    plumeCount: 65536, slabCount: 24576, moonSegments: [128, 64],
    dof: false, lensflare: true, filmGrain: 0.03,
  },
  high: {
    name: 'high', label: 'High', dprCap: 2, msaaSamples: 4, raymarchSteps: 16,
    plumeCount: 262144, slabCount: 65536, moonSegments: [192, 96],
    dof: true, lensflare: true, filmGrain: 0.035,
  },
  ultra: {
    name: 'ultra', label: 'Ultra', dprCap: 2, msaaSamples: 4, raymarchSteps: 24,
    plumeCount: 1048576, slabCount: 131072, moonSegments: [256, 128],
    dof: true, lensflare: true, filmGrain: 0.04,
  },
};

const STORAGE_KEY = 'saturn.quality';
const TUNED_KEY = 'saturn.autotuned';

/**
 * Optional hook run synchronously before any preset reload. main.ts registers
 * the URL flush here so the reload restores the full state (pose + date +
 * focus) — quality.ts must not import ui/, so this is a plain callback seam.
 */
let beforeReload: (() => void) | null = null;
export function setBeforeReload(fn: () => void): void {
  beforeReload = fn;
}

/**
 * F12.2 — touch phone / small tablet heuristic. Only consulted when the user
 * has made no explicit choice (no `?quality`, nothing in localStorage), so a
 * later manual pick (STORAGE_KEY) or auto-tune (TUNED_KEY) always wins on the
 * next load. Mobile GPUs choke on the High default; start lighter and let the
 * auto-tuner / dynamic-resolution controller take it the rest of the way.
 */
function isTouchMobile(): boolean {
  try {
    return navigator.maxTouchPoints > 0 && window.innerWidth < 900;
  } catch {
    return false;
  }
}

function load(): QualityPreset {
  try {
    // QA: ?quality=<preset> pins a preset for this page load only — never
    // persisted, so headless runs don't disturb the stored user choice.
    const pinned = new URLSearchParams(location.search).get('quality') as QualityName | null;
    if (pinned && PRESETS[pinned]) return PRESETS[pinned];
    const name = localStorage.getItem(STORAGE_KEY) as QualityName | null;
    if (name && PRESETS[name]) return PRESETS[name];
    // No pin and no saved choice: on touch phones start on a light preset
    // instead of the desktop High default. Not persisted — the first manual
    // pick or auto-tune overrides it.
    if (isTouchMobile()) return PRESETS.med;
  } catch { /* storage unavailable */ }
  return PRESETS.high;
}

/** The active preset for this page load. */
export const quality: QualityPreset = load();

/** Persist a new preset and reload (most knobs are build-time constants). */
export function setQuality(name: QualityName): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
    localStorage.setItem(TUNED_KEY, '1'); // manual choice disables auto-tuning
  } catch {
    // Storage blocked: the preset can't persist, so reloading would just
    // destroy the session for a no-op.
    return;
  }
  beforeReload?.(); // flush URL state so the reload lands on the same view
  location.reload();
}

/**
 * QA: ?notune disables all automatic tuning — the one-shot downgrade below
 * (it can location.reload() mid headless-capture) AND the F10.3 dynamic
 * resolution controller in main.ts, which reads this via `tuneDisabled`.
 */
export const tuneDisabled = (() => {
  try {
    return new URLSearchParams(location.search).has('notune');
  } catch {
    return false;
  }
})();

/**
 * One-shot preset downgrade if the machine clearly can't hold the default
 * preset. Since F10.3 this is only a first-second fallback for a machine so
 * slow that even the minimum dynamic DPR won't help (measuredFps < 30 → drop a
 * whole preset + reload once); the dynamic resolution controller in main.ts
 * handles everything above that with smooth, reload-free DPR steps.
 */
export function autoTuneDown(measuredFps: number): void {
  try {
    if (tuneDisabled || localStorage.getItem(TUNED_KEY)) return;
    localStorage.setItem(TUNED_KEY, '1');
    const order: QualityName[] = ['low', 'med', 'high', 'ultra'];
    const idx = order.indexOf(quality.name);
    if (measuredFps < 30 && idx > 0) {
      localStorage.setItem(STORAGE_KEY, order[idx - 1]);
      beforeReload?.(); // flush URL state so the reload lands on the same view
      location.reload();
    }
  } catch { /* ignore */ }
}
