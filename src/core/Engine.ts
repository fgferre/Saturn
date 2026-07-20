/**
 * Rendering engine: WebGPU with automatic WebGL2 fallback (three's
 * WebGPURenderer handles the downgrade internally), ACES tone mapping and a
 * TSL bloom post-processing chain.
 */

import { AgXToneMapping, PerspectiveCamera, RenderTarget, Scene } from 'three';
import { PostProcessing, WebGPURenderer } from 'three/webgpu';
import { float, oneMinus, pass, screenUV } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { anamorphic } from 'three/addons/tsl/display/AnamorphicNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { sunVisibilityUniform } from '../materials/sharedUniforms.ts';

export class Engine {
  readonly renderer: WebGPURenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly backendName: 'WebGPU' | 'WebGL2';
  private readonly post: PostProcessing;

  private constructor(renderer: WebGPURenderer, container: HTMLElement) {
    this.renderer = renderer;
    container.appendChild(renderer.domElement);

    // Zero-size containers happen in hidden/background tabs before layout.
    const width = container.clientWidth || 1280;
    const height = container.clientHeight || 720;
    this.camera = new PerspectiveCamera(45, width / height, 0.05, 120000);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    // AgX: gentler highlight rolloff than ACES — closest to Cassini's
    // natural-color look (calibrated against PIA21345).
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1.4;

    // MSAA on the scene pass only — the final fullscreen quad doesn't need it.
    const scenePass = pass(this.scene, this.camera, { samples: 4 });
    const bloomPass = bloom(scenePass, 0.45, 0.35, 0.82);
    // Physical lens system driven by the HDR sun disk: anamorphic streak +
    // ghost flares, both gated by how visible the sun actually is (CPU
    // occlusion test updates sunVisibilityUniform each frame).
    const streak = anamorphic(scenePass, float(3.0), float(4), 24)
      .mul(sunVisibilityUniform).mul(0.12);
    const ghosts = lensflare(bloomPass, { threshold: float(2.6), ghostSamples: float(3) })
      .mul(sunVisibilityUniform).mul(0.35);
    // Cinematic finish: gentle vignette + fine animated film grain.
    const vignette = oneMinus(screenUV.sub(0.5).length().pow(2.2).mul(0.5));
    this.post = new PostProcessing(renderer);
    this.post.outputNode = film(
      scenePass.add(bloomPass).add(streak).add(ghosts).mul(vignette),
      float(0.035),
    );

    this.backendName = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
      ? 'WebGPU'
      : 'WebGL2';

    window.addEventListener('resize', () => {
      const w = container.clientWidth || 1280;
      const h = container.clientHeight || 720;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
  }

  static async create(container: HTMLElement): Promise<Engine> {
    // `?webgl` forces the WebGL2 backend (debugging / driver workarounds).
    const forceWebGL = new URLSearchParams(location.search).has('webgl');
    // No canvas antialias: MSAA happens on the scene pass (see constructor),
    // so the final quad present skips a useless 4x multisample+resolve.
    const renderer = new WebGPURenderer({ forceWebGL });
    await renderer.init();
    return new Engine(renderer, container);
  }

  private capturing = false;
  private readonly computes: object[] = [];

  /** Register a compute pass to run every frame (GPU particles etc.). */
  addCompute(node: object): void {
    this.computes.push(node);
  }

  /** Run a compute pass once, now (initialization kernels). */
  async computeOnce(node: object): Promise<void> {
    await this.renderer.computeAsync(node as never);
  }

  /** Start the frame loop; cb receives dt in seconds (clamped for tab-switch spikes). */
  start(cb: (dt: number) => void): void {
    let last = performance.now();
    this.renderer.setAnimationLoop(() => {
      if (this.capturing) return; // don't race an in-flight capture()
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      cb(dt);
      for (const n of this.computes) this.renderer.compute(n as never);
      this.post.render();
    });
  }

  /** Render a single frame outside the rAF loop (headless testing). */
  async renderOnce(): Promise<void> {
    for (const n of this.computes) await this.renderer.computeAsync(n as never);
    await this.post.renderAsync();
  }

  /**
   * Off-screen capture that works even when the tab is hidden (no canvas
   * presentation involved): renders to a RenderTarget and reads pixels back.
   * QA/testing only. `withPost` runs the full bloom/tone-mapping chain.
   */
  async capture(width = 1280, withPost = true): Promise<string> {
    this.capturing = true;
    try {
      const aspect = Number.isFinite(this.camera.aspect) && this.camera.aspect > 0
        ? this.camera.aspect
        : 16 / 9;
      const height = Math.round(width / aspect);
      const rt = new RenderTarget(width, height);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(rt);
      if (withPost) {
        await this.post.renderAsync();
      } else {
        await this.renderer.renderAsync(this.scene, this.camera);
      }
      const buf = (await this.renderer.readRenderTargetPixelsAsync(
        rt, 0, 0, width, height,
      )) as Uint8Array;
      this.renderer.setRenderTarget(prev);
      rt.dispose();

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      const img = ctx.createImageData(width, height);
      // The post chain already outputs display-ready sRGB; the raw path is linear.
      const encode = withPost
        ? (v: number) => v
        : (v: number) => {
            const c = v / 255;
            return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
          };
      // WebGL readbacks are bottom-up; WebGPU's are top-down.
      const flip = this.backendName === 'WebGL2';
      for (let y = 0; y < height; y++) {
        const srcY = flip ? height - 1 - y : y;
        for (let x = 0; x < width; x++) {
          const s = (srcY * width + x) * 4;
          const d = (y * width + x) * 4;
          img.data[d] = encode(buf[s]);
          img.data[d + 1] = encode(buf[s + 1]);
          img.data[d + 2] = encode(buf[s + 2]);
          img.data[d + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.92);
    } finally {
      this.capturing = false;
    }
  }
}
