/**
 * The Sun: a directional light plus a glowing sprite billboard placed far
 * along the current sun direction. Bloom does the rest.
 */

import {
  AdditiveBlending, AmbientLight, CanvasTexture, DirectionalLight, Group,
  Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from 'three';

const SUN_DISTANCE = 24000;

function makeGlowTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.08, 'rgba(255,250,235,1)');
  g.addColorStop(0.22, 'rgba(255,235,190,0.55)');
  g.addColorStop(0.5, 'rgba(255,215,150,0.16)');
  g.addColorStop(1.0, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class Sun {
  readonly group = new Group();
  readonly light: DirectionalLight;
  private readonly sprite: Sprite;

  constructor() {
    this.light = new DirectionalLight(0xfff4e0, 3.2);
    this.group.add(this.light);
    this.group.add(this.light.target);

    // Very low fill so night sides are not absolute black on screen.
    this.group.add(new AmbientLight(0x8898b0, 0.035));

    this.sprite = new Sprite(new SpriteMaterial({
      map: makeGlowTexture(),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    this.sprite.scale.setScalar(2600);
    this.group.add(this.sprite);
  }

  /** Point the light and sprite along the (unit) sun direction. */
  update(sunDir: Vector3): void {
    this.light.position.copy(sunDir).multiplyScalar(1000);
    this.light.target.position.set(0, 0, 0);
    this.sprite.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);
  }
}
