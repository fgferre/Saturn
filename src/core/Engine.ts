/**
 * Rendering engine: WebGPU with automatic WebGL2 fallback (three's
 * WebGPURenderer handles the downgrade internally), ACES tone mapping and a
 * TSL bloom post-processing chain.
 *
 * Onda 3 final composition (review architecture):
 *
 *   base camera   : layers 0 + DISPLAY_SUN_LAYER
 *                   → system + display sun share one depth buffer (occlusion)
 *   bloom camera  : layer 0 only
 *                   → beautyBloom never samples the display sun (no square halo)
 *   solar camera  : SOLAR_LAYER only
 *                   → seed glare (round profile) + optional lensflare
 *                     × solarTint × sunVisibility
 *
 *   comp = basePass + beautyBloom + solar glare chain
 *
 * `?post=raw|bloom|anamorphic|flare|full` for controlled A/B (default full).
 * Solar anamorphic streak removed (F7 delta final) — beads/blue bar vs warm sun.
 */

import { AgXToneMapping, PerspectiveCamera, RenderTarget, Scene, Vector2 } from 'three';
import { PostProcessing, WebGPURenderer } from 'three/webgpu';
import { clamp, float, oneMinus, pass, screenUV, uniform, vec2, vec3 } from 'three/tsl';
import type { ShaderNodeObject } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { sunVisibilityUniform } from '../materials/sharedUniforms.ts';
import { DISPLAY_SUN_LAYER, SOLAR_LAYER, solarTintUniform } from '../scene/Sun.ts';
import { quality } from './quality.ts';

/** Post A/B modes for QA (`?post=`). `anamorphic` kept as alias of full solar glow. */
export type PostMode = 'raw' | 'bloom' | 'anamorphic' | 'flare' | 'full';

/** Handle returned by `addCompute`; flip `enabled` to gate a compute pass. */
export interface ComputeHandle {
  enabled: boolean;
}

function postModeFromUrl(): PostMode {
  const v = new URLSearchParams(location.search).get('post');
  if (v === 'raw' || v === 'bloom' || v === 'anamorphic' || v === 'flare' || v === 'full') {
    return v;
  }
  return 'full';
}

function copyCameraPose(src: PerspectiveCamera, dst: PerspectiveCamera): void {
  dst.position.copy(src.position);
  dst.quaternion.copy(src.quaternion);
  dst.fov = src.fov;
  dst.aspect = src.aspect;
  dst.near = src.near;
  dst.far = src.far;
  dst.zoom = src.zoom;
  dst.updateProjectionMatrix();
  dst.updateMatrixWorld();
}

export class Engine {
  readonly renderer: WebGPURenderer;
  readonly scene = new Scene();
  /**
   * Base / navigation camera: layers 0 + DISPLAY_SUN_LAYER so the disk is
   * depth-tested against Saturn, rings and moons.
   */
  readonly camera: PerspectiveCamera;
  /** Bloom source: layer 0 only (no display sun). */
  readonly bloomCamera: PerspectiveCamera;
  /** Solar-seed camera: SOLAR_LAYER only — feeds the lens chain. */
  readonly solarCamera: PerspectiveCamera;
  readonly backendName: 'WebGPU' | 'WebGL2';
  readonly postMode: PostMode;
  /** DOF focus distance (view-space) and aperture, fed per frame from main. */
  readonly dofFocus = uniform(300);
  readonly dofAperture = uniform(0.0);
  private readonly post: PostProcessing;

  private constructor(renderer: WebGPURenderer, container: HTMLElement) {
    this.renderer = renderer;
    container.appendChild(renderer.domElement);
    this.postMode = postModeFromUrl();

    // Zero-size containers happen in hidden/background tabs before layout.
    const width = container.clientWidth || 1280;
    const height = container.clientHeight || 720;

    this.camera = new PerspectiveCamera(45, width / height, 0.05, 120000);
    this.camera.layers.disableAll();
    this.camera.layers.enable(0);
    this.camera.layers.enable(DISPLAY_SUN_LAYER);

    this.bloomCamera = new PerspectiveCamera(45, width / height, 0.05, 120000);
    this.bloomCamera.layers.set(0);

    this.solarCamera = new PerspectiveCamera(45, width / height, 0.05, 120000);
    this.solarCamera.layers.set(SOLAR_LAYER);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.dprCap));
    renderer.setSize(width, height);
    // AgX: gentler highlight rolloff than ACES — closest to Cassini's
    // natural-color look (calibrated against PIA21345).
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1.4;

    // Base: system + display sun, shared depth (occlusion).
    const basePass = pass(this.scene, this.camera, { samples: quality.msaaSamples });

    // Beauty bloom source: layer 0 only — never the display sun.
    const bloomSrc = pass(this.scene, this.bloomCamera, { samples: 0 });
    const beautyBloom = bloom(bloomSrc, 0.35, 0.4, 0.9);

    // F7.2 — solar glare: round profile is *painted on the seed sprite*
    // (core + r⁻² skirt). Composite solarPass directly — no wide BloomNode
    // (mips → square lavender stacks on a point source). Optional tiny softener
    // only if needed; default path is seed-only.
    const solarPass = pass(this.scene, this.solarCamera, { samples: 0 });
    // Optional 1-px-ish soften (radius tiny); keeps ghosts round if used.
    const solarSoft = bloom(solarPass, 0.35, 0.12, 0.25);
    const solarSource = solarPass.add(solarSoft.mul(0.35));

    // Selective beauty bloom: base (depth-tested sun) + sun-free scene bloom.
    let comp: ShaderNodeObject<Node> = this.postMode === 'raw'
      ? basePass
      : basePass.add(beautyBloom);

    // DOF on the composite using base depth (sun already depth-tested).
    if (this.postMode === 'full' && quality.dof) {
      // DOF hardening (F8.2): the blur is a local average of the composite, so
      // a *bounded* circle-of-confusion can only soften — never wash the frame
      // to white. Two permanent guards make any nonzero aperture safe:
      //   • aperture clamped to [0, 0.012] — a negative value would swap
      //     near/far and blur the in-focus subject;
      //   • maxblur (the CoC cap) held to 0.006 UV so the far field (stars,
      //     the distant globe) survives regardless of the aperture fed in.
      // Close fly-bys still read as shallow focus (main feeds ≤ 0.01).
      const aperture = clamp(this.dofAperture, 0, 0.012);
      comp = dof(
        comp, basePass.getViewZNode(), this.dofFocus, aperture, float(0.006),
      );
    }

    // Solar glare: seed glow always (except raw); optional lensflare ghosts.
    // Anamorphic streak removed (F7 final): discrete beads + internal blue
    // fought the warm round glare (YAGNI — seed + flare carry the look).
    const wantSolarGlow = this.postMode !== 'raw';
    const wantFlare =
      quality.lensflare && (this.postMode === 'flare' || this.postMode === 'full');
    // One fade, one colour: solarGate = atmosphereTint × sunVisibility
    const solarGate = solarTintUniform.mul(sunVisibilityUniform);
    if (wantSolarGlow) {
      // Round warm glare from the seed profile (no wide BloomNode mips).
      comp = comp.add(solarSource.mul(solarGate).mul(0.95));
    }
    if (wantFlare) {
      comp = comp.add(
        lensflare(solarSource, { threshold: float(0.9), ghostSamples: float(3) })
          .mul(solarGate)
          .mul(vec3(1.0, 0.94, 0.82))
          .mul(0.18),
      );
    }

    // Cinematic finish (skip on pure raw A/B for cleaner metrics).
    if (this.postMode !== 'raw') {
      comp = chromaticAberration(comp, float(0.35), vec2(0.5, 0.5), float(1.008));
      const vignette = oneMinus(screenUV.sub(0.5).length().pow(2.2).mul(0.5));
      comp = comp.mul(vignette);
    }

    this.post = new PostProcessing(renderer);
    this.post.outputNode =
      quality.filmGrain > 0 && this.postMode === 'full'
        ? film(comp, float(quality.filmGrain))
        : comp;

    this.backendName = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
      ? 'WebGPU'
      : 'WebGL2';

    window.addEventListener('resize', () => {
      const w = container.clientWidth || 1280;
      const h = container.clientHeight || 720;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.bloomCamera.aspect = w / h;
      this.bloomCamera.updateProjectionMatrix();
      this.solarCamera.aspect = w / h;
      this.solarCamera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
  }

  static async create(container: HTMLElement): Promise<Engine> {
    // `?webgl` forces the WebGL2 backend (debugging / driver workarounds).
    const forceWebGL = new URLSearchParams(location.search).has('webgl');
    // No canvas antialias: MSAA happens on the scene pass (see constructor),
    // so the final quad present skips a useless 4x multisample+resolve.
    const renderer = new WebGPURenderer({ forceWebGL, powerPreference: 'high-performance' });
    await renderer.init();
    return new Engine(renderer, container);
  }

  private capturing = false;
  private readonly computes: { node: object; enabled: boolean }[] = [];

  /**
   * Keep bloom/solar cameras pose-identical to the base camera.
   * Call after the frame's final camera pose is known.
   */
  syncAuxCameras(): void {
    copyCameraPose(this.camera, this.bloomCamera);
    copyCameraPose(this.camera, this.solarCamera);
  }

  /**
   * Register a compute pass to run every frame (GPU particles etc.).
   * Returns a handle whose `enabled` flag gates the pass (start/renderOnce
   * skip disabled passes — the frame cost drops to zero when off-screen).
   */
  addCompute(node: object): ComputeHandle {
    const entry = { node, enabled: true };
    this.computes.push(entry);
    return entry;
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
      this.syncAuxCameras();
      for (const c of this.computes) if (c.enabled) this.renderer.compute(c.node as never);
      this.post.render();
    });
  }

  /** Render a single frame outside the rAF loop (headless testing). */
  async renderOnce(): Promise<void> {
    this.syncAuxCameras();
    for (const c of this.computes) if (c.enabled) await this.renderer.computeAsync(c.node as never);
    await this.post.renderAsync();
  }

  /**
   * QA capture of the current scene state (PNG).
   *
   * Always renders at the **current** drawing-buffer size (keeps PassNode
   * internal RTs valid — resizing mid-capture produced black frames on WebGPU),
   * then optionally downsamples to `width` via a 2D canvas.
   *
   * Output goes to an explicit RenderTarget + `readRenderTargetPixelsAsync`
   * (WebGL2-safe; no default-FB / preserveDrawingBuffer dependency).
   *
   * Does **not** advance compute passes. State restored in `finally`.
   */
  async capture(width = 1280, withPost = true): Promise<string> {
    this.capturing = true;
    const prevRT = this.renderer.getRenderTarget();
    let rt: RenderTarget | null = null;
    try {
      const cssSize = this.renderer.getSize(new Vector2());
      const dpr = this.renderer.getPixelRatio();
      // Drawing-buffer pixels (what PassNode / the GPU actually render into).
      const fullW = Math.max(1, Math.round(cssSize.x * dpr));
      const fullH = Math.max(1, Math.round(cssSize.y * dpr));

      this.syncAuxCameras();
      rt = new RenderTarget(fullW, fullH);
      this.renderer.setRenderTarget(rt);

      if (withPost) {
        await this.post.renderAsync();
      } else {
        await this.renderer.renderAsync(this.scene, this.camera);
      }

      const buf = (await this.renderer.readRenderTargetPixelsAsync(
        rt, 0, 0, fullW, fullH,
      )) as Uint8Array;

      // Pack full-res pixels into an ImageData canvas (handle WebGL Y-flip).
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = fullW;
      fullCanvas.height = fullH;
      const fullCtx = fullCanvas.getContext('2d')!;
      const img = fullCtx.createImageData(fullW, fullH);
      const encode = withPost
        ? (v: number) => v
        : (v: number) => {
            const c = v / 255;
            return Math.round(
              (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255,
            );
          };
      const flip = this.backendName === 'WebGL2';
      for (let y = 0; y < fullH; y++) {
        const srcY = flip ? fullH - 1 - y : y;
        for (let x = 0; x < fullW; x++) {
          const s = (srcY * fullW + x) * 4;
          const d = (y * fullW + x) * 4;
          img.data[d] = encode(buf[s]);
          img.data[d + 1] = encode(buf[s + 1]);
          img.data[d + 2] = encode(buf[s + 2]);
          img.data[d + 3] = 255;
        }
      }
      fullCtx.putImageData(img, 0, 0);

      // Optional downsample to the requested width (no renderer.setSize).
      const aspect = fullW / fullH;
      const outW = width;
      const outH = Math.max(1, Math.round(width / aspect));
      if (outW === fullW && outH === fullH) {
        return fullCanvas.toDataURL('image/png');
      }
      const outCanvas = document.createElement('canvas');
      outCanvas.width = outW;
      outCanvas.height = outH;
      const outCtx = outCanvas.getContext('2d')!;
      outCtx.imageSmoothingEnabled = true;
      outCtx.drawImage(fullCanvas, 0, 0, outW, outH);
      return outCanvas.toDataURL('image/png');
    } finally {
      this.renderer.setRenderTarget(prevRT);
      rt?.dispose();
      this.capturing = false;
    }
  }
}
