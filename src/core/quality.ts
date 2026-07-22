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
  // msaaSamples must be WebGPU-legal (0 or 4 — there is no 2× MSAA there; see
  // Engine). Med is both the touch-mobile default and the auto-tuner's landing
  // spot for slow machines, so the illegal 2 rounds DOWN to 0: promoting it to
  // 4 would make the "lighter" preset carry High's most expensive raster knob
  // on exactly the GPUs that can't afford it.
  med: {
    name: 'med', label: 'Med', dprCap: 1.5, msaaSamples: 0, raymarchSteps: 12,
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

export type BackendName = 'WebGPU' | 'WebGL2';

/** F10.3 quantized resolution ladder; every applied DPR must be one of these. */
export const DYNAMIC_DPR_STEPS = [0.75, 1, 1.25, 1.5, 2] as const;

export function dprStepsFor(cap: number): number[] {
  const steps = DYNAMIC_DPR_STEPS.filter((step) => step <= cap + 1e-6);
  // Every shipped cap is >= 1, but keep malformed future presets recoverable.
  return steps.length > 0 ? steps : [DYNAMIC_DPR_STEPS[0]];
}

/**
 * Quantize the boot DPR before PassNode targets are allocated. Previously the
 * renderer kept the raw devicePixelRatio while the HUD/controller tracked the
 * nearest step, so e.g. a 1.1× renderer was reported and controlled as 1.0×.
 */
export function quantizeDpr(deviceDpr: number, cap: number): number {
  const steps = dprStepsFor(cap);
  const target = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  let best = steps[0];
  let bestDistance = Math.abs(best - target);
  for (let i = 1; i < steps.length; i++) {
    const distance = Math.abs(steps[i] - target);
    if (distance < bestDistance) {
      best = steps[i];
      bestDistance = distance;
    }
  }
  return best;
}

/** Resolve a scene-pass sample count that the selected backend can express. */
export function resolveMsaaSamples(requested: number, backend: BackendName): number {
  const samples = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  if (backend === 'WebGPU') return samples > 1 ? 4 : 0;
  return samples;
}

/** Parse the ephemeral QA/debug quality pin without accepting prototype keys. */
export function qualityPinFromSearch(search: string): QualityName | null {
  try {
    const value = new URLSearchParams(search).get('quality');
    return value && Object.hasOwn(PRESETS, value) ? value as QualityName : null;
  } catch {
    return null;
  }
}

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
    const pinned = qualityPinFromSearch(location.search);
    if (pinned) return PRESETS[pinned];
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
  // An explicit pick outranks the `?quality` pin — load() reads the pin first,
  // and writeUrl carries it across every reload, so leaving it in place makes
  // the HUD buttons look dead (they store the choice, the pin then ignores it).
  // location.replace = reload with the pin dropped, no extra history entry.
  const url = new URL(location.href);
  url.searchParams.delete('quality');
  location.replace(url.href);
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
    // A quality pin is ephemeral and must not mutate the saved choice behind
    // the user's back. Dynamic DPR may still adapt unless ?notune is present.
    if (
      tuneDisabled || qualityPinFromSearch(location.search) ||
      localStorage.getItem(TUNED_KEY)
    ) return;
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
