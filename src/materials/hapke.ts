/**
 * Hapke-style BRDF for airless icy regolith — the reason Cassini moon
 * photos look "chalky-flat" at full phase and dramatically shaded at
 * grazing light, which Lambert shading cannot reproduce.
 *
 * Model: Lommel-Seeliger lobe × opposition surge (SHOE-like) ×
 * backscattering Henyey-Greenstein phase function. Deliberately compact —
 * parameters are per-moon tuned, not fitted photometry.
 *
 * Integrates with the three.js lighting pipeline via a custom
 * LightingModel subclass (setupLightingModel hook on the node material),
 * so eclipse factors, emissive saturnshine and the sun DirectionalLight
 * keep working unchanged.
 *
 * Eclipse / ring-shadow on moons multiplies lightColor inside direct() only
 * (Onda 2) — albedo and saturnshine emissive stay unmasked.
 */

import { LightingModel, MeshStandardNodeMaterial } from 'three/webgpu';
import type { LightingModelDirectInput, Node, PhysicalLightingModel } from 'three/webgpu';
import {
  acos, clamp, diffuseColor, dot, float, max, pow,
  positionViewDirection, transformedNormalView,
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';

export interface HapkeParams {
  /** Opposition surge amplitude (0..2). */
  surgeAmplitude: number;
  /** Surge angular width, radians (~0.03..0.12). */
  surgeWidth: number;
  /** HG asymmetry, negative = backscattering (-0.4..-0.15). */
  g: number;
  /** Overall gain calibrated so mid-phase brightness matches Lambert. */
  gain: number;
}

export const DEFAULT_HAPKE: HapkeParams = {
  surgeAmplitude: 0.7,
  surgeWidth: 0.055,
  g: -0.28,
  gain: 1.9,
};

class HapkeLightingModel extends LightingModel {
  private readonly params: HapkeParams;
  /** 0..1 sunlight fraction (Saturn umbra + ring opacity). */
  private readonly directMask: Node;

  constructor(params: HapkeParams, directMask: Node = float(1)) {
    super();
    this.params = params;
    this.directMask = directMask;
  }

  direct({ lightDirection, lightColor, reflectedLight }: LightingModelDirectInput): void {
    const p = this.params;
    const N = transformedNormalView;
    const L = lightDirection;
    const V = positionViewDirection;

    // Eclipse / ring shadow: attenuate direct irradiance only (not albedo).
    const maskedLight = (lightColor as unknown as ShaderNodeObject<Node>).mul(
      this.directMask as unknown as ShaderNodeObject<Node>,
    );

    const mu0 = max(dot(N, L), 0.0);
    const mu = max(dot(N, V), 0.0);

    // Lommel-Seeliger: single-scattering from a particulate surface.
    const ls = mu0.div(mu0.add(mu).add(1e-4));

    // Phase angle between sun and viewer.
    // NOTE: HG convention with g<0 currently peaks at high phase — known
    // Onda 4+/Hapke retune item; do NOT change here (Onda 2 scope).
    const cosg = clamp(dot(L, V), -1.0, 1.0);
    const g = acos(cosg);

    // Opposition surge (shadow-hiding): sharp brightening near zero phase.
    const surge = float(p.surgeAmplitude).div(g.div(p.surgeWidth).add(1.0)).add(1.0);

    // Backscattering Henyey-Greenstein phase function.
    const g2 = p.g * p.g;
    const phase = float((1 - g2) / (4 * Math.PI))
      .div(pow(float(1 + g2).sub(cosg.mul(2 * p.g)), 1.5));

    const brdf = ls.mul(surge).mul(phase).mul(p.gain * 4 * Math.PI);
    (reflectedLight.directDiffuse as unknown as ShaderNodeObject<Node>).addAssign(
      diffuseColor.rgb.mul(maskedLight).mul(brdf),
    );
  }

  // indirect(): base no-op — airless bodies, night sides stay physically
  // black except for the saturnshine emissive term.
}

/** MeshStandardNodeMaterial that shades with the Hapke model instead of PBR. */
export class MoonNodeMaterial extends MeshStandardNodeMaterial {
  hapkeParams: HapkeParams;
  /** Direct-sunlight mask (eclipse/ring shadow). Does not affect emissive. */
  directLightMask: Node = float(1);

  constructor(params: Partial<HapkeParams> = {}) {
    super({ roughness: 1, metalness: 0 });
    this.hapkeParams = { ...DEFAULT_HAPKE, ...params };
  }

  override setupLightingModel(): PhysicalLightingModel {
    // The base type promises PhysicalLightingModel; any LightingModel works
    // at runtime — the hook only calls direct()/indirect().
    return new HapkeLightingModel(
      this.hapkeParams,
      this.directLightMask,
    ) as unknown as PhysicalLightingModel;
  }
}
