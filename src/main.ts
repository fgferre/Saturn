/** Entry point: wires engine, scene, simulation clock, camera and UI. */

import { Vector3 } from 'three';
import { Engine } from './core/Engine.ts';
import { SimClock } from './core/SimClock.ts';
import { SaturnSystem } from './scene/SaturnSystem.ts';
import { createSky, createStarfield } from './scene/Starfield.ts';
import { Sun } from './scene/Sun.ts';
import { loadAllMaps } from './materials/textures.ts';
import { FocusControls } from './camera/FocusControls.ts';
import { sunDirectionAt } from './data/sunDirection.ts';
import {
  eRingVisUniform, edgeOnUniform, slabVisUniform, sunDirUniform,
  sunVisibilityUniform,
} from './materials/sharedUniforms.ts';
import { saturnShadowOnMoon } from './physics/eclipse.ts';
import { KM_PER_UNIT, MOONS, SATURN } from './data/saturn.ts';
import { Hud } from './ui/hud.ts';
import { BodyLabels } from './ui/labels.ts';

async function boot(): Promise<void> {
  const container = document.getElementById('app')!;
  const engine = await Engine.create(container);
  const { scene, camera } = engine;

  const clock = new SimClock();
  const maps = await loadAllMaps();
  const system = new SaturnSystem(maps);
  // GPU particle systems: seed once, then integrate every frame.
  for (const p of system.plumeSystems) {
    await engine.computeOnce(p.init);
    engine.addCompute(p.update);
  }
  const sun = new Sun();
  // Real NASA starmap sky when available, procedural starfield otherwise.
  scene.add(system.group, sun.group, maps.starmap ? createSky(maps.starmap) : createStarfield());

  system.update(clock.jd);

  // Camera: cinematic opening framing on the sunlit side, on the same side of
  // the ring plane as the Sun so the rings show their lit face.
  {
    const sd = sunDirectionAt(clock.jd, new Vector3());
    const azimuth = Math.atan2(sd.z, sd.x) + 0.5;
    const dist = 330;
    const camY = Math.sign(sd.y || -1) * 80;
    camera.position.set(Math.cos(azimuth) * dist, camY, Math.sin(azimuth) * dist);
  }
  const getPos = (id: string, out: Vector3) => system.getBodyPosition(id, out);
  const getRadius = (id: string) =>
    (system.bodies.get(id)?.def.physical.radiusKm ?? 60268) / KM_PER_UNIT;
  const controls = new FocusControls(camera, engine.renderer.domElement, getPos, getRadius);
  // Saturn deserves a wider default framing than a moon.
  controls.controls.minDistance = getRadius('saturn') * 1.35;

  const allBodies = [SATURN, ...MOONS];
  const byId = new Map(allBodies.map((b) => [b.id, b]));

  const focusBody = (id: string): void => {
    controls.focus(id);
    hud.setFocused(id);
    hud.setInfo(byId.get(id)!);
  };

  const hud = new Hud(allBodies, engine.backendName, {
    onFocus: focusBody,
    onSpeed: (v) => { clock.speed = v; },
    onPause: (p) => { clock.paused = p; },
    onNow: () => clock.setNow(),
    onToggleOrbits: (v) => system.setOrbitsVisible(v),
    onToggleLabels: (v) => { labels.visible = v; },
    onToggleDrift: (v) => {
      controls.controls.autoRotate = v;
      controls.controls.autoRotateSpeed = 0.12;
    },
    onExposure: (v) => { engine.renderer.toneMappingExposure = v; },
  });
  const labels = new BodyLabels(allBodies, focusBody);
  hud.setFocused('saturn');
  hud.setInfo(SATURN);

  const sunDir = new Vector3();
  const camDist = new Vector3();
  let fpsAccum = 0;
  let fpsFrames = 0;

  const frame = (dt: number): void => {
    clock.update(dt);
    for (const p of system.plumeSystems) p.dt.value = dt;

    sunDirectionAt(clock.jd, sunDir);
    sunDirUniform.value.copy(sunDir);
    sun.update(sunDir);

    system.update(clock.jd, sunDir);
    controls.update(dt);
    labels.update(camera, getPos, controls.focusId);

    // Lens flare gating: how much of the sun does the camera actually see?
    // (Same occlusion math as moon eclipses: Saturn's ellipsoid + ring alpha.)
    sunVisibilityUniform.value = saturnShadowOnMoon(
      camera.position, sunDir, system.ringProfile.opacityAt,
    );

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

    hud.setDate(clock.date);
    // Refresh camera-distance stat cheaply (twice a second with the FPS meter).
    fpsAccum += dt;
    fpsFrames++;
    if (fpsAccum >= 0.5) {
      hud.setFps(fpsFrames / fpsAccum);
      fpsAccum = 0;
      fpsFrames = 0;
      const focused = byId.get(controls.focusId)!;
      getPos(controls.focusId, camDist);
      hud.setInfo(focused, camDist.sub(camera.position).length() * KM_PER_UNIT);
    }
  };

  engine.start(frame);

  // Dev/testing hook: drive frames manually (headless tabs never fire rAF).
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__saturn = {
      engine, system, clock, controls, focusBody,
      step: async (dt = 1 / 60) => { frame(dt); await engine.renderOnce(); },
    };
  }
}

boot().catch((err) => {
  console.error(err);
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#dfe6ee;font-family:system-ui;background:#000;padding:24px;text-align:center';
  el.innerHTML = `<div><h2>Unable to start renderer</h2><p>This simulation needs WebGPU or WebGL2.<br>${String(err)}</p></div>`;
  document.body.appendChild(el);
});
