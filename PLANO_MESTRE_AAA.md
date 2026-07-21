# PLANO MESTRE AAA — Saturn (pós-Ondas 1–4) — v2.3

> **Missão para a AI implementadora:** levar a simulação do sistema de Saturno ao
> nível de referência AAA do gênero (Space Engine, NASA Eyes, Cosmographia):
> fisicamente coerente em cada pixel, carregamento profissional, performance
> adaptativa, sistema completo de luas e polimento de produto.
>
> **v2.3 — baseline commitada + varredura de oportunidades (36 achados
> adversarialmente verificados).** A baseline de código/docs **já está
> commitada**: `8e8498f` (código: Ondas 1–4 completas) + `7de7986` (docs). O
> working tree contém **apenas** este plano — o código está **congelado**, o
> problema do alvo em movimento acabou. **SHA-âncora: `8e8498f`** (declare ao
> commitar esta v2.3; o plano commitado em `7de7986` é a v2.1 e contradiz o
> código — este commit apaga a contradição). `npm run check` verde no âncora
> (kepler + wave1–4). Esta versão incorpora: 4 erros físicos novos (sombra nos
> transparentes, irradiância, eclipses monocromáticos, capuz de Titã), emenda
> de formas das luas menores, pacote de UX (Onda 5), Pale Blue Dot (Onda 9) e
> a blindagem de determinismo do QA (Onda 0).
>
> Histórico: v1 (scan pré-F7) → v2 (pós-F7) → v2.1 (re-revisão) → v2.2 (delta
> final) → v2.3 (baseline `8e8498f` + varredura).

---

## 1. Como usar este documento

1. **Releia os arquivos citados antes de mexer.** A Onda 0 commita a baseline.
2. **Uma onda por vez, em ordem.** Prefixo de commit por onda; critérios de
   aceitação objetivos; não misturar ondas num commit.
3. **`npm run check` e `npm run build` verdes são gate de toda onda**, nos dois
   backends (`?webgl`). Selfcheck que codifica arquitetura substituída é
   reescrito na mesma onda, nunca "depois".
4. **Números marcados com ⚠ VERIFICAR** são aproximações: a fonte primária
   (JPL SSD, artigo, foto Cassini referenciada) manda. Nenhum valor ⚠ entra em
   produção sem confirmação citada em comentário no código.
5. **Orçamento global de render:** nenhuma onda adiciona passes de cena
   inteiros (arquitetura base/bloom/solar do Engine é estável) nem regride
   fps > 5% no preset High (medir pelo FPS do HUD, máquina anotada no commit).

---

## 2. Estado atual verificado (baseline pós-F7)

### 2.1 Já resolvido pelo F7 (não re-trabalhar)

| Item | Evidência |
|---|---|
| Sol físico: disco pequeno (0,2° aparente = 0,057° × 3,5), limb darkening cromático, radiância 90, borda AA `fwidth`, tamanho derivado de `SUN_ANGULAR_RADIUS` | `src/scene/Sun.ts:41-74,97-135` |
| Glare redondo **pintado no seed** (core `smoothstep(0, 0.055)` + saia Lorentziana **janelada a zero na borda do quad** — sem moldura quadrada em FOV fechado; `SUN_SEED_SCALE = disco × 7`, picos 28/3,5); composto direto: `solarSource = solarPass + solarSoft×0,35` × `solarGate` × 0,95 + lensflare quente ×0,18. **Streak anamórfico REMOVIDO (F7 delta final)** — proibido por `wave3.selfcheck.ts:168-171`; `?post=anamorphic` sobrevive como alias documentado de `full` (`Engine.ts:36-37`). **Sem BloomNode largo no caminho solar** — proibido por regex (`wave4.selfcheck.ts:120-123`) | `src/scene/Sun.ts:57,67-68,145-159`, `src/core/Engine.ts:112-152` |
| Gate de visibilidade com oclusão por luas + suavização temporal (half-life) | `src/physics/eclipse.ts:118-130`, `src/main.ts:192-203` |
| Roteamento tint/vis (pós-22:00): `solarTintUniform` = **só transmitância atmosférica** (sem bake-in de visibilidade); o disco multiplica `tint × sunVisibilityUniform` no material; o glare multiplica `solarGate = tint × vis` no grafo — cada caminho aplica tint × vis **exatamente uma vez** (sem vis² acidental) | `src/scene/Sun.ts:76-80,120-125`, `src/core/Engine.ts:140`, `src/main.ts:205-210` |
| Fonte única de luz: sem `AmbientLight` | `src/scene/Sun.ts:95`; guarda em `wave4.selfcheck.ts:55-68` |
| Penumbra da sombra dos anéis no globo (3 taps 0,25/0,5/0,25, clamp 0,04) | `src/materials/saturnMaterial.ts:141-148` |
| Extinção de ocaso 8×: `k = 22 × atmPath`, expoentes 0,38/0,70/1,35; contrato AgX ancorado (tint × 90 no ombro: R < 25, B < 8) | `src/physics/eclipse.ts:163-171`, `src/wave4.selfcheck.ts:100-102` |
| Extinção do disco é **CPU-side**; disco desenha DEPOIS das shells (`renderOrder = 1000`) | `src/scene/Sun.ts:131-133` |
| `wave4.selfcheck.ts` no `npm run check` | `package.json:10` |
| `SUN_RADIANCE` removido | — |

### 2.2 Achados abertos (baseline do plano)

| # | Fato | Evidência |
|---|---|---|
| S1 | ~~Ondas 1–4 não commitadas~~ ✓ **resolvido**: baseline commitada em `8e8498f` (+ docs `7de7986`, plano `889cd78`) | `git log` |
| S6 | Spokes do anel B sempre visíveis (real: fenômeno de quase-equinócio) | `ringsMaterial.ts:100-112` |
| S7 | Plumes de Enceladus com atividade constante (real: varia ~4× com a maré diurna) | `effects/plumes.ts:94-95` |
| S8 | Compute das plumes roda todo frame mesmo invisível (1M partículas no Ultra) | `main.ts`, `Engine.ts:221` |
| S9 | Slab e E ring rasterizados com opacidade 0 (sem `mesh.visible` gate; refs não guardadas) | `SaturnSystem.ts:156,159` |
| S10 | Troca de preset exige reload | `quality.ts:66-76` |
| S11 | Auto-tuner one-shot; sem resolução dinâmica | `main.ts:182-190`, `quality.ts:82-93` |
| S12 | ~27 MB de texturas JPEG/PNG, sem KTX2/tiers/preload, sem tela de loading | `textures.ts:66-109` |
| S13 | Geometria única de lua para todas as distâncias | `SaturnSystem.ts:108` |
| S14 | Luas menores ausentes; `MOON_SHADOW_COUNT = 8` cobre exatamente as 8 maiores | `data/saturn.ts:29-87`, `sharedUniforms.ts:9` |
| S15 | README:147 falso (luas **recebem** sombra dos anéis desde a Onda 2) **e README:149 falso** (o E ring **é** renderizado) | `README.md:147,149` vs `eclipse.ts:63`, `SaturnSystem.ts:156` |
| S16 | CI não roda `npm run check` (nem `deploy.mjs`) | `deploy.yml:26-27`, `scripts/deploy.mjs` |
| S17 | `atan2` TSL deprecated na r178 → migrar para `atan` | `ringsMaterial.ts:103`, `saturnMaterial.ts:100` |
| S18b | `syncSolarCamera()` deprecated sobrevive | `Engine.ts:207-210` |
| S18c | `SUN_SEED_RADIANCE` virou alias `@deprecated` (usado só nos logs dos selfchecks) → migrar para `SUN_SEED_CORE_RADIANCE` na Onda 0 | `Sun.ts:70-71` |
| S19 | `index.html` sem meta/OG; `cinema-exit` em PT num HUD EN; sem `powerPreference` (`Engine.ts:189`) | — |
| S20 | Labels: oclusão só por Saturno; info sem dados vivos (fase/iluminação/tamanho aparente) — `eclipseLight` já é calculado por frame | `labels.ts:66-75`, `hud.ts:152-171`, `SaturnSystem.ts:~282` |
| S21 | HUD sem velocidades negativas (relógio suporta), sem atalhos, sem URL state | `hud.ts:19-26`, `SimClock.ts:8` |
| S22 | `engine.capture()` existe e é race-safe — pronto para modo foto | `Engine.ts:255`, guarda em `wave4.selfcheck.ts:124-128` |
| S23 | Sem LICENSE/NOTICE; textura de Saturno é CC BY 4.0 | raiz, `README.md:122-123` |
| S24 | Sem AGENTS.md | raiz |
| S25 | Sem `prefers-reduced-motion`; sem preset mobile; info some <720px | `hud.css:248-251` |
| S26 | Harness de QA: `__saturn.step/capture`, `?post=`, `?webgl` | `main.ts:~243-248` |
| S27 | Objeto `cinema` inline em `main.ts` (~45 linhas) | `main.ts:86-127` |
| S28 | `wave3.selfcheck.ts` seção F (linhas ~196-204) virou vestigial do sprite antigo (`coreHalf` 0.12/0.5) — passa mas não afirma nada; contrato físico já é coberto por `wave4.selfcheck.ts:42-53`. Dívida cosmética | `wave3.selfcheck.ts:196-204` |
| S29 | F7.5 cobre só Saturno (`RA_ATM`); Titã sem tint de ocaso no disco | `eclipse.ts:26` |
| S30 | `quality.anamorphic` virou **config morta** após o delta final do F7 — definida em todos os presets mas nada a lê → remover na Onda 0 | `quality.ts:23,32-47` |
| S31 | **Film grain usa wall-clock** (`FilmNode.js:67` `rand(fract(uv+time))`) → capturas `?post=full` nunca são idênticas; gates de identidade infalsificáveis | `core/Engine.ts:162-166` |
| S32 | **CI não existe no repo**: `.github/workflows/` está no `.gitignore` (linha 6) — `git ls-files .github/` vazio; editar `deploy.yml` é no-op | `.gitignore:6` |
| S33 | `README:71` ainda anuncia "anamorphic streak" — contradiz o código e o contrato `wave3:168-171` | `README.md:71` |
| S34 | **Sombra do planeta ausente nos transparentes**: plumes, anel F e anel E ignoram a umbra (lua apaga na umbra a cada 1,37 d, os gêiseres continuam brilhando) | `effects/plumes.ts`, `materials/fRing.ts`, `effects/eRing.ts` (0 refs a eclipse) |
| S35 | **Irradiância descartada**: `sunDirectionAt` normaliza e joga fora a distância heliocêntrica (e=0,054 → r 9,02–10,05 UA → ×1,24 pico-a-pico; diâmetro solar ±5,5%) | `data/sunDirection.ts:60-65` |
| S36 | **Eclipses monocromáticos**: `eclipseLight` é escalar (`uniform(1)`) — a lua desliza para o cinza na umbra em vez de avermelhar (luz filtrada pela atmosfera) | `scene/SaturnSystem.ts:181` |
| S37 | **Capuz polar de Titã fixo no norte** — real migra norte↔sul com lag ~2 anos (mesma ferramenta do F9.3) | `moonMaterials.ts:137-138` |

---

## 3. Sequenciamento

```
Onda 0 (fundação + QA órfão do F7)
   │
   ▼
Onda 5 (produto quick wins + HUD vivo) ──► Onda 6 (sazonalidade física)
   │
   ▼
Onda 7 (assets + performance adaptativa)
   │
   ▼
Onda 8 (completude do sistema)
   │
   ▼
Onda 9 (eventos + polish final)
```

---

## 4. Onda 0 — Fundação (prefixo `F6.1`) — Esforço S

1. **Commit do plano v2.3 + pino de SHA** (a baseline de código JÁ está
   commitada: `8e8498f` + docs `7de7986`; working tree = só este plano):
   commitar a v2.3 e declarar **`8e8498f` como SHA-âncora** no cabeçalho.
   Isso apaga a contradição repo-atual (plano v2.1 commitado vs código
   commitado sem anamórfico).
2. **Gate de checks — honestidade de CI (S32)**: `.github/workflows/` está
   **gitignored** — não existe CI no repo; editar `deploy.yml` é no-op até o
   usuário rodar `gh auth refresh -s workflow` (ação manual fora do escopo).
   Aceite rebaixado para o **gate local**: `npm run check` obrigatório dentro
   de `scripts/deploy.mjs` antes do build (falha aborta o deploy). Se o escopo
   `workflow` for concedido, aí sim adicionar o step no `deploy.yml`.
3. **NOTICE** na raiz com as atribuições (Solar System Scope CC BY 4.0 —
   obrigatório; NASA/JPL/SSI/LPI domínio público; Gaia DR2 ESA/DPAC; Björn
   Jónsson; DTMs com citações).
4. **README sync**: linha 147 — remover "and receive no ring shadows"; linha
   149 — remover "The E ring and", mantendo só "shepherd moonlets are not
   rendered"; **linha 71 (S33)** — remover "anamorphic streak" do bullet de
   pipeline cinematográfico (o streak foi removido e é proibido por
   `wave3:168-171`).
5. **AGENTS.md**: convenções de cena, arquitetura de layers (0 beleza / 1 solar /
   2 disco), harness de QA, disciplina de selfchecks, prefixos de commit,
   **incluindo o gotcha do renderOrder (Seção 11, item 10)**.
6. **Meta/OG + asset de marca**: **COPIAR** (não mover — `README.md:7`
   referencia `docs-hero.jpg` na raiz) `docs-hero.jpg` para
   `public/brand/hero.jpg` (a raiz NÃO vai para `dist/` — Vite só copia
   `public/`); `og:image` com **URL absoluta** do Pages; `meta description`;
   `theme-color: #000`. O mesmo arquivo serve de fundo do `#boot` na Onda 5.
7. **Limpeza**: remover `syncSolarCamera()` (grep antes); migrar `atan2`→`atan`
   nos dois shaders (S17); migrar `SUN_SEED_RADIANCE`→`SUN_SEED_CORE_RADIANCE`
   nos logs dos selfchecks (S18c); remover `quality.anamorphic` dos presets e da
   interface (S30 — config morta desde o delta final do F7); reescrever a seção
   F vestigial do `wave3.selfcheck.ts` (S28) ou removê-la apontando para a wave4.
8. **i18n**: `cinema-exit` → "Esc to exit". HUD permanece EN (decisão registrada).
9. **QA órfão do F7 (ex-E4/E5):** adicionar aos cenários de captura de
   regressão: (a) sweep de EV 0,5 / 1,4 / 2,6 — disco nunca cinza nem mancha;
   (b) Sol entrando no anel B — luminância do disco **monotonicamente
   decrescente** (o mecanismo é CPU-side via `sunVisibilityFromCamera`, não
   blending — ver gotcha 10).
10. **Determinismo do QA (S31 + varredura):**
    - **Regra de identidade:** comparações "idêntica/pixel-idêntica/diff < x"
      SÓ em `?post=raw` (ou `filmGrain=0`) com DPR pinado — o `FilmNode` usa
      `time` de wall-clock (S31), `full` nunca repete. Monotonicidade (item 9b)
      pode ficar em `full`.
    - **Parâmetros efêmeros de QA:** `?quality=<preset>&notune` — pina o preset
      sem tocar localStorage e desliga o auto-tuner (que pode dar
      `location.reload()` no meio de um run headless).
    - **`__saturn` também em produção** gateado por `?qa=1` (hoje é DEV-only —
      o smoke nunca testaria o bundle real: BASE_URL, minificação, preload).

**Aceitação:** plano v2.3 commitado com SHA-âncora declarado; `git status`
limpo; `deploy.mjs` aborta se `npm run check` falhar; capturas `?post=raw`
idênticas antes/depois; `npm run check` verde.

---

## 5. Onda 5 — Produto: quick wins + HUD vivo (prefixo `F8`) — Esforço M

Arquivos: `main.ts`, `ui/hud.ts`, `ui/hud.css`, `ui/labels.ts`, `index.html`,
`core/Engine.ts`, `scene/SaturnSystem.ts`, `effects/*`, `camera/FocusControls.ts`.

### F8.1 — Loading screen com progresso
- `#boot` em `index.html` com marca + barra + fundo (`public/brand/hero.jpg` da
  Onda 0 — NÃO referenciar a raiz, que não vai para `dist/`); fade-out no fim.
- `loadAllMaps(onProgress)`: embrulhar **todas as 23 promessas** (20 do
  `TextureLoader` + 2 `fetch` de binários + 1 `fetch` de JSON —
  `textures.ts:73-82`), não só as de textura.
- O overlay não bloqueia o `boot().catch` — erro de backend substitui o overlay.

### F8.2 — Modo foto
Botão "Photo" → `await engine.capture(1920, true)` → `<a download>` com
`saturn_YYYYMMDDTHHMMSS.png` usando a **data simulada**. Botão desabilitado
durante a captura (flag `capturing` já protege o loop). **Política de DPR de
foto:** `capture(1920)` faz upscale borrado quando o drawing buffer é menor
(comum em DPR=1) — antes de capturar, subir o DPR efetivo para a foto renderizar
nativa (ou avisar); nunca entregar upscale como feature.

### F8.3 — Estado na URL com pose de câmera
- Boot lê `?focus&jd&speed&cam=az,el,dist` (az/el/dist **relativos ao corpo
  focado** — via FocusControls; sem `cam`, framing default). Validação: `jd` em
  J2000 ± 200 anos; ids/faixas inválidas são ignorados, nunca throw.
- Escrita com `history.replaceState`, throttled a 1 Hz, em foco/velocidade/
  pausa/fim-de-interação — não a cada frame.
- Preservar `?post=`/`?webgl` (QA); qualidade fica fora da URL (localStorage).

### F8.4 — Teclado, tempo e extração do Cinema
- `Espaço` pausa; `[`/`]` percorrem velocidades; `H` esconde HUD; `F`
  fullscreen; presets negativos no HUD (ex. −1 h/s — `SimClock.speed` é signed).
- Atalhos ignorados com foco em `INPUT`/`BUTTON`.
- **Extrair o objeto `cinema` de `main.ts` para `ui/cinema.ts`** (S27) na mesma
  onda — F8.4 já toca os listeners de teclado que interagem com o Cinema.

### F8.5 — Gates de custo zero
- Guardar refs de slab e E ring em `SaturnSystem` (S9);
  `mesh.visible = uniform > 0.01` no loop.
- Compute das plumes (S8): `Engine` ganha registro nomeado `{ node, enabled }`;
  gate por distância câmera↔Enceladus (limiar 40 u). **Armadilha do warm-up
  (revisão):** a câmera inicial está a ≥ 92 u de Enceladus → o compute nasceria
  desligado e as partículas congeladas no seed; ao aproximar, o usuário veria
  uma "erupção" de 5–10 s (vidas 5–10 s, `plumes.ts:95`). Obrigatório: **burst
  de warm-up no re-enable** (~150 passos de compute diluídos em poucos frames)
  ou gate só após o primeiro regime estacionário.
- `powerPreference: 'high-performance'` no `WebGPURenderer` (`Engine.ts:189`).

### F8.6 — HUD vivo + labels (S20, órfão da v1)
- Info panel ganha dados vivos por corpo: **luz solar %** (o `eclipseLight` já é
  calculado por frame — custo zero), ângulo de fase câmera-Sol-corpo, diâmetro
  aparente (″) e distância a Saturno. Atualizar no tick de 0,5 s existente.
- Labels: oclusão também pelos anéis (raio do raio câmera→lua no plano ×
  `opacityAt`) e pelo globo de Saturno com raio exato (hoje 0,98 fixo); helpers
  analíticos já existem em `eclipse.ts`.

### F8.7 — Pacote UX (varredura — tudo S, mesma onda)
- **Date picker:** `<input type="datetime-local">` no readout de data do HUD —
  hoje NÃO existe caminho para digitar uma data ("Saturno no dia em que você
  nasceu": abertura dos anéis varia ±27° no ciclo de 29,5 a). **Armadilha:**
  `datetime-local` parseia como horário LOCAL e o HUD exibe UTC — tratar o
  valor como UTC explicitamente (`dateToJD` já existe).
- **Botão Share/Copy:** o F8.3 escreve a URL silenciosamente e nenhuma UI a
  expõe. Botão ao lado do Photo: clipboard + toast (desktop), `navigator.share`
  (mobile), Copy-PNG via `ClipboardItem`. **Flush síncrono da URL antes de
  copiar** (a escrita é throttled a 1 Hz).
- **Click-to-focus (picking):** com HUD oculto (tecla H) ou labels off, a cena
  vira só-observação. Raycast/projeção sobre os corpos (~30 linhas reusando
  `focusBody` + a projeção de `labels.update`) — manipulação direta é o padrão
  do gênero.
- **Overlay de ajuda + hint de primeiro uso:** tecla `?` abre overlay de
  atalhos; hint "Drag to orbit · Scroll to zoom" que some na 1ª interação
  (`enablePan=false` torna o modelo de câmera não-óbvio; `H` é indescobrível).
- **Flush de URL antes de reload de preset:** `setQuality()` faz
  `location.reload()` (S10) — sem flush síncrono do F8.3 o usuário é
  teleportado ao framing inicial com data resetada. Mesmo flush do Share.
- **Favicon:** `<link rel="icon">` em `index.html` (pode derivar de
  `public/brand/` da Onda 0) — toda aba/bookmark mostra ícone genérico.
- **FOV/telefoto:** slider de FOV (câmera travada em 45°; as fotos icônicas da
  Cassini são de lente longa). `copyCameraPose` já propaga fov para toda a
  cadeia de passes.

### F8.8 — (Opcional) Gravação WebM [M]
`MediaRecorder` sobre `canvas.captureStream()` — a alma de uma simulação é
movimento; nenhum pass novo. **Armadilha:** flag `recording` SEPARADA de
`capturing` (o flag de captura congela o loop — gravaria frame estático).

**Aceitação:** primeiro paint < 100 ms com barra; PNG baixa nos dois backends
sem upscale; URL restaura foco+data+velocidade+enquadramento e sobrevive a
reload de preset; date picker em UTC correto (equinócio 2025-05-06 cai no dia
certo); atalhos OK; picking foca a lua clicada; fps inalterado ou melhor com
Enceladus longe (compute off, sem erupção ao voltar); info mostra "sunlight
34%" durante um eclipse; `npm run check` verde.

---

## 6. Onda 6 — Sazonalidade física (prefixo `F9`) — Esforço S/M

### F9.1 — Spokes só perto do equinócio
`ringsMaterial.ts:100-112`: multiplicar `spoke` por
`season = 1 - smoothstep(0.17, 0.29, abs(S.y))` — desaparecimento observado em
elevação solar ≳ 15–17° (sin 17° ≈ 0,29; ⚠ VERIFICAR contra fotos Cassini
2009–2010). Sanidade: em 2026 (1 ano pós-equinócio) elevação ≈ 6–7° → spokes
fortes, coerente com o comentário existente no shader. Inline com
`sunDirUniform`, sem uniform novo.

### F9.2 — Plumes com ciclo de maré diurna
- Novo `plumeActivityUniform`; fórmula **pela anomalia média** (revisão: `r/a`
  é degenerado com e = 0,0047 — varia só ±0,5%):
  `atividade = 0.625 − 0.375·cos(M)` — pico 1,0 no apoápso (M = π), vale 0,25,
  razão 4:1 exata. `meanAnomalyAt` já existe em `kepler.ts`. Pico próximo ao
  apoápso: Hedman et al. 2013 / Nimmo et al. 2014 (lag de horas após o apoápso
  — cabe no ⚠).
- `plumes.ts`: multiplicar `opacityNode` pelo fator. **Não** alterar o kernel
  de spawn (evita re-seed).
- Aceite (corrigido — varredura): a razão 4:1 vive em opacidade **linear**; o
  AgX comprime → "4:1 por luminância em captura" é intestável. O número vai
  para **selfcheck** (`0.625−0.375·cos(M)` avaliado em M=0/π → 0,25/1,0);
  a captura do polo sul vira sanidade visual (pico visivelmente mais denso).

### F9.3 — Matiz hemisférico sazonal (regra de sinal explícita)
Registro Cassini: o hemisfério **em inverno** fica azul (menos UV → menos haze
fotoquímico → ar limpo → Rayleigh azul), com lag de ~1–2 anos. O norte era azul
em 2004–2005 (inverno norte) e dourou rumo ao solstício de 2017; pós-equinócio
2025, o norte caminha para o outono/inverno → azulando nos anos seguintes.
Implementação: mistura sutil (máx 8–12%) para o azul no hemisfério de inverno
**com lag** — **função pura de jd, sem estado** (revisão v2.1: filtro com
constante de tempo integrado no loop produz matiz errado com scrub de tempo do
F12.1 e velocidade negativa do F8.4): avaliar o forcing sazonal em
`jd − lag` (lag ≈ 1,5–2 anos, constante), fator = função de `−S.y(jd − lag)` —
após `animatedSurface()` e antes de `polarHexagon()` (`saturnMaterial.ts:170-171`).
Documentado como aproximação artística calibrada contra PIA21345.
**Não é luz, é grade de albedo.**

### F9.4 — Sombra de Saturno nos transparentes (S34 — erro físico visível hoje)
`ringsMaterial.ts:63-75` calcula a umbra analítica e cada lua escurece via
`eclipseLight` — mas **plumes, anel F e anel E ignoram a sombra do planeta**
(0 refs a eclipse nos três arquivos). Na época atual (elevação ~6-7°),
Enceladus entra na umbra **toda órbita de 1,37 d**: a lua apaga e os gêiseres
continuam brilhando pendurados numa lua negra; a fita do F atravessa a mordida
iluminada enquanto os anéis principais a mostram.
- **Plumes:** multiplicar o `opacityNode` pelo `eclipseLight` da lua (o uniform
  já é atualizado por frame — infra pronta).
- **F e E:** fatorar o cálculo `planetShadow` de `ringsMaterial.ts` num helper
  TSL compartilhado (mesma matemática oblate+penumbra) e multiplicar cor/
  opacidade dos dois anéis.
- Aceite: captura timelapse de uma entrada de umbra — plume e F apagam junto
  com a lua/anéis (sanidade visual; valor numérico via `eclipseLight` no HUD).

### F9.5 — Irradiância e diâmetro solares pela distância heliocêntrica (S35)
`sunDirectionAt` resolve a posição completa (e = 0,054) e **descarta a
distância no `.normalize()`** (`sunDirection.ts:60-65`). Real: r varia
9,02–10,05 UA → irradiância ×1,24 pico-a-pico, diâmetro solar ±5,5%. É o tema
da onda (sazonalidade) e estava de fora — spokes/plumes/matiz mudam com a
data, mas o Sol não.
- Exportar a distância (nova função ou `out` ampliado); escalar
  `light.intensity` e a radiância do disco/seed por `(9,537/r)²`; escalar
  `SUN_APPARENT_SCALE` efetivo por `1/r` (diâmetro).
- **Ressalva:** os âncoras AgX do `wave4.selfcheck` (tint × 90) são avaliados
  na **distância média** — manter o selfcheck no valor médio e documentar que
  a escala sazonal modula em torno dele.
- Aceite: selfcheck novo — fator em r=9,02 ≈ 1,12 e r=10,05 ≈ 0,90 (±5%);
  captura A/B periélio vs afélio com diferença sutil de exposição global.

### F9.6 — Eclipses avermelhados (S36)
`saturnShadowOnMoon` devolve escalar → a lua desliza para o cinza. Real: a luz
penumbral atravessou a alta atmosfera e chega **avermelhada**. O modelo já
existe: `solarAtmosphereTint` (RGB Rayleigh) avaliado com a **posição da lua**
como origem. Promover `eclipseLight` de `float` para `Vector3` (uniform vec3):
os dois caminhos de material (`DirectMaskedPhysicalLightingModel` e Hapke) só
fazem `lightColor.mul(mask)` — um vec3 passa sem tocar shader; o HUD (F8.6)
exibe a luminância do vec3.
- Aceite: captura de lua na penumbra profunda — tom cobre/cinza-avermelhado,
  nunca cinza neutro; selfcheck: R > G > B com umbra parcial.

### F9.7 — Capuz polar de Titã sazonal (S37)
`titanSurface` pinta hood norte **fixo** (`moonMaterials.ts:137-138`); real,
ele migra norte↔sul com lag de ~2 anos. Reusar **exatamente** a ferramenta do
F9.3 (função pura de `jd − lag`): polo de inverno lagged recebe o hood
(`mix` por `smoothstep(0.72, 0.95, ±lat)` com sinal sazonal), transição
contínua. Na data default (2026), forcing ~2024 → hood re-formando no norte.

---

## 7. Onda 7 — Assets + performance adaptativa (prefixo `F10`) — Esforço L

### F10.1 — Tiers de resolução por preset (sem dependências novas)
- Bake de derivados `textures/1k/`, `textures/2k/` (sharp/canvas) a partir dos
  originais; `textures.ts` escolhe o diretório por `quality.name`.
- **ISENTO de tiers: `starmap.jpg`** (revisão: estrelas são fontes pontuais —
  downscale as apaga por aliasing; no Low, o starfield procedural já é o
  fallback). Custa só 1,2 MB — a isenção é por aliasing, não por peso.
- **Relief: o preset Low NÃO baixa relief** (revisão v2.1: os PNGs de DTM somam
  ~9,8 MB — enceladus_normal sozinho tem 3,5 MB — e a tesselação 96×48 do Low
  desperdiça a resolução; o fallback procedural já existe por design em
  `textures.ts`). Med/High/Ultra baixam normalmente (tier único).
- **Orçamento restaurado:** preset Low baixa < 6 MB (fica ~4–5 MB com tiers 1k
  e sem relief) — medir e registrar no commit.
- Aceite corrigido (typo da v1): **mesma câmera e mesmo preset, originais vs
  tier** — diff médio por pixel < 2/255 nos corpos texturizados.

### F10.2 — KTX2/Basis (opcional dentro da onda)
- Toolchain externa (`toktx`) documentada no script, modelo `bake-rings.mjs`.
- `KTX2Loader` com transcoder em `public/basis/`; **usar
  `await ktx2Loader.detectSupportAsync(renderer)`** — o `detectSupport`
  síncrono é o caminho WebGL (na r178, `KTX2Loader.js:181`).
- **Armadilha (revisão):** o caminho `.ktx2` deve replicar fielmente o pós-load
  do `TextureLoader`: `offset.x = 0.5` (alinhamento de longitude — sem isso as
  luas giram 180°), `RepeatWrapping`, `anisotropy = 8`, e color space por uso
  (albedo = sRGB; height/normal = linear — hoje `NoColorSpace`,
  `textures.ts:80-81`).
- Aceite: memória de texturas ↓ ≥ 60% nos mapas 4K (`renderer.info.memory`
  antes/depois no commit); paridade visual por captura.

### F10.3 — Resolução dinâmica
- Controlador em `main.ts` sobre o acumulador de FPS existente: banda 55–60 fps,
  clamp `[0.75, quality.dprCap]`.
- **Endurecimento (revisão):** degraus de DPR **quantizados** (ex.
  0,75/1,0/1,25/1,5/2,0 — cada `setPixelRatio` realoca os RTs dos PassNodes =
  hitch); mudança só após **2 janelas consecutivas de 1 s** fora da banda;
  pausar com `document.hidden` e durante `engine.capturing`; DPR efetivo no HUD.
- `autoTuneDown` one-shot vira fallback só do primeiro segundo.

### F10.4 — LOD de geometria de luas
- 3 esferas compartilhadas; troca por distância a cada 0,5 s com histerese 10%.
- **Armadilha:** tier alto obrigatório quando `relief` (DTM) ativo e a lua
  ocupar > N pixels — senão o relevo colapsa. Hyperion fora (geometria própria).
- Aceite: captura close-up de Mimas (DTM) pixel-idêntica à atual.

### F10.5 — Preload seletivo
`<link rel="preload">` dos 3 maiores assets do tier ativo; respeitar `BASE_URL`.

---

## 8. Onda 8 — Completude do sistema (prefixo `F11`) — Esforço M/L

### F11.1 — Luas menores + Phoebe

| Lua | a (km) | r (km) | Notas |
|---|---|---|---|
| Pan | 133.584 | ~14 | fenda Encke |
| Daphnis | 136.505 | ~3,8 | fenda Keeler; gera as ondas |
| Atlas | 137.670 | ~15 | fora do anel A |
| Prometheus | 139.380 | ~43 | pastor interno do F; gera streamers |
| Pandora | 141.720 | ~40 | pastor externo do F |
| Janus | 151.460 | ~89 | co-orbital — ver regra horseshoe |
| Epimetheus | 151.410 | ~58 | co-orbital — ver regra horseshoe |
| Phoebe | ~12.950.000 | 106,5 | retrógrada, rotação 9,27 h, albedo ~0,08 |

Regras (à prova de loopholes, da revisão):
- **`MINOR_MOONS` separada de `MOONS`**: sem slots de sombra —
  `MOON_SHADOW_COUNT` permanece 8. Recebem `eclipseLight` (escurecem na umbra).
- **PHOEBE — CONVERSÃO DE FRAME OBRIGATÓRIA:** os elementos do JPL SSD para
  Phoebe são referidos à **eclíptica** (plano de Laplace dela ≈ plano orbital
  de Saturno, ~26,7° do equador); `data/saturn.ts` é no frame **equatorial**.
  Copiar i ≈ 175° direto desorienta a órbita em até ~27°. Converter compondo
  com a rotação de polo já usada em `sunDirection.ts` (momento angular na
  eclíptica → matriz polo Saturno → extrair novos `iDeg`/`nodeDeg` **e
  recalcular `periDeg` a partir do novo nodo ascendente** — muda o nodo, muda
  o periápsis). Selfcheck: órbita resultante retrógrada (i > 90°) e normal
  orbital dentro da tolerância de uma referência independente (HORIZONS —
  ⚠ VERIFICAR valor esperado). Alcances OK: apoápsis ~15.000 u <
  `ORBIT_MAX_DISTANCE` 25.000 < `SUN_FOLLOW_DISTANCE` 40.000.
- **JANUS/EPIMETHEUS — horseshoe:** Δa = 50 km < 147 km de raios somados; com
  elementos fixos os meshes se interpenetram a cada ~3,8 anos simulados.
  **Decisão (b):** igualar os períodos (par co-rotante com Δλ fixo, documentado
  no README); a troca de órbitas real fica como trabalho futuro anotado. Pinar
  a época dos elementos na tabela (os `a` do JPL para esse par são dependentes
  de época).
- **Phoebe é o primeiro corpo não-síncrono de rotação uniforme:** novo ramo em
  `SaturnSystem.update` — `rotationPeriodH && !tidallyLocked` →
  `rotation.y = (jd·24/rotH)·2π`. Selfcheck de kepler: órbita retrógrada
  percorre sentido horário vista de +Y.
- **Formas (emenda v2.3 — a v2.1 prescrevia "esfera deformada" para todas e
  errava as três assinaturas visuais):** **Pan, Atlas e Daphnis são os
  "raviólis"** — esferóide com **crista equatorial** (o traço-assinatura de
  toda referência; o aceite de zoom no Keeler os deixaria irreconhecíveis) —
  variante com crista (perfil tipo `hyperionGeometry` modificado: lóbulo
  equatorial aditivo); **Prometheus, Pandora, Janus, Epimetheus** — molde
  irregular genérico alongado; **Phoebe é quase esférica** (relaxada,
  ex-centauro) — esfera lisa com relevo sutil, NÃO deformada. Material
  fallback icyBase; Phoebe com tint escuro (albedo ~0,08 ⚠).
- HUD: lista com headers "Major"/"Minor" (rolagem já existe, `hud.css:71-72`).

### F11.2 — Ondas de Daphnis WINDOWED (corrigido pela revisão)
As ondas reais existem **só na esteira de Daphnis**, amortecendo em dezenas de
graus (PIA11656). **Regra de cisalhamento Kepleriano (v2.1 — corrige inversão
da v2):** o material da borda **interna** orbita mais rápido que a lua → após a
conjunção avança → ondas **à frente (leading)**; o material da borda **externa**
é mais lento → fica para trás → ondas **atrás (trailing)**. É o zigue-zague de
PIA11656/PIA11654 (Weiss, Porco & Tiscareno 2009):
- `Δru = A · sin(k·(θ − θ_D)) · envelope(θ − θ_D) · máscaraDeBorda` — fase presa
  à longitude de Daphnis (disponível via `orbitalAngleAt` após F11.1; novo
  uniform com o ângulo da lua, atualizado por frame). As ondas **viajam com a
  lua**. Perturbar a **amostra** do perfil, nunca a geometria.
- Licença artística documentada: o comprimento de onda real (~100–200 km) é
  subpixel na escala do sistema; `N ≈ 30–40 lobos` é exagero deliberado para
  legibilidade — anotar em comentário.
- Fade por `fwidth` a distância (padrão do grain existente, `ringsMaterial.ts:133`).

### F11.2b — Streamers de Prometheus no anel F
Mesma infraestrutura do F11.2 (perturbação com janela azimutal presa à
longitude da lua) aplicada às bordas do anel F — os "streamer-channels" de
PIA08397. **Pela mesma regra Kepleriana: Prometheus é interior ao anel F (mais
rápido) → os canais ficam ATRÁS (trailing) da lua** — observado a dezenas de
graus atrás de Prometheus (Murray et al. 2008 ⚠ VERIFICAR geometria na
referência). Custo marginal depois do F11.2.

### F11.3 — (Opcional) Taxas seculares de nodo/periápsis
`nodeRateDegPerDay?`/`periRateDegPerDay?` em `OrbitalElements`; re-amostragem
das linhas de órbita quando `|Δjd| > 30 d`. Valores JPL ⚠ — se indisponíveis,
adiar.

---

## 9. Onda 9 — Eventos + polish final (prefixo `F12`) — Esforço M

### F12.1 — Navegador de eventos (com semântica de recorrência)
- `src/data/events.ts`: varredura numérica em runtime (passo 6 h + bisseção),
  janela hoje ± 5 anos, usando `sunDirectionAt`/`elementsToPosition`/
  `saturnShadowOnMoon`. Boot < 50 ms (medir; se estourar, JSON baked).
- **Eventos recorrentes materializam só a PRÓXIMA ocorrência** a partir do
  tempo simulado atual, recalculada on-demand (revisão: apoápsis de Enceladus a
  cada 1,37 d ≈ **~2.700 ocorrências** na janela — nunca listar todas).
- **Categorias raras declaradas:** solstícios (2017-05, ~2032) estão FORA da
  janela ±5 anos — a categoria existe com rótulo "próximo em 2032" (varredura
  estendida só para eventos lentos) ou é omitida; o selfcheck não pode passar
  vacuamente: cada categoria é não-vazia ou explicitamente marcada como rara.
- **Oposições exigem efeméride da Terra — dependência nova:** adicionar
  `EARTH_HELIOCENTRIC` a `data/saturn.ts` (elementos médios J2000, mesma forma
  de `SATURN_HELIOCENTRIC` — barato e também habilita "distância da Terra" no
  info) ou cortar a categoria. Decisão default: adicionar a Terra.
- Categorias: cruzamento solar do plano dos anéis (⚠ validar: equinócio
  2025-05-06), solstícios (raros), oposições (via Terra), trânsitos de sombra
  de Titã no globo, próximo apoápsis de Enceladus (liga com F9.2).
- Selfcheck `wave5.selfcheck.ts`: cada evento na janela esperada ±2 dias
  (referências ⚠ JPL); sanidade de recorrência (próximo apoápsis < 2 d).
- HUD: painel "Events" com nome + data UTC; clique → `clock.jd` + foco.
- **Salto de evento ajusta velocidade/pausa (varredura, com exemplos corrigidos):**
  janelas curtas passam antes de o usuário orientar a câmera — trânsito de
  sombra de Titã (~6 h sim ≈ 6 s reais a 1 h/s) e pico de plumas no apoápsis.
  Política: ao saltar, sugerir velocidade adequada por categoria (trânsito →
  1 min/s ou pausa no ápice −30 min; apoápsis → 1 h/s). Requer API nova no HUD:
  `Hud.setSpeed/setPaused` (hoje o HUD não marca velocidade programaticamente).
- Aceite: saltar para o equinócio mostra anéis de perfil sem NaN (gate Fix 1.2).

### F12.1b — Pale Blue Dot: a Terra renderizada
O F12.1 já paga o custo de `EARTH_HELIOCENTRIC` (para oposições) — renderizar a
Terra como **sprite** (padrão do disco solar, nunca Points) + label recria a
foto mais famosa da Cassini (PIA17172, "The Day the Earth Smiled") com física
que o projeto já terá: posição por `EARTH_HELIOCENTRIC`, fase iluminada pelo
ângulo Terra-Sol-câmera, azul pálido.
- **Ressalva de enquadramento (verificação):** elongação máx. vista de Saturno
  ~6° → a Terra está sempre perto do Sol no céu; o framing correto é com o
  **Sol eclipsado por Saturno** (o sim já suporta — gate de glare existente).
- Não entra na lista de corpos focáveis principais — label próprio sutil.

### F12.1c — (Opcional) Postcards [M]
Galeria de poses curadas ("a hora dourada dos anéis", "eclipse de Titã", "Pale
Blue Dot") — a serialização do F8.3 já é exatamente a tupla necessária
(`focus,jd,speed,cam`). Resolve o "onde/quando olhar" sem navegar.

### F12.2 — Mobile
- Preset inicial automático: `maxTouchPoints > 0` + tela < 900 px → `low`/`med`
  (respeitando escolha manual posterior — `TUNED_KEY`).
- **`touch-action: none` no canvas**, `viewport-fit=cover` + `safe-area-inset`
  no sheet inferior; info panel vira sheet (hoje some < 720 px — `hud.css:249`);
  alvos de toque ≥ 40 px.

### F12.3 — Acessibilidade
`prefers-reduced-motion` (sem Drift/Cinema automático); `aria-label` nos botões
icônicos; `role="status"` na data/FPS.

### F12.4 — (Opcional) PWA
Manifest + SW cache-first das texturas do tier ativo, cache versionado pelo
hash do build. Corte se não ficar sólido em 1 dia.

### F12.5 — (Opcional) Smoke browser em CI
Playwright em job separado (nightly): boot nos dois backends, zero erros de
console, `step`+`capture` com variância > limiar, circularidade do Sol
(ocupação da bounding box ≤ 0,80 — métrica herdada da Onda 3). **Asserção
anti-vácuo (varredura):** em CI headless o WebGPU pode cair para WebGL2
internamente e "dois backends" rodaria o mesmo backend com tudo verde —
afirmar `backendName === 'WebGPU'` no run WebGPU e `'WebGL2'` no forçado.

---

## 10. QA de regressão contínua (consolidado)

**Regra de ouro (S31):** identidade/diff SÓ em `?post=raw` + `?quality=X&notune`
+ DPR pinado; cenários de monotonicidade/aparência podem usar `full`.

Aos cenários existentes (F7.6) somam-se, deste plano:
1. Sweep de EV 0,5/1,4/2,6 (Onda 0).
2. Sol entrando no anel B — luminância monotonicamente decrescente (Onda 0).
3. Plumas em pico vs vale (F9.2 — número no selfcheck, captura é sanidade);
   spokes equinócio vs solstício (F9.1).
4. Enceladus: aproximação com compute gated — sem "erupção" (F8.5).
5. Keeler em zoom: ondas viajando com Daphnis (F11.2); F com streamers
   trailing (F11.2b).
6. Equinócio via navegador de eventos (F12.1).
7. Entrada de umbra de Enceladus: lua, **plumes** e anel F apagam juntos (F9.4).
8. Lua na penumbra profunda: tom avermelhado, nunca cinza (F9.6).
9. Periélio vs afélio: exposição global sutilmente diferente (F9.5).
10. Pale Blue Dot: Terra + Sol eclipsado por Saturno no mesmo frame (F12.1b).
Todos nos dois backends (com asserção de `backendName`, F12.5), via
`__saturn.step` + `engine.capture` + `?post=` + `?qa=1` em produção.

---

## 11. Gotchas globais (não redescobrir)

1. **WGSL `smoothstep` exige `edge0 < edge1`** — inverter via `oneMinus(...)`.
2. **AgX engana:** calibração de radiância é visual, por captura.
3. **Ordem do frame:** corpos → controls → `sun.update`/`followCamera` com a
   pose final; novo uniform solar segue a ordem ou atrasa 1 frame.
4. **Layers:** 0 beleza / 1 semente solar / 2 disco. Mover o disco de layer
   reintroduz o bloom quadrado.
5. **Bloom quadrado:** beautyBloom jamais amostra o disco.
6. **`SpriteNodeMaterial`, nunca `Points`** (WebGPU rasteriza points a 1 px).
7. **`positionNode` override quebra `positionLocal` no fragment** — usar `uv()`.
8. **Capturas só via `engine.capture()`** (nunca outro caminho; nunca
   `setSize` dentro dela — bug de frame preto do PassNode, guardado em
   `wave4.selfcheck.ts:124-128`).
9. **Precisão f32:** fases longas embrulhadas (padrão `cloudPhaseUniform`).
10. **Extinção solar: tint × visibilidade, uma vez por caminho (pós-22:00).**
    `solarTintUniform` carrega SÓ a transmitância atmosférica (sem bake-in de
    visibilidade — `main.ts:205-210`); o disco multiplica `tint ×
    sunVisibilityUniform` no próprio material (`Sun.ts:120-125`); o glare
    multiplica `solarGate = tint × vis` no grafo (`Engine.ts:140`). Aplicar vis
    no tint E no gate reintroduz o vis² acidental que a re-revisão eliminou.
    O disco desenha **depois** das shells transparentes (`renderOrder = 1000`);
    com blending aditivo e alpha alto no limbo, `renderOrder` negativo vira
    buraco preto no ocaso (bloqueante A2 da Onda 4 — **nunca voltar**). A
    atenuação do Sol através dos anéis NÃO vem de alpha blending; vem de
    `sunVisibilityFromCamera`.
11. **`localStorage` pode lançar** — padrão try/catch de `quality.ts`.
12. **Selfchecks são contrato** — reescritos na mesma onda que substitui a
    arquitetura; `npm run check` nunca fica vermelho "temporariamente".
13. **Windows/LF→CRLF:** avisos cosméticos — não commitar whitespace.
14. **Números ⚠ VERIFICAR** não vão para produção sem fonte primária citada.
15. **Conversão de frame orbital:** elementos JPL de satélites irregulares
    vêm na eclíptica; a tabela do projeto é no equador de Saturno — converter
    nodo/inclinação **e recalcular o periápsis** (F11.1).
16. **Glare redondo é pintado no seed** (core + saia Lorentziana janelada);
    **nunca** reintroduzir BloomNode largo no caminho solar — mips quadrados/
    lavanda sobre fonte pontual (re-revisão da Onda 4);
    `wave4.selfcheck.ts:120-123` proíbe por regex (`bloom(solarPass, 0.xx,
    0.4+)`). O softener `bloom(solarPass, 0.35, 0.12, 0.25)` atual é o teto de
    raio permitido. E **nunca** reintroduzir `anamorphic(solar…)` — proibido
    por `wave3.selfcheck.ts:168-171` (artefato bead/barra azul).
17. **Determinismo de captura:** o `FilmNode` usa `time` de wall-clock
    (S31) — comparações de identidade SÓ em `?post=raw`/`filmGrain=0` com DPR
    pinado; `?quality=<preset>&notune` pina preset e desliga o auto-tuner
    (que pode recarregar a página no meio de um run headless).

---

## 12. Fora de escopo global

- God rays / volumetria espacial; shadow maps; múltiplas luzes; IBL.
- Integração N-corpos / efemérides online; ressonâncias exatas; troca real de
  órbitas Janus/Epimetheus (F11.1 usa par co-rotante documentado).
- Eclipses mútuos entre luas (possível Onda 10+); tint de ocaso para Titã (S29).
- VR/XR, áudio, backend; i18n completo; refração geométrica do disco.

---

## 13. Harness de verificação (referência rápida)

```text
npm run dev                  # dev server
window.__saturn.step(dt)     # avança 1 frame (headless)
window.__saturn.engine.capture(largura, withPost)  # PNG data-URL
?post=raw|bloom|anamorphic|flare|full              # A/B do pipeline
?webgl                       # força WebGL2
?quality=low|med|high|ultra&notune                 # pina preset, desliga tuner (Onda 0)
?qa=1                        # expõe __saturn em build de produção (Onda 0)
npm run check                # kepler + wave1–4 (+ novos por onda)
```

Capturas por onda vão para `output/`. Todo fechamento de onda anexa: capturas
antes/depois nos dois backends, FPS do HUD e o diff do `npm run check`.

---

## 14. Definição de pronto do programa

- [x] Sol físico com glare 100% do pós, fonte de luz única (F7 — **concluído**).
- [ ] Zero tela preta: loading com progresso; primeiro paint < 100 ms.
- [ ] Zero reload: qualidade automática por resolução dinâmica.
- [ ] Sistema completo: 8 maiores + 8 menores (formas reais: raviólis Pan/
      Atlas/Daphnis, Phoebe esférica), Phoebe retrógrada (frame convertido),
      ondas de Daphnis windowed, streamers de Prometheus trailing.
- [ ] Física sazonal completa: spokes, plumes, matiz hemisférico, **irradiância
      e diâmetro solares por distância**, **sombra do planeta nos transparentes
      (plumes/F/E)**, **eclipses avermelhados**, **capuz de Titã migrante**.
- [ ] Links compartilháveis de qualquer momento (URL state + pose), eventos
      com velocidade adaptada e **Pale Blue Dot** enquadrável.
- [ ] HUD vivo (luz solar %, fase, tamanho aparente), labels com oclusão real,
      date picker, share, picking, ajuda descobrível.
- [ ] QA falsificável: gates de identidade em `raw`/grain-0, `?quality&notune`,
      `__saturn` via `?qa=1` em produção, `deploy.mjs` aborta sem check verde.
- [ ] Docs verdadeiros: README, AGENTS.md, NOTICE e comentários sem nenhuma
      afirmação contraditória com o código.
