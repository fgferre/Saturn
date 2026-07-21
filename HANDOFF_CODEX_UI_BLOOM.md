# Handoff — two problems to investigate (UI panels + square bloom)

> For a fresh investigator (Codex) with no prior context on this repo. Two
> independent problems, both reproducible in the browser. Each section is
> self-contained: symptom → files → what was tried → root cause → directions →
> how to reproduce → done criteria.

---

## 0. Repo orientation (read first)

- **Stack:** TypeScript + Vite + three.js **r178**, rendered through
  `WebGPURenderer` (TSL node materials) with an automatic **WebGL2 fallback**.
  Real-time Saturn-system simulation. No UI framework — the HUD is vanilla DOM.
- **Run:** `npm run dev` (Vite dev server). `npm run build` = `tsc --noEmit +
  vite build`. `npm run check` = tsc on the selfcheck project + node selfchecks
  (`kepler` + `wave1..wave9`).
- **Hard gates:** every change must keep `npm run check` **and** `npm run build`
  green. The wave selfchecks are contracts — do not make them red "temporarily".
- **Render-budget rule** (`PLANO_MESTRE_AAA.md` §1.5): do **not** add new
  whole-scene render passes. Replacing an existing post node with a
  better-quality node of the same pass count is fine.
- **QA harness (how to see pixels):** in dev, `window.__saturn` exposes
  `{ engine, system, clock, controls, focusBody, step(dt), sunVisibility() }`.
  Drive frames with `await __saturn.step(1/60)` (the rAF loop is throttled in
  background tabs), capture with `await __saturn.engine.capture(width, withPost)`
  which returns a PNG data-URL, and (dev only) `POST` that data-URL to `/__shot`
  to write `shot.jpg` to the repo root for inspection.
  **Important:** in the current test browser the **WebGPU** context has degraded
  (renders black after many dev-server restarts); use the **WebGL2** backend for
  visual QA by loading `http://localhost:<port>/?webgl`. Same TSL shaders, same
  post chain — the artifacts reproduce identically on both backends.
- **Post A/B modes:** `?post=raw|bloom|anamorphic|flare|full` (default `full`)
  select subsets of the post chain — invaluable for isolating which node causes
  an artifact. `raw` = scene only; `bloom` = + beauty bloom; `full` = everything.

---

## Problem 1 — Right-side HUD panels overlap and can't be toggled

**Symptom:** With the Info panel (top-right) plus the Postcards and Events
panels (bottom-right) all populated, the panels **overlap** each other and the
3D body labels bleed through them. There is **no way to close/collapse and
reopen** Events or Postcards like windows — they are always shown when
non-empty, so on a tall viewport they run into the Info panel. (Screenshot from
the user shows Postcards/Events stacked over the Saturn info panel, with
PROMETHEUS/JANUS/PANDORA labels showing through.)

**Files:**
- `src/ui/hud.ts` — builds all panels. Relevant: the Info panel (`.hud-info`),
  the right column (`.hud-right`) that stacks `.hud-postcards` above
  `.hud-events`, `setPostcards(cards, onSelect)`, `setEvents(...)`. The body
  list is `.hud-bodies`.
- `src/ui/hud.css` — positioning:
  - `.hud-info { position:absolute; top:16px; right:16px; width:264px; }` (grows
    **downward** from the top).
  - `.hud-right { position:absolute; right:16px; bottom:18px; }` — the
    Events+Postcards column (grows **upward** from the bottom).
  - Both anchor to the **same right edge**; with enough content they collide in
    the vertical middle. Nothing caps their combined height or coordinates them.
  - There is a mobile media query (`max-width:720px`) that turns `.hud-info`
    into a bottom sheet and **hides** `.hud-right` (`display:none`) — so this is
    a **desktop** layout problem.
- `src/ui/labels.ts` — the 3D `BodyLabels` are absolutely-positioned DOM
  elements over the canvas; they currently render underneath/through the panels.

**What's been tried:** nothing yet — reported by the user, not yet worked on.

**Root cause:** three independently absolutely-positioned panels
(`.hud-info` top-right, `.hud-right` bottom-right, plus free-floating labels)
share the right screen region with no layout manager and no collapse control.

**Directions (pick what fits; keep it vanilla DOM, match the existing `.panel`
styling, and preserve the F12.2 mobile bottom-sheet behavior):**
1. **Coordinate the right column:** put Info + Postcards + Events in a single
   flex column anchored top-right with `max-height: calc(100vh - margins)` and
   `overflow-y:auto`, so they stack and scroll instead of overlapping.
2. **Make them window-like:** give Postcards and Events a header with a
   collapse/close affordance, and a small persistent "dock" (tab/toggle
   buttons, e.g. near the time bar or a corner) to reopen a closed panel.
   Persist open/closed state in `localStorage` (wrap in try/catch — storage can
   throw; see `quality.ts` for the pattern).
3. Ensure panels sit above the 3D labels (z-index) OR hide labels that fall
   under an open panel.
4. Keep the mobile path working (labels + `.hud-right` hidden / sheet behavior).

**Reproduce:** `npm run dev` → `?webgl` → the Events + Postcards panels appear
bottom-right at boot (Events is populated from a live scan; Postcards has 6
entries). On a ~900px-tall window they overlap the Info panel. There is no
control to close them.

**Done when:** the right-side panels never visually overlap each other or the
Info panel on desktop; Events and Postcards can be collapsed/closed and
reopened; 3D labels don't bleed through open panels; mobile sheet still works;
`check` + `build` green.

---

## Problem 2 — Square/boxy bloom on very bright sources (needs a rethink, not a tune)

**Symptom:** Bright, small/backlit sources (an icy moon backlit by the Sun, the
Sun itself, the "Pale Blue Dot" Earth sprite) get a **square / axis-aligned
boxy halo** and a boxy haze instead of a round glow. A first attempt tightened
the bloom radius (below) which helped small dots but the square **persists on
the very brightest sources**.

**Files:**
- `src/core/Engine.ts` — the post-processing chain is built in the constructor.
  Two `bloom()` nodes exist, both from `three/addons/tsl/display/BloomNode.js`
  (an UnrealBloom-style **mip-pyramid** bloom):
  - **Beauty bloom** (layer-0 scene): `const beautyBloom = bloom(bloomSrc, 0.5,
    0.12, 0.85);` — added to the composite. (radius already reduced to 0.12 by
    the attempt below.)
  - **Solar softener:** `const solarSoft = bloom(solarPass, 0.35, 0.12, 0.25);`
    then `solarSource = solarPass.add(solarSoft.mul(0.35))`. This BloomNode runs
    on the **solar seed layer**, which is the single brightest thing in the
    scene — a prime suspect for the square around the Sun / backlit rims.
- `src/scene/Sun.ts` — the Sun's *primary* glare is a **painted round profile**
  on a sprite (a tight core + a Lorentzian skirt), composited directly (NOT
  through a BloomNode). This is the precedent: the round look was achieved by
  *avoiding* the mip bloom. See also gotcha #16 in `PLANO_MESTRE_AAA.md` §11:
  "never reintroduce a wide BloomNode on the solar path — mips → square lavender
  stacks on a point source."

**What was tried (git `11d0219`):** reduced the beauty bloom radius 0.4 → 0.12
(weights the fine mips over the coarse blocky ones). Result: round halo on a
mid-distance moon *dot*, but the **square returns on the brightest sources**
(the Sun, a backlit crescent) — because the mip pyramid is fundamentally
axis-aligned and a bright enough source still lights the coarse mips. `solarSoft`
(also radius 0.12) was **not** changed and likely contributes the square around
the Sun.

**Root cause:** three.js `BloomNode` (UnrealBloom port) downsamples/upsamples a
**mip pyramid** with separable blur on low-resolution, axis-aligned mip textures.
On a very bright source the coarse mips dominate and their box/diamond footprint
shows as a square halo. The `radius` parameter only re-weights the mip
contributions — it cannot make the coarsest mips *round*. So this is an
**algorithm** limitation, not a parameter to tune.

**Directions to investigate (goal: radially-symmetric glow on any brightness,
same pass budget, WebGPU+WebGL2 parity):**
1. **Replace the mip bloom with a radial kernel bloom** written in TSL: a proper
   circular/Gaussian blur at one or two scales, or a **dual-filter (Kawase)**
   downsample/upsample that stays round. This is the real fix.
2. **Drop `solarSoft` entirely** and check whether the painted round seed alone
   carries the Sun's glare (it may — the seed already has a wide Lorentzian
   skirt). If the Sun looks good without `solarSoft`, that removes the square
   around the brightest source for free.
3. **Clamp/skip the coarsest 1–2 mip levels** of the bloom (where the square
   lives) if a full replacement is too invasive — a cheaper mitigation.
4. **Generalize the Sun's approach:** for deliberate bright point sources (the
   Earth `PaleBlueDot` sprite, maybe the brightest moons) paint a round glow
   sprite instead of relying on scene bloom. Doesn't fix arbitrary scene bloom
   but kills the worst offenders.
5. Watch for a second contributor to the "haze": in `?post=full`, the
   depth-of-field node (`dof(...)`) softens the whole frame when its aperture is
   non-zero (close fly-bys). If the user's foggy screenshot was a close fly-by,
   part of the haze may be DOF, not bloom — isolate with `?post=flare` (bloom
   chain, no DOF) vs `?post=full`.

**Reproduce:** `?webgl`, then frame a **bright backlit moon** or the **Sun near
a body's limb** and `engine.capture` → `/__shot`. Compare `?post=raw`
(no bloom), `?post=bloom` (beauty only), `?post=flare` (+ solar glare, no
grain/DOF), `?post=full` to attribute the square to `beautyBloom` vs `solarSoft`
vs DOF. A clean repro: pause the clock, place the camera so a bright icy moon
(Enceladus/Tethys) is a small centered disc on black sky, capture in each mode.

**Done when:** bright sources (Sun, backlit moons, Earth dot) show a **round**
glow with no axis-aligned square/box at any brightness, on both backends, with
no new whole-scene pass and the Sun's calibrated look preserved; `check` +
`build` green; the wave3/wave4 solar-chain selfchecks still pass (they assert
the Sun's round-seed contract and forbid a *wide* BloomNode on the solar path —
a radial replacement of the *softener* is fine, but read those selfchecks first:
`src/wave3.selfcheck.ts`, `src/wave4.selfcheck.ts`).

---

## Notes shared by both problems

- Match existing code style; no new dependencies; vanilla DOM for UI.
- Commit atomically, keep `check`/`build` green, don't `git push`.
- The full design history is in `PLANO_MESTRE_AAA.md` (Portuguese) — §11 gotchas
  and §2.1 (solar chain) are the relevant parts for Problem 2; F12.1/F12.1c
  (events/postcards) and F12.2 (mobile) for Problem 1.
