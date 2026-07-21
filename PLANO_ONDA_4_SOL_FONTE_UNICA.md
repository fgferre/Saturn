# ONDA 4 — Sol físico e fonte de luz única (prompt de implementação)

> **Missão para a AI implementadora:** transformar o Sol de "sprite borrado" em um disco
> solar fisicamente plausível — pequeno, cegante, com limb darkening — cujo brilho
> aparente (glare) vem do pós-processamento, como fazem os melhores simuladores
> (Space Engine, Elite Dangerous, NASA Eyes, Cosmographia, Stellarium). E consolidar
> o Sol como **única** fonte de luz: toda claridade na cena deve ser sol direto ou
> sol refletido/espalhado (ringshine, saturnshine, atmosfera), nunca luz ambiente cega.
>
> Prefixo de commit: `F7`. Antes de codar, **releia os arquivos citados** — o working
> tree tem mudanças não commitadas das Ondas 1–3 e este plano referencia o estado atual.

---

## 1. Mapa do código atual (leia antes de mexer)

| Arquivo | O que faz hoje |
|---|---|
| `src/scene/Sun.ts` | `DirectionalLight` (0xfff4e0, 3.2) + `AmbientLight` (0.035) + **dois billboards** centrados na câmera a 40 000 unidades ao longo de `sunDir`: `disk` (visível, layer 2, depth-tested) e `seed` (semente HDR, layer 1, alimenta a cadeia de lente) |
| `src/core/Engine.ts` | 3 câmeras/passes: base (layers 0+2), bloom (layer 0 só — nunca vê o disco), solar (layer 1 só). `comp = base + beautyBloom [+ DOF] + anamorphic×sunVis×0.14 + lensflare×sunVis×0.32 + CA + vinheta [+ film]`. AgX, exposure 1.4 |
| `src/materials/sharedUniforms.ts` | `sunDirUniform`, `sunVisibilityUniform` (0..1, gate do glare), `moonShadowUniforms` (8 slots xyz+raio) |
| `src/physics/eclipse.ts` | `saturnShadowOnMoon(pos, sunDir, ringOpacityAt)` — umbra oblata + penumbra + filtragem pelos anéis, CPU. Também define `SUN_ANGULAR_RADIUS = 0.000497 rad` (raio angular do Sol a ~9,5 UA) |
| `src/materials/saturnMaterial.ts` | Sombra dos anéis no globo (analítica, **sem penumbra** — o comentário na linha ~136 promete "later penumbra wave": é esta onda), transits de luas, ringshine emissivo (LUT), tudo via `DirectMaskedStandardMaterial` |
| `src/materials/ringsMaterial.ts` | Transporte custom: faces lit/unlit, forward scattering, sombra do planeta **com** penumbra, spokes, wakes. Termos `+albedo×0.012/0.018` = saturnshine simplificado (não é ambiente) |
| `src/materials/moonTransits.ts` | Sombras de luas no globo/anéis, **já com penumbra anular** pelo tamanho angular do Sol |
| `src/materials/moonMaterials.ts` | Hapke BRDF + saturnshine emissivo no hemisfério voltado a Saturno |
| `src/materials/raymarchAtmosphere.ts` | Single scattering (Saturno limbo + Titã), usa `sunDirUniform` |
| `src/main.ts` | Loop: `sunDirectionAt(jd)` → uniforms → `sun.update(sunDir, camera.position)`; `sunVisibilityUniform` = `saturnShadowOnMoon(camera.position, …)` |

**QA headless (use, não reinvente):** em dev, `window.__saturn.step(dt)` avança um frame
e `window.__saturn.engine.capture(width, withPost)` devolve PNG data-URL; `?post=raw|bloom|anamorphic|flare|full`
dá A/B controlado; `?webgl` força o backend WebGL2.

**Posição do Sol:** o billboard centrado na câmera ao longo de `sunDir` **está correto** —
o Sol está a ~1,4 milhão de unidades (além do far plane); um impostor a distância fixa na
direção certa é a técnica padrão e não tem paralaxe perceptível na escala do sistema.
Não mude essa arquitetura; mude o **conteúdo** do sprite.

---

## 2. Diagnóstico — por que hoje é um borrão

1. **Halo pintado no sprite.** `circularFalloff(0.08, 0.48)` num quad de 900 unidades:
   o gradiente suave ocupa quase o quad inteiro e domina o core. O "glow" está
   rasterizado no billboard em vez de emergir do bloom/flare.
2. **Tamanho angular ~23× o real.** 900/40 000 ≈ 1,3° de diâmetro aparente; o Sol visto
   de Saturno tem ~0,057° (2×`SUN_ANGULAR_RADIUS`). Grande + suave = mancha.
3. **Sem estrutura física.** Nenhum limb darkening, borda definida por smoothstep largo,
   cor chapada.
4. **Radiância baixa demais para AgX.** Core a 4.5 não satura o tone mapper → disco
   leitoso em vez de "fonte cegante que estoura para branco".
5. **Duas fontes de verdade para o tamanho do Sol.** A física (`SUN_ANGULAR_RADIUS`)
   e o sprite (constantes soltas em `Sun.ts`) não se falam.

## 3. Como os melhores simuladores fazem (o alvo)

- **Disco minúsculo e estourado**: tamanho angular físico (com piso mínimo em pixels
  para nunca sumir), radiância HDR altíssima que satura a branco no tone mapper.
- **Limb darkening**: `I(μ) = 1 − u·(1−μ)`, `μ = √(1−(r/R)²)` — borda visivelmente
  mais escura e mais quente que o centro.
- **Todo o glow é pós**: bloom apertado + halo largo fraco + streaks/ghosts de lente,
  escalando com a fração visível do disco (oclusão → glare morre suavemente).
- **Cor consistente**: a mesma temperatura (~5800 K, levemente quente) no disco, na
  `DirectionalLight` e no glare.

---

## 4. Fases de implementação

### F7.1 — Disco solar físico (o coração da onda)

Em `src/scene/Sun.ts`, substituir o material do `disk`:

- **Tamanho pela física**: derive o raio do quad de `SUN_ANGULAR_RADIUS` (importar de
  `physics/eclipse.ts` — passa a ser a única fonte de verdade) × `SUN_FOLLOW_DISTANCE`
  × um fator de apresentação `SUN_APPARENT_SCALE` (constante documentada; default
  sugerido **3–4** para legibilidade, `1` = fisicamente exato). O quad deve ser ~2,5×
  o raio do disco (folga só para antialias), não 900 unidades de halo.
- **Piso em pixels**: se o disco projetado ficar < ~3 px, o glare do F7.2 carrega a
  identidade visual; não é preciso clamp geométrico (a distância câmera–sol é
  praticamente constante na escala do sistema — o tamanho angular não varia).
- **Limb darkening**: `u ≈ 0.6`; opcionalmente `u` por canal (ex. 0.75/0.60/0.45)
  para borda mais alaranjada — barato e vistoso.
- **Borda nítida**: antialias de ~1 px via `fwidth(r)` + `smoothstep` (lembrete WGSL:
  sempre `edge0 < edge1`). Nada de falloff a 0.48 do quad.
- **Radiância**: calibrar COM AgX + exposure 1.4 (valores lineares enganam). Alvo:
  centro do disco ≥ 99% branco pós-tonemap; começar em ~60–120 e ajustar por captura.
- **Granulação (opcional, gate por `quality`)**: `mx_fractal_noise_float` de contraste
  baixíssimo (±2–3%), só perceptível com FOV estreito. Se não ficar bom em 30 min,
  corte — YAGNI.
- **Não tocar** na arquitetura de layers (disk no layer 2 fora da bloomCamera, seed no
  layer 1): ela existe para evitar o halo quadrado do bloom e dar oclusão por depth.
  Manter `depthTest: true` no disco — Saturno/anéis/luas continuam ocluindo de graça.
- Remover o export deprecated `SUN_RADIANCE` se nenhum selfcheck (`src/wave*.selfcheck.ts`)
  o referenciar.

### F7.2 — Glare que nasce do pós, não do sprite

- **Seed** (`layer 1`): reduzir `SUN_SEED_SCALE` para acompanhar o novo disco
  (energia concentrada → bloom redondo e apertado). Ajustar `SUN_SEED_RADIANCE`
  para que o glare total leia como "estrela" e não mancha.
- Em `Engine.ts`, recalibrar a cadeia solar: `solarBloom` mais apertado
  (raio menor, strength maior) + os pesos do `anamorphic` (0.14) e `lensflare` (0.32).
  Duas escalas de glow (curto intenso + halo largo de amplitude baixa) podem sair de
  **um** bloom bem calibrado — só adicione um segundo `bloom()` do mesmo `solarPass`
  se a captura provar necessidade. **Zero passes de cena novos.**
- **Oclusão por luas no glare**: hoje `sunVisibilityUniform` cobre só Saturno+anéis.
  Em `main.ts` (ou `eclipse.ts`), multiplicar também a fração do disco solar coberta
  por cada lua vista da câmera — mesma conta analítica de `moonTransitLight`, em CPU,
  8 luas, custo nulo. Resultado: eclipses solares em fly-by apagam o glare sozinhos.
- **Suavização temporal**: lerp de `sunVisibilityUniform` por frame (~10 Hz de meia-vida)
  para eliminar popping ao cruzar bordas de anel.

### F7.3 — Sol como única fonte de luz

- **Remover** o `AmbientLight` de `Sun.ts`. As compensações físicas já existem:
  ringshine no globo, saturnshine nas luas, os termos `0.012/0.018` nos anéis
  (documentá-los como saturnshine, não ambiente).
- Revalidar o lado noturno por captura: se ficar ilegível, a correção é
  **subir os ganhos dos shines** e/ou um lift sutil no grade final do pós
  (ex. `comp.add(comp.smoothstep-lift)` mascarado a sombras) — nunca recolocar
  luz ambiente no rig de iluminação.
- Conferir que Starfield/sky continuam sendo só background (não lighting).

### F7.4 — Penumbra da sombra dos anéis no globo (a dívida da Onda 1)

Em `saturnDirectLightMask` (`saturnMaterial.ts`):

- Largura da penumbra no plano do anel: `w = t × SUN_ANGULAR_RADIUS` (t = distância do
  ponto ao plano ao longo do raio solar), convertida para o espaço `ru` do perfil.
- Implementação barata: **3 amostras** do `ringAlpha` em `ru−w, ru, ru+w` com pesos
  0.25/0.5/0.25. Nada de blur real.
- Perto do equinócio (`|S.y| < eps`) manter o gate de validade existente; a penumbra
  não precisa ser correta ali, só não pode explodir (w cresce com 1/|S.y| — clamp).

### F7.5 — Sol poente através da atmosfera (refração simplificada)

- Quando o disco solar (visto da câmera) passa perto do limbo de Saturno ou Titã,
  avermelhar e atenuar o disco: transmitância Rayleigh analítica de 3 canais
  `exp(−σ_rgb × pathFactor(alturaDeGrazing))` aplicada ao `colorNode` do disco —
  **sem** raymarch novo. A altura de grazing sai da mesma geometria analítica já usada
  em `eclipse.ts` (distância mínima do raio câmera→sol ao elipsoide).
- O crescente atmosférico backlit já emerge do raymarch existente; apenas recalibrar
  `intensity` se o novo sol mudar a percepção.
- Alargamento/achatamento do disco por refração: **não fazer** (invisível nesta escala).

### F7.6 — Calibração e QA (obrigatório antes de fechar)

Cenários de captura fixos (via `__saturn.step` + `engine.capture`, e A/B `?post=`):

1. Sol pleno em quadro (disco + glare) — meia-lua de Saturno ao fundo.
2. Sol atravessando os anéis (entrada, meio, saída) — glare deve modular suave.
3. Sol atrás de Saturno (ocaso/nascer no limbo) — F7.5 visível, glare morre e renasce.
4. Eclipse solar por Titã visto da câmera — F7.2 oclusão por lua.
5. Lado noturno de Saturno — só ringshine, sem ambiente (F7.3 legível).
6. Equinócio (`S.y ≈ 0`) — sem NaN/flicker na sombra dos anéis (F7.4).
7. Tudo acima nos dois backends (`?webgl`).

Critérios de aceitação:

- [ ] Disco solar pequeno, circular, borda nítida com limb darkening; nenhum halo
      rasterizado maior que ~2× o raio do disco.
- [ ] Tamanho angular = `SUN_ANGULAR_RADIUS × SUN_APPARENT_SCALE`, única fonte de verdade.
- [ ] Glare inteiro vem do pós; `?post=raw` mostra só o disco limpo.
- [ ] Nenhuma `AmbientLight`/`HemisphereLight` na cena; noite legível via shines.
- [ ] Sombra dos anéis no globo com borda suave dependente da distância ao plano.
- [ ] Glare ocluído por Saturno, anéis **e luas**, sem popping.
- [ ] Sem novo pass de cena, sem textura nova, custo < ~0.2 ms (comparar FPS do HUD).
- [ ] Compila e renderiza em WebGPU e WebGL2.

---

## 5. Gotchas conhecidos (aprendidos nas Ondas 1–3 — não redescobrir)

- **Bloom quadrado**: a beautyBloom (layer 0) jamais pode amostrar o disco visível.
  Se mover o disco de layer, o artefato volta.
- **DOF**: roda no composite com depth do base pass; o disco tem `depthWrite:false`,
  então herda o viewZ do fundo. Testar fly-by próximo (aperture > 0 só a < 25 unidades)
  para o disco novo não virar bokeh estranho.
- **WGSL `smoothstep`**: exige `edge0 < edge1` (use `oneMinus` para inverter).
- **AgX**: rolloff forte — toda calibração de radiância é visual, por captura, nunca
  por valor linear "que parece certo".
- **`SpriteNodeMaterial`**: manter; `Points` rasteriza 1 px no WebGPU.
- **Capturas headless**: usar `engine.capture` existente (evita o cache de frameId do
  PassNode e o discard do framebuffer WebGL2). Não escrever outro caminho de captura.
- **Ordem do frame** (`main.ts`): corpos → controls → `sun.update` com a pose final da
  câmera. Qualquer novo uniform solar segue essa ordem ou o disco atrasa um frame.

## 6. Fora de escopo (explicitamente)

- God rays / volumetria de luz no espaço (vácuo não espalha; fica falso).
- Shadow maps (todas as sombras do sistema são analíticas — manter).
- Múltiplas luzes, luz de preenchimento, IBL.
- Refração geométrica real, lente gravitacional, sprites texturizados do Sol.
