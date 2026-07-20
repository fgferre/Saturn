/**
 * The Sun: a directional light plus an HDR billboard whose radiance is far
 * above 1.0 — the post pipeline is HalfFloat end-to-end, so physical bloom,
 * anamorphic streaks and lens ghosts all derive from this single source.
 */

import {
  AdditiveBlending, AmbientLight, CanvasTexture, DirectionalLight, Group,
  Mesh, PlaneGeometry, SRGBColorSpace, Vector3,
} from 'three';
import { SpriteNodeMaterial } from 'three/webgpu';
import { texture, uv, vec3 } from 'three/tsl';

const SUN_DISTANCE = 24000;
/** HDR radiance of the solar disk core (feeds bloom/flare physically). */
const SUN_RADIANCE = 42;

function makeGlowTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.05, 'rgba(255,252,240,1)');
  g.addColorStop(0.12, 'rgba(255,238,200,0.35)');
  g.addColorStop(0.35, 'rgba(255,220,160,0.07)');
  g.addColorStop(1.0, 'rgba(255,205,130,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class Sun {
  readonly group = new Group();
  readonly light: DirectionalLight;
  private readonly disk: Mesh;

  constructor() {
    this.light = new DirectionalLight(0xfff4e0, 3.2);
    this.group.add(this.light);
    this.group.add(this.light.target);

    // Very low fill so night sides are not absolute black on screen.
    this.group.add(new AmbientLight(0x8898b0, 0.035));

    // HDR sun disk: radiance >> 1 so bloom/lensflare are physically driven.
    const material = new SpriteNodeMaterial();
    material.transparent = true;
    material.blending = AdditiveBlending;
    material.depthWrite = false;
    const glow = texture(makeGlowTexture(), uv());
    material.colorNode = glow.rgb.mul(vec3(1.0, 0.97, 0.92)).mul(SUN_RADIANCE);
    material.opacityNode = glow.a;

    this.disk = new Mesh(new PlaneGeometry(1, 1), material);
    this.disk.scale.setScalar(1400);
    this.disk.frustumCulled = false;
    this.group.add(this.disk);
  }

  /** Point the light and disk along the (unit) sun direction. */
  update(sunDir: Vector3): void {
    this.light.position.copy(sunDir).multiplyScalar(1000);
    this.light.target.position.set(0, 0, 0);
    this.disk.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);
  }
}
