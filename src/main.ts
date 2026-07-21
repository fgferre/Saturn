/** Entry point: wires engine, scene, simulation clock, camera and UI. */

import { Vector3 } from 'three';
import { Engine } from './core/Engine.ts';
import { SimClock } from './core/SimClock.ts';
import { SaturnSystem } from './scene/SaturnSystem.ts';
import { createSky, createStarfield, followCamera } from './scene/Starfield.ts';
import { Sun } from './scene/Sun.ts';
import { loadAllMaps } from './materials/textures.ts';
import { FocusControls } from './camera/FocusControls.ts';
import { sunDirectionAt } from './data/sunDirection.ts';
import {
  eRingVisUniform, edgeOnUniform, slabVisUniform, sunDirUniform,
  sunVisibilityUniform,
} from './materials/sharedUniforms.ts';
import {
  solarAtmosphereTint, sunVisibilityFromCamera,
} from './physics/eclipse.ts';
import { solarTintUniform } from './scene/Sun.ts';
import { KM_PER_UNIT, MOONS, SATURN } from './data/saturn.ts';
import { Hud, SPEED_VALUES } from './ui/hud.ts';
import { BodyLabels, occludedBySaturn } from './ui/labels.ts';
import { Cinema } from './ui/cinema.ts';
import { autoTuneDown, quality, setBeforeReload } from './core/quality.ts';
import {
  FOV_DEFAULT, FOV_MAX, FOV_MIN,
  offsetToSpherical, parseState, serializeState, sphericalToOffset,
  type UrlState,
} from './core/urlState.ts';

/**
 * Force an immediate write of the shareable URL, bypassing the 1 Hz throttle.
 * Wired up during boot; features that mutate then reload/copy (Share, preset
 * reload) call this so the URL is current before they read `location.href`.
 */
let flushUrlImpl: (() => void) | null = null;
export function flushUrl(): void {
  flushUrlImpl?.();
}

/** Simulated UTC time as `YYYYMMDDTHHMMSS` for photo filenames. */
function photoStamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/[-:]/g, '');
}

async function boot(): Promise<void> {
  const container = document.getElementById('app')!;
  const boot = document.getElementById('boot');
  const bootBar = boot?.querySelector<HTMLElement>('.boot-bar') ?? null;
  const bootStatus = boot?.querySelector<HTMLElement>('.boot-status') ?? null;

  const engine = await Engine.create(container);
  const { scene, camera } = engine;

  const clock = new SimClock();
  // F8.3 — restore shareable state from the URL. Time/speed are applied now so
  // the first system.update and opening framing use the shared epoch; focus and
  // camera pose are applied once the controls/HUD exist (below).
  const initialUrl = parseState(location.search);
  if (initialUrl.jd !== undefined) clock.jd = initialUrl.jd;
  if (initialUrl.speed !== undefined) clock.speed = initialUrl.speed;

  const maps = await loadAllMaps((d, t) => {
    if (bootBar) bootBar.style.width = `${Math.round((d / t) * 100)}%`;
    if (bootStatus) bootStatus.textContent = `Loading Cassini maps… ${d}/${t}`;
  });
  const system = new SaturnSystem(maps);
  // GPU particle systems: seed once, then integrate every frame — but only
  // while the camera is near Enceladus (F8.5 cost gate). The compute handle
  // lets the frame loop flip the pass on/off.
  const plumeGates: {
    p: (typeof system.plumeSystems)[number];
    handle: ReturnType<typeof engine.addCompute>;
  }[] = [];
  for (const p of system.plumeSystems) {
    await engine.computeOnce(p.init);
    plumeGates.push({ p, handle: engine.addCompute(p.update) });
  }
  const sun = new Sun();
  // Real NASA starmap sky when available, procedural starfield otherwise.
  // Onda 3: background is camera-centered every frame (no parallax / reach).
  const sky = maps.starmap ? createSky(maps.starmap) : createStarfield();
  scene.add(system.group, sun.group, sky);

  system.update(clock.jd);

  // Camera: cinematic opening framing. Offset ~1.15 rad around from the Sun's
  // azimuth so the terminator sweeps across the disk (a hero shot, not a flat
  // fully-lit face that blooms into a white blob), and enough elevation to open
  // the rings — on the Sun's side of the ring plane so their lit face shows.
  {
    const sd = sunDirectionAt(clock.jd, new Vector3());
    const azimuth = Math.atan2(sd.z, sd.x) + 1.15;
    const horiz = 330;
    const camY = Math.sign(sd.y || -1) * 155;
    camera.position.set(Math.cos(azimuth) * horiz, camY, Math.sin(azimuth) * horiz);
  }
  const getPos = (id: string, out: Vector3) => system.getBodyPosition(id, out);
  const getRadius = (id: string) =>
    (system.bodies.get(id)?.def.physical.radiusKm ?? 60268) / KM_PER_UNIT;
  const controls = new FocusControls(camera, engine.renderer.domElement, getPos, getRadius);
  // Saturn deserves a wider default framing than a moon.
  controls.controls.minDistance = getRadius('saturn') * 1.35;

  // F8.7 — FOV / telephoto. Set the base camera's lens (copyCameraPose then
  // propagates it to the bloom/solar cameras each frame). Rotate speed scales
  // with the lens so a long lens pans slowly for the same drag, like a real
  // telephoto. Callers schedule the URL write themselves.
  const applyFov = (deg: number): void => {
    const fov = Math.max(FOV_MIN, Math.min(FOV_MAX, deg));
    camera.fov = fov;
    camera.updateProjectionMatrix();
    controls.controls.rotateSpeed = fov / FOV_DEFAULT;
  };

  const allBodies = [SATURN, ...MOONS];
  const byId = new Map(allBodies.map((b) => [b.id, b]));

  // --- F8.3 shareable URL: write current pose with a 1 Hz throttle ----------
  const urlBodyScratch = new Vector3();
  const currentUrlState = (): UrlState => {
    getPos(controls.focusId, urlBodyScratch);
    const cam = offsetToSpherical(
      camera.position.x - urlBodyScratch.x,
      camera.position.y - urlBodyScratch.y,
      camera.position.z - urlBodyScratch.z,
    );
    cam.fov = camera.fov;
    return { focus: controls.focusId, jd: clock.jd, speed: clock.speed, cam };
  };
  const writeUrl = (): void => {
    // Preserve QA/debug params (?post, ?webgl, ?qa, ?quality, ?notune); only
    // our own keys are rewritten. Quality stays out of the URL (localStorage).
    const params = new URLSearchParams(location.search);
    for (const k of ['focus', 'jd', 'speed', 'cam']) params.delete(k);
    for (const [k, v] of new URLSearchParams(serializeState(currentUrlState()))) {
      params.set(k, v);
    }
    const qs = params.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  };
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  let urlLastWrite = 0;
  const scheduleUrlWrite = (): void => {
    const elapsed = performance.now() - urlLastWrite;
    if (elapsed >= 1000) {
      if (urlTimer !== undefined) { clearTimeout(urlTimer); urlTimer = undefined; }
      urlLastWrite = performance.now();
      writeUrl();
    } else if (urlTimer === undefined) {
      urlTimer = setTimeout(() => {
        urlTimer = undefined;
        urlLastWrite = performance.now();
        writeUrl();
      }, 1000 - elapsed);
    }
  };
  flushUrlImpl = (): void => {
    if (urlTimer !== undefined) { clearTimeout(urlTimer); urlTimer = undefined; }
    urlLastWrite = performance.now();
    writeUrl();
  };
  // A preset change reloads the page (quality.ts); flush first so the reload
  // restores pose + date + focus instead of teleporting to the opening framing.
  setBeforeReload(flushUrl);
  // Camera pose changes: write when the drag/zoom interaction ends, not per frame.
  controls.controls.addEventListener('end', scheduleUrlWrite);

  const focusBody = (id: string): void => {
    controls.focus(id);
    hud.setFocused(id);
    hud.setInfo(byId.get(id)!);
    scheduleUrlWrite();
  };

  // F8.2 — save a high-res PNG of the current view. Two robustness measures:
  //   • DPR policy: capture(1920) upscales (blurry) when the drawing buffer is
  //     narrower than 1920 (common at DPR=1). Bump the effective pixel ratio so
  //     the buffer is ≥ 1920 wide, render native, then restore. The DPR change
  //     happens AROUND capture(), never inside it (capture calling setSize is a
  //     PassNode black-frame regression, forbidden by wave4 selfcheck).
  //   • DOF-clean: the full-post DOF blurs the whole frame whenever the aperture
  //     is nonzero (close fly-bys), so force it to 0 for the shot and restore.
  const PHOTO_WIDTH = 1920;
  const savePhoto = async (): Promise<void> => {
    const cssWidth = container.clientWidth || 1280;
    const prevDpr = engine.renderer.getPixelRatio();
    const prevAperture = engine.dofAperture.value;
    const photoDpr = Math.max(prevDpr, PHOTO_WIDTH / cssWidth);
    try {
      engine.dofAperture.value = 0;
      if (photoDpr !== prevDpr) engine.renderer.setPixelRatio(photoDpr);
      const dataUrl = await engine.capture(PHOTO_WIDTH, true);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `saturn_${photoStamp(clock.date)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      if (photoDpr !== prevDpr) engine.renderer.setPixelRatio(prevDpr);
      engine.dofAperture.value = prevAperture;
    }
  };

  // F8.8 — record a fixed-length WebM of the live canvas via MediaRecorder over
  // captureStream. Unlike Photo, this NEVER freezes the frame loop (no
  // engine.capture) — a frozen loop yields a static video — so it uses its own
  // `recording` guard, entirely separate from Engine's capture path. Pick the
  // best supported WebM codec once at boot; null means the host can't record,
  // and the HUD hides the button.
  const RECORD_MS = 10000;
  const videoCanvas = engine.renderer.domElement as HTMLCanvasElement;
  const videoMime = ((): string | null => {
    if (
      typeof MediaRecorder === 'undefined' ||
      typeof videoCanvas.captureStream !== 'function'
    ) return null;
    for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* older impls throw */ }
    }
    return null;
  })();
  let recording = false;
  const recordVideo = (): Promise<void> => new Promise<void>((resolve, reject) => {
    if (!videoMime || recording) { resolve(); return; }
    recording = true;
    try {
      const stream = videoCanvas.captureStream(60);
      const rec = new MediaRecorder(stream, { mimeType: videoMime });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onerror = () => { recording = false; reject(new Error('MediaRecorder error')); };
      rec.onstop = () => {
        recording = false;
        const url = URL.createObjectURL(new Blob(chunks, { type: videoMime }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `saturn_${photoStamp(clock.date)}.webm`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        resolve();
      };
      rec.start();
      setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, RECORD_MS);
    } catch (err) {
      recording = false;
      reject(err);
    }
  });

  const hud = new Hud(allBodies, engine.backendName, {
    onFocus: focusBody,
    onSpeed: (v) => { clock.speed = v; scheduleUrlWrite(); },
    onPause: (p) => { clock.paused = p; scheduleUrlWrite(); },
    onNow: () => { clock.setNow(); scheduleUrlWrite(); },
    onDate: (jd) => { clock.jd = jd; scheduleUrlWrite(); },
    onShare: () => { flushUrl(); return location.href; },
    onToggleOrbits: (v) => system.setOrbitsVisible(v),
    onToggleLabels: (v) => { labels.visible = v; },
    onToggleDrift: (v) => {
      controls.controls.autoRotate = v;
      controls.controls.autoRotateSpeed = 0.12;
    },
    onExposure: (v) => { engine.renderer.toneMappingExposure = v; },
    onFov: (v) => { applyFov(v); scheduleUrlWrite(); },
    onCinema: () => cinema.enter(),
    onPhoto: savePhoto,
    onRecord: videoMime ? recordVideo : undefined,
  });

  // Cinema mode (HUD fades, slow drift, timed tour) lives in its own module
  // and owns the Esc-to-exit listener.
  const cinema = new Cinema({ controls, focusBody });
  const labels = new BodyLabels(allBodies, focusBody);
  hud.setFocused('saturn');
  hud.setInfo(SATURN);

  // F8.3 — apply the restored focus, camera pose and speed now that the
  // controls/HUD exist. Unknown ids fall through to the default framing.
  if (initialUrl.speed !== undefined) hud.setSpeed(clock.speed);
  if (initialUrl.focus !== undefined && byId.has(initialUrl.focus)) {
    const id = initialUrl.focus;
    if (initialUrl.cam) {
      const [ox, oy, oz] = sphericalToOffset(
        initialUrl.cam.az, initialUrl.cam.el, initialUrl.cam.dist,
      );
      controls.snap(id, urlBodyScratch.set(ox, oy, oz));
    } else {
      controls.focus(id);
    }
    hud.setFocused(id);
    hud.setInfo(byId.get(id)!);
  }
  // F8.7 — restore the shared lens (4th cam component). Independent of focus.
  if (initialUrl.cam?.fov !== undefined) {
    applyFov(initialUrl.cam.fov);
    hud.setFov(camera.fov);
  }

  // --- Global keyboard shortcuts (Esc handled inside Cinema) ---
  // Ignore key events aimed at focusable controls so typing/activating them
  // never doubles as a shortcut.
  const hudRoot = document.getElementById('hud');
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    switch (e.key) {
      case ' ': // Space: pause / resume, kept in sync with the HUD button.
        e.preventDefault();
        clock.paused = !clock.paused;
        hud.setPaused(clock.paused);
        scheduleUrlWrite();
        break;
      case '[':
      case ']': { // Step through the speed presets, highlighting the HUD.
        const dir = e.key === ']' ? 1 : -1;
        let i = SPEED_VALUES.indexOf(clock.speed);
        if (i < 0) i = SPEED_VALUES.indexOf(3600);
        i = Math.max(0, Math.min(SPEED_VALUES.length - 1, i + dir));
        clock.speed = SPEED_VALUES[i];
        hud.setSpeed(clock.speed);
        scheduleUrlWrite();
        break;
      }
      case 'h':
      case 'H': // Toggle HUD visibility.
        hudRoot?.classList.toggle('hud-hidden');
        break;
      case 'f':
      case 'F': // Toggle fullscreen.
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
        else document.exitFullscreen?.();
        break;
      case '?': // Toggle the keyboard/mouse help overlay.
        e.preventDefault();
        hud.toggleHelp();
        break;
      case 'Escape': // Close help if it's open (Cinema owns Esc otherwise).
        if (hud.helpOpen) { e.preventDefault(); hud.closeHelp(); }
        break;
    }
  });

  // --- F8.7 click-to-focus (picking) ---------------------------------------
  // A click that didn't drag (< DRAG_SLOP px) projects every body centre to the
  // screen and focuses the nearest one under the cursor. Hit radius is the
  // larger of a fixed pixel pad and the body's projected radius, so tiny distant
  // moons are still clickable while a close globe is picked across its whole
  // disk. Bodies hidden behind Saturn are ignored (same test as the labels).
  const canvas = engine.renderer.domElement;
  const DRAG_SLOP = 5;
  const HIT_PAD = 24;
  const pickScratch = new Vector3();
  let downX = 0;
  let downY = 0;
  const pickAt = (px: number, py: number, rect: DOMRect): void => {
    // Mid-flight the pose is interpolated (controls disabled) — don't hijack it.
    if (!controls.controls.enabled) return;
    const halfH = rect.height / 2;
    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const def of allBodies) {
      const id = def.id;
      if (id === controls.focusId) continue; // already framed
      const world = getPos(id, pickScratch);
      const dist = world.distanceTo(camera.position);
      if (id !== 'saturn' && occludedBySaturn(camera.position, world)) continue;
      world.project(camera); // mutates pickScratch → NDC
      if (pickScratch.z > 1) continue; // behind the camera
      const sx = (pickScratch.x * 0.5 + 0.5) * rect.width;
      const sy = (-pickScratch.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - px, sy - py);
      const projRadius = (getRadius(id) / (dist * tanHalfFov)) * halfH;
      if (d <= Math.max(HIT_PAD, projRadius) && d < bestD) { bestD = d; bestId = id; }
    }
    if (bestId) focusBody(bestId);
  };
  canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
  canvas.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) >= DRAG_SLOP) return; // was a drag
    const rect = canvas.getBoundingClientRect();
    pickAt(e.clientX - rect.left, e.clientY - rect.top, rect);
  });

  const sunDir = new Vector3();
  const camDist = new Vector3();
  const infoScratch = new Vector3();
  const enceladusPos = new Vector3();
  // F8.5 plume gate: integrate the geysers only when the camera is within
  // NEAR units of Enceladus. WARM-UP TRAP — the opening camera sits ≥92 u
  // away, so the compute is born disabled and the particles are frozen at the
  // seed. On the rising edge (camera arrives) run a burst of steps spread over
  // a few frames so the plume is already in steady state, never an "eruption
  // beginning". Lives are 5–10 s, staggered down to −9 s, so ~150 steps at the
  // frame dt cap (0.1 s) covers a full spawn cycle plus margin.
  const PLUME_NEAR = 40;
  let plumeWasNear = false;
  let plumeWarmup = 0;
  const solarTintScratch = new Vector3(1, 1, 1);
  /** Moon disks for solar-eclipse glare gating (rebuilt each frame). */
  const moonDisks: { pos: Vector3; radius: number }[] = MOONS.map(() => ({
    pos: new Vector3(), radius: 0,
  }));
  // F7.2 temporal smooth of glare visibility (~10 Hz half-life → no ring-edge pop).
  let sunVisSmoothed = 1;
  const SUN_VIS_HALF_LIFE = 0.1;
  let fpsAccum = 0;
  let fpsFrames = 0;
  // One-shot auto-tuner: measure the first seconds, step down if struggling.
  let tuneAccum = 0;
  let tuneFrames = 0;
  let tuned = false;

  const frame = (dt: number): void => {
    clock.update(dt);
    for (const p of system.plumeSystems) p.dt.value = dt;

    sunDirectionAt(clock.jd, sunDir);
    sunDirUniform.value.copy(sunDir);

    // 1) Bodies first, 2) final camera pose, 3) sun/sky on that pose, 4) render.
    // (Onda 3 B2: never place the disk/sky before controls.update.)
    system.update(clock.jd, sunDir);
    controls.update(dt);
    cinema.update(dt);

    // F8.5 — gate the Enceladus plume compute + sprite by camera distance.
    const plumeNear =
      system.getBodyPosition('enceladus', enceladusPos).distanceTo(camera.position)
        < PLUME_NEAR;
    if (plumeNear && !plumeWasNear) plumeWarmup = 150; // rising edge: warm up
    plumeWasNear = plumeNear;
    for (const g of plumeGates) g.handle.enabled = plumeNear;
    for (const p of system.plumeSystems) p.mesh.visible = plumeNear;
    if (plumeWarmup > 0) {
      // Advance the sim toward steady state, ~25 steps/frame, at the dt cap so
      // a full spawn cycle is covered in a handful of frames (imperceptible).
      const steps = Math.min(25, plumeWarmup);
      for (const p of system.plumeSystems) p.dt.value = 0.1;
      for (let s = 0; s < steps; s++) {
        for (const g of plumeGates) engine.renderer.compute(g.p.update as never);
      }
      plumeWarmup -= steps;
      for (const p of system.plumeSystems) p.dt.value = dt; // restore real dt
    }

    // Shared infinite direction: disk, seed, DirectionalLight, occlusion gate.
    sun.update(sunDir, camera.position);
    followCamera(sky, camera.position);

    labels.update(camera, getPos, controls.focusId);

    // DOF tracks the focused body; aperture scaled so distant framings stay
    // sharp and close fly-bys get shallow focus.
    if (quality.dof) {
      const focusDist = camera.position.distanceTo(controls.controls.target);
      engine.dofFocus.value = focusDist;
      // The DOF node's blur grows linearly with |distance - focus| up to
      // maxblur, so ANY nonzero aperture eventually blurs the far field
      // (stars). True hyperfocal: aperture is exactly 0 except on close
      // fly-bys, where shallow focus is the cinematic point.
      const f = Math.max(focusDist, 2);
      engine.dofAperture.value = f < 25 ? Math.min(0.01, 0.05 / (f * f)) : 0;
    }

    // Auto-tune: after ~4 s of real rendering, step down once if needed.
    if (!tuned) {
      tuneAccum += dt;
      tuneFrames++;
      if (tuneAccum > 4) {
        tuned = true;
        autoTuneDown(tuneFrames / tuneAccum);
      }
    }

    // Glare gate: Saturn + rings + moons (solar eclipses), temporally smoothed.
    for (let i = 0; i < MOONS.length; i++) {
      const def = MOONS[i];
      system.getBodyPosition(def.id, moonDisks[i].pos);
      moonDisks[i].radius = def.physical.radiusKm / KM_PER_UNIT;
    }
    const visTarget = sunVisibilityFromCamera(
      camera.position, sunDir, system.ringProfile.opacityAt, moonDisks,
    );
    const k = 1 - Math.exp((-dt * Math.LN2) / SUN_VIS_HALF_LIFE);
    sunVisSmoothed += (visTarget - sunVisSmoothed) * k;
    sunVisibilityUniform.value = sunVisSmoothed;

    // F7.5 — atmosphere transmittance only (no × vis). Disk and the whole
    // solar glare chain multiply tint × sunVisibility separately so colour
    // and extinction stay in lockstep without accidental vis².
    solarAtmosphereTint(camera.position, sunDir, solarTintScratch);
    solarTintUniform.value.copy(solarTintScratch);

    // Ring-plane proximity factors: edge-on rim ribbon + fly-through slab.
    const camLen = Math.max(camera.position.length(), 1e-3);
    const sinElev = Math.abs(camera.position.y) / camLen;
    const camR = Math.hypot(camera.position.x, camera.position.z);
    const overRings = camR > 55 && camR < 160 ? 1 : 0;
    edgeOnUniform.value = (1 - Math.min(1, sinElev / 0.01)) * 0.25;
    slabVisUniform.value =
      Math.max(0, 1 - Math.abs(camera.position.y) / 1.6) * overRings;
    // E ring: a diffuse torus looks wrong from inside — fade it out there.
    const eRingProximity = Math.max(
      Math.abs(camR - 238) / 90, Math.abs(camera.position.y) / 25,
    );
    eRingVisUniform.value = Math.min(1, eRingProximity);

    // F8.5 — skip the slab/E-ring draw entirely when their fade uniform is
    // ~zero (opacity would be invisible anyway; this drops the vertex work).
    system.slabMesh.visible = slabVisUniform.value > 0.01;
    system.eRingMesh.visible = eRingVisUniform.value > 0.01;

    hud.setDate(clock.date);
    // Refresh camera-distance stat cheaply (twice a second with the FPS meter).
    fpsAccum += dt;
    fpsFrames++;
    if (fpsAccum >= 0.5) {
      hud.setFps(fpsFrames / fpsAccum);
      fpsAccum = 0;
      fpsFrames = 0;
      const id = controls.focusId;
      const focused = byId.get(id)!;
      getPos(id, infoScratch); // body world position
      const distUnits = infoScratch.distanceTo(camera.position);
      const radiusUnits = focused.physical.radiusKm / KM_PER_UNIT;
      const apparentDeg =
        (2 * Math.atan(radiusUnits / Math.max(distUnits, 1e-6)) * 180) / Math.PI;
      // Phase angle at the body between the camera and the Sun.
      camDist.copy(camera.position).sub(infoScratch).normalize();
      const phaseDeg =
        (Math.acos(Math.max(-1, Math.min(1, camDist.dot(sunDir)))) * 180) / Math.PI;
      // Sunlight reaching the body (umbra / ring shadow). Saturn has no slot.
      const el = system.bodies.get(id)?.eclipseLight;
      hud.setInfo(focused, {
        distanceKm: distUnits * KM_PER_UNIT,
        apparentDeg,
        phaseDeg,
        sunlightPct: el ? el.value * 100 : undefined,
      });
    }
  };

  engine.start(frame);

  // Reveal the scene once the first frame is on screen. Prefer a double-rAF
  // (paints under the overlay first), but a stuck loading screen is the worst
  // failure mode — so a timer fallback fires the same idempotent reveal even if
  // rAF is throttled (page loaded in a background tab).
  if (boot) {
    if (bootStatus) bootStatus.textContent = 'Ready';
    const reveal = (): void => {
      if (boot.classList.contains('done')) return;
      boot.classList.add('done');
      setTimeout(() => boot.remove(), 1000);
    };
    requestAnimationFrame(() => requestAnimationFrame(reveal));
    setTimeout(reveal, 1500);
  }

  // Dev/testing hook: drive frames manually (headless tabs never fire rAF).
  // ?qa=1 exposes the same hook in production builds so smoke tests exercise
  // the real bundle (BASE_URL, minification, preload).
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('qa')) {
    (window as unknown as Record<string, unknown>).__saturn = {
      engine, system, clock, controls, focusBody, flushUrl,
      step: async (dt = 1 / 60) => { frame(dt); await engine.renderOnce(); },
      sunVisibility: () => sunVisibilityUniform.value,
    };
  }
}

boot().catch((err) => {
  // Replace the loading overlay (don't stack the error under it).
  document.getElementById('boot')?.remove();
  console.error(err);
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#dfe6ee;font-family:system-ui;background:#000;padding:24px;text-align:center';
  el.innerHTML = `<div><h2>Unable to start renderer</h2><p>This simulation needs WebGPU or WebGL2.<br>${String(err)}</p></div>`;
  document.body.appendChild(el);
});
