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
  anamorphic: boolean;
  lensflare: boolean;
  filmGrain: number;
}

export const PRESETS: Record<QualityName, QualityPreset> = {
  low: {
    name: 'low', label: 'Low', dprCap: 1, msaaSamples: 0, raymarchSteps: 8,
    plumeCount: 16384, slabCount: 8192, moonSegments: [96, 48],
    dof: false, anamorphic: false, lensflare: false, filmGrain: 0,
  },
  med: {
    name: 'med', label: 'Med', dprCap: 1.5, msaaSamples: 2, raymarchSteps: 12,
    plumeCount: 65536, slabCount: 24576, moonSegments: [128, 64],
    dof: false, anamorphic: false, lensflare: true, filmGrain: 0.03,
  },
  high: {
    name: 'high', label: 'High', dprCap: 2, msaaSamples: 4, raymarchSteps: 16,
    plumeCount: 262144, slabCount: 65536, moonSegments: [192, 96],
    dof: true, anamorphic: true, lensflare: true, filmGrain: 0.035,
  },
  ultra: {
    name: 'ultra', label: 'Ultra', dprCap: 2, msaaSamples: 4, raymarchSteps: 24,
    plumeCount: 1048576, slabCount: 131072, moonSegments: [256, 128],
    dof: true, anamorphic: true, lensflare: true, filmGrain: 0.04,
  },
};

const STORAGE_KEY = 'saturn.quality';
const TUNED_KEY = 'saturn.autotuned';

function load(): QualityPreset {
  try {
    const name = localStorage.getItem(STORAGE_KEY) as QualityName | null;
    if (name && PRESETS[name]) return PRESETS[name];
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
  } catch { /* ignore */ }
  location.reload();
}

/**
 * One-shot downgrade if the machine clearly can't hold the default preset.
 * Call with measured fps after a few seconds of rendering.
 */
export function autoTuneDown(measuredFps: number): void {
  try {
    if (localStorage.getItem(TUNED_KEY)) return;
    localStorage.setItem(TUNED_KEY, '1');
    const order: QualityName[] = ['low', 'med', 'high', 'ultra'];
    const idx = order.indexOf(quality.name);
    if (measuredFps < 30 && idx > 0) {
      localStorage.setItem(STORAGE_KEY, order[idx - 1]);
      location.reload();
    }
  } catch { /* ignore */ }
}
