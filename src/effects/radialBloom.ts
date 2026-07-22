/**
 * Radially symmetric two-scale bloom for HDR scene highlights.
 *
 * Three's BloomNode builds five progressively smaller rectangular mip levels.
 * Extremely bright points keep those coarse footprints visible after tone
 * mapping, which is the square halo this effect replaces. These two separable
 * passes are true Gaussians: identical X/Y kernels make their 2D product depend
 * only on x² + y², and the kernel is cut at 3σ where the residual is ~1%.
 */

import { HalfFloatType } from 'three';
import type { Node } from 'three/webgpu';
import GaussianBlurNode from 'three/addons/tsl/display/GaussianBlurNode.js';
import {
  convertToTexture, float, luminance, nodeObject, smoothstep,
} from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';

class IsotropicGaussianBlurNode extends GaussianBlurNode {
  /** Gaussian coefficients with the final tap at 3σ (instead of ~1σ). */
  _getCoefficients(kernelSize: number): number[] {
    const sigma = Math.max((kernelSize - 1) / 3, 1e-3);
    const coefficients: number[] = [];
    for (let i = 0; i < kernelSize; i++) {
      coefficients.push(Math.exp(-0.5 * (i / sigma) ** 2));
    }
    return coefficients;
  }
}

/**
 * Bloom only pixels above `threshold`, at a tight and a half-resolution soft
 * scale. Five blur passes including extraction replace BloomNode's twelve.
 */
export function radialBloom(
  inputNode: Node,
  strength = 0.62,
  threshold = 0.85,
): ShaderNodeObject<Node> {
  const source = nodeObject(inputNode);
  const brightGate = smoothstep(
    float(threshold),
    float(threshold + 0.08),
    luminance(source.rgb),
  );
  const bright = convertToTexture(
    source.mul(brightGate),
    null,
    null,
    { type: HalfFloatType },
  );

  // Full-resolution 10 px support: preserves a crisp local glow.
  const fine = nodeObject(new IsotropicGaussianBlurNode(bright, float(1.25), 3));

  // Half-resolution 50 px support: broad falloff without a coarse rectangular
  // mip footprint. Normalized UV sampling expands it back to the full frame.
  const soft = nodeObject(new IsotropicGaussianBlurNode(bright, float(2.5), 4));
  soft.resolution.set(0.5, 0.5);

  return fine.mul(strength * 0.7).add(soft.mul(strength * 0.3));
}
