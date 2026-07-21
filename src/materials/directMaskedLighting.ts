/**
 * Direct-only shadow/eclipse attenuation for MeshStandard-style materials.
 *
 * Multiplies the incoming direct lightColor inside PhysicalLightingModel.direct()
 * so ambient (indirect) and emissive terms are untouched:
 *
 *   L = Ldirect * mask  +  Lindirect  +  Lemissive
 *
 * Today the scene has a single DirectionalLight (the Sun); the mask therefore
 * applies to every direct light. If a second direct light is added later,
 * identify the solar light node or move the mask onto that light specifically.
 */

import {
  MeshStandardNodeMaterial,
  PhysicalLightingModel,
} from 'three/webgpu';
import type {
  LightingModelDirectInput,
  Node,
  NodeBuilder,
  PhysicalLightingModel as PhysicalLightingModelType,
} from 'three/webgpu';
import { float } from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';

/**
 * PhysicalLightingModel that scales only the direct irradiance by `mask`.
 * Does not re-apply N·L — the base model already does that once.
 */
export class DirectMaskedPhysicalLightingModel extends PhysicalLightingModel {
  private readonly mask: Node;

  constructor(mask: Node) {
    super();
    this.mask = mask;
  }

  override direct(input: LightingModelDirectInput, builder: NodeBuilder): void {
    // lightColor is typed as bare Node; TSL mul lives on the ShaderNodeObject
    // proxy (same cast pattern as HapkeLightingModel's reflectedLight writes).
    const lightColor = (input.lightColor as unknown as ShaderNodeObject<Node>).mul(
      this.mask as unknown as ShaderNodeObject<Node>,
    );
    // r178 JS PhysicalLightingModel.direct ignores builder; types still require it.
    super.direct({ ...input, lightColor }, builder);
  }
}

/**
 * MeshStandardNodeMaterial whose setupLightingModel applies `directLightMask`
 * to direct lights only. Used for Saturn and for Standard/procedural moons.
 */
export class DirectMaskedStandardMaterial extends MeshStandardNodeMaterial {
  /** 0..1 (or RGB) factor applied to every direct light's lightColor. */
  directLightMask: Node = float(1);

  override setupLightingModel(): PhysicalLightingModelType {
    return new DirectMaskedPhysicalLightingModel(this.directLightMask);
  }
}
