# AGENTS.md — Saturn

Guidance for AI agents (and humans) working in this repo. The master plan is
`PLANO_MESTRE_AAA.md`; its Section 11 ("gotchas globais") is normative.

## Commands

```bash
npm run dev      # dev server
npm run build    # tsc --noEmit + vite build (production bundle)
npm run check    # selfchecks: kepler + wave1–4 (pure Node, no browser)
npm run deploy   # runs check FIRST — a red check aborts the deploy
node scripts/qa-capture.mjs   # headless QA captures → output/
```

`npm run check` and `npm run build` green are the gate of every wave, on both
backends (`?webgl` forces WebGL2).

## Scene conventions

- 1 unit = 1000 km · Y = Saturn's north pole · moons orbit in Saturn's
  equatorial frame · the primary body sits at the local origin.
- Frame order per tick: bodies → controls → `sun.update`/`followCamera` with
  the final camera pose → render. A new solar uniform that ignores this order
  lags one frame.
- HUD is English-only (registered decision).

## Layer architecture (do not reshuffle)

- Layer **0**: beauty — everything except the sun; the bloom camera reads only
  this layer, so beauty bloom never samples the sun disk (square-halo bug).
- Layer **1** (`SOLAR_LAYER`): solar glare seed — feeds the post chain only.
- Layer **2** (`DISPLAY_SUN_LAYER`): the visible sun disk; the base camera
  enables 0 + 2 so the disk shares the depth buffer with Saturn/rings/moons.

Moving the disk between layers reintroduces the square bloom. Glare is painted
on the seed (round profile, windowed skirt) — never reintroduce a wide
BloomNode or `anamorphic(solar…)` in the solar path (both are banned by
selfcheck regexes).

## renderOrder gotcha (plan §11.10)

The sun disk draws **after** the transparent atmosphere shells
(`renderOrder = 1000`). With additive blending and high limb alpha, a negative
renderOrder turns into a black hole at sunset — never go back. Solar
extinction through the rings is NOT alpha blending: it is computed CPU-side
via `sunVisibilityFromCamera` and applied as `tint × visibility` exactly once
per path (`solarTintUniform` carries transmittance only — no visibility
bake-in; disk multiplies in its material, glare multiplies `solarGate` in the
graph).

## Selfchecks are contract

`src/*.selfcheck.ts` files encode architectural decisions. When a wave
replaces the architecture a selfcheck asserts, **rewrite the selfcheck in the
same wave** — `npm run check` never stays red "temporarily". New physics
constants get numeric selfchecks (visual sanity goes to captures; AgX makes
pixel-luminance assertions unfalsifiable).

## QA harness & determinism (S31)

```text
window.__saturn.step(dt)                 # advance one frame (headless)
window.__saturn.engine.capture(w, post)  # PNG data-URL (only capture path)
?post=raw|bloom|anamorphic|flare|full    # pipeline A/B (anamorphic = alias of full)
?webgl                                   # force WebGL2
?quality=low|med|high|ultra&notune       # pin preset (no localStorage), tuner off
?qa=1                                    # expose __saturn in production builds
```

**Identity rule:** pixel-identical / diff comparisons ONLY with `?post=raw`
(or `filmGrain=0`) and a pinned DPR — `FilmNode` uses wall-clock time, so
`?post=full` never repeats. Monotonicity/appearance scenarios may use `full`.
Always use `?quality=<preset>&notune` in headless runs: the one-shot
auto-tuner can `location.reload()` mid-run otherwise. Captures only via
`engine.capture()` — never resize the renderer inside it (PassNode
black-frame bug).

`scripts/qa-capture.mjs` drives the production bundle (`vite preview` +
headless Chromium) through these hooks; captures go to `output/` (gitignored).

## Commit prefixes per wave

One wave per commit, prefixed: **F6.1** (Onda 0 — fundação/QA), **F8** (Onda
5 — produto/HUD), **F9** (Onda 6 — sazonalidade), **F10** (Onda 7 — assets/
performance), **F11** (Onda 8 — completude), **F12** (Onda 9 — eventos/
polish). Numbers marked ⚠ VERIFICAR in the plan never enter production
without a primary-source citation in a code comment.

## Misc

- Windows LF→CRLF warnings are cosmetic — do not commit whitespace churn.
- `localStorage` can throw — always try/catch (see `core/quality.ts`).
- WGSL `smoothstep` requires `edge0 < edge1` — invert via `oneMinus(...)`.
- TSL: `atan2` is deprecated — use two-arg `atan(y, x)`. Sprites via
  `SpriteNodeMaterial`, never `Points`. Avoid `positionNode` overrides (they
  break `positionLocal` in the fragment) — use `uv()`.
