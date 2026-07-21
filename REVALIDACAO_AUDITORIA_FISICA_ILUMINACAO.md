# Revalidação independente — auditoria de física e iluminação

**Projeto:** Saturn WebGPU / Three.js  
**Commit revalidado:** `c190a8a` (`main`)  
**Documento de entrada:** `AUDITORIA_FISICA_ILUMINACAO_PARA_REVALIDACAO.md`  
**Data desta revalidação:** 2026-07-20  
**Escopo:** leitura de código, verificação numérica pontual e cruzamento com o runtime descrito na auditoria. **Nenhuma correção foi implementada.**

## Objetivo

Este arquivo responde à auditoria externa item a item, para uma terceira (ou a mesma) IA re-analisar. Não trata conclusões como autoridade: cada veredito traz evidência e classificação.

Para cada item, a resposta usa um de:

- **confirmado** — evidência de código e/ou matemática suficiente
- **confirmado com nuance** — correto no essencial, com ressalva
- **inconclusivo** — plausível, sem reprodução runtime nesta sessão
- **reclassificado** — sintoma ou impacto ok, causa ou severidade ajustada
- **refutado** — não se sustenta (nenhum P0 foi refutado)

Classificação extra quando aplicável:

- **bug físico / de consistência**
- **aproximação visual deliberada**
- **dívida / overclaim de documentação**
- **preferência estética**

---

## Resumo executivo

A auditoria externa **melhora e corrige** o relatório original de investigação:

1. Acerta o problema central da sombra dos anéis (albedo × ambient) e eleva a correção correta: atenuar **somente a luz direta**.
2. Reclassifica bem o “sol quadrado”: sintoma real; causa dominante observada no pós-processamento, não mipmap sozinho.
3. Introduz P0s independentes de alta relevância que o relatório original **não cobriu**: snap de câmera, parallax do sol, penumbras, singularidade no equinócio, atmosfera (oclusão + alpha), convenção Hapke/HG.

Nenhum P0 da auditoria foi refutado. Há **loopholes correlatos adicionais** (secção G) que merecem entrar no mesmo backlog de consistência.

A ordem de correção da auditoria (secção E do doc original) é sólida; sugere-se apenas adiantar B1 (câmera) e B5 (equinócio) por serem baratos e testáveis sem look-dev.

---

## Checklist F — respostas

| # | Pergunta | Veredito | Evidência |
|---|----------|----------|-----------|
| 1 | A sombra no `colorNode` escurece de fato o `AmbientLight` no shader final? | **Confirmado** | `saturnMaterial.ts` faz `colorNode = color.mul(shadow).mul(transits)`. `PhysicalLightingModel.indirectDiffuse` usa `diffuseColor`. `Sun.ts` adiciona `AmbientLight(0.035)`. |
| 2 | Um `LightingModel` customizado consegue atenuar somente `directDiffuse` nesta versão do Three? | **Confirmado (API)** | `MoonNodeMaterial` / `HapkeLightingModel` já implementam `direct({ lightColor, reflectedLight })` e escrevem em `reflectedLight.directDiffuse`. Three r178 expõe o hook. |
| 3 | A rota Hapke realmente ignora toda iluminação indireta? | **Confirmado** | `hapke.ts`: `indirect()` vazio (comentário: night sides fisicamente pretos salvo saturnshine emissive). Ambient **não** chega às luas Hapke. |
| 4 | O Sol permanece circular em raw e fica quadrado somente ao habilitar quais passes? | **Confirmado com nuance** | Aceita-se o teste comparativo da auditoria (raw circular; post completo → halo quadrado/largo + streaks). Nesta sessão o A/B de passes isolados **não** foi reexecutado. |
| 5 | Desabilitar mipmaps altera o defeito em escala pequena? | **Inconclusivo** | Risco real (`CanvasTexture` defaults); não demonstra sozinho o A/B com bloom. Hardening recomendado, não causa dominante. |
| 6 | A direção visual do Sol diverge de `sunDir` perto de Iapetus? | **Confirmado** | Billboard em `origin + sunDir × 24000`. Em Iapetus (~3560 u), parallax ≈ `atan(3560/24000) ≈ 8,4°`. |
| 7 | O gate do flare usa direção diferente da posição visível do billboard? | **Confirmado** | `main.ts`: `saturnShadowOnMoon(camera.position, sunDir, …)` — oclusão ao longo de `sunDir`, não `normalize(diskPos - camera)`. |
| 8 | O snap de foco é reproduzível e causado pelo `minDistance` antigo? | **Confirmado** | Ver B1 abaixo. Números batem com a tabela da auditoria. |
| 9 | O denominador da sombra produz zero/NaN para algum `S.y` próximo de zero? | **Confirmado** | Em `S.y = -1e-5`, `denom = 0` → `1/denom = Infinity`. |
| 10 | Os limites atuais de penumbra correspondem apenas a metade da zona geométrica? | **Confirmado** | Umbra cheia até `dMin = REQ`; anéis com largura ~`pen` centrada no limbo, não ~`2·pen`. |
| 11 | Titan pode ou não mostrar penumbra espacial em sua superfície? | **Confirmado: não pode** | Um escalar `eclipseLight` no **centro** da lua (`SaturnSystem.ts`). |
| 12 | O raymarch ilumina amostras cujo raio solar atravessa o corpo? | **Confirmado** | Só aproximação Chapman; sem teste raio→esferoide em direção ao sol. |
| 13 | O blend final multiplica `colorOut` novamente por `opacityNode`? | **Confirmado (pipeline)** | `premultipliedAlpha` default false; `opacityNode` → `diffuseColor.a`; blend clássico `src × srcAlpha`. |
| 14 | A convenção HG atual favorece fase de 180° para `g < 0`? | **Confirmado** | `cosg = dot(L,V)`; `P(-1)/P(+1) ≈ 5,62` com `g = -0,28`. |
| 15 | Os resets de nuvem e F-ring produzem descontinuidade? | **Confirmado (por construção)** | `cloudPhase = (jd % 97.5) / 9.75`; F-ring usa `spokePhase` (periódico em `2π`) como coordenada Z linear de ruído. |
| 16 | Os elementos orbitais pertencem de fato ao frame/epoch declarado? | **Confirmado como risco / não-efeméride** | Comentários admitem Laplace/precessão; não verificado byte-a-byte contra SAT441. |
| 17 | A orientação de Iapetus mantém a mesma face apontada para Saturno? | **Confirmado: não de forma rigorosa** | Só `rotation.y = orbitalAngle + π`; inclinação ~15,47°. |
| 18 | `normalize(vec3(V.x, 0, V.z))` é seguro nos dois backends se o vetor for zero? | **Confirmado risco** | Vista polar exata → vetor nulo; NaN/zero backend-dependent. |
| 19 | A rota `/__shot` fica inacessível em builds de produção e limitada em desenvolvimento? | **Confirmado parcialmente** | Inacessível no bundle Pages (plugin Vite dev-only). **Não** limitada em dev (sem Content-Length, token ou bind localhost). |

---

## A. Reavaliação do relatório original (secção A da auditoria)

### A1. Sombra dos anéis no albedo — **confirmado**

**Código:** `src/materials/saturnMaterial.ts` (~121–155), `src/scene/Sun.ts` (~47–48).

O comentário “equivalente com um sol e ambient quase zero” **não se sustenta** com `AmbientLight(0.035)`.

**Correção:**

```text
Lfinal = Ldirect * ringShadow * moonTransits
       + Lindirect
       + Lemissive
```

**Nuance importante (acordo com a auditoria):**  
`shadow *= saturate(N·L)` no albedo é **paliativo**:

- ainda escurece indireto no lado diurno;
- reaplicaria peso de cosseno perto do terminador se o BRDF já tiver `N·L`.

**Detalhe extra a favor do código:** o ringshine emissive usa a variável `color` **antes** do `.mul(shadow)`:

```ts
material.colorNode = color.mul(shadow).mul(transits);
material.emissiveNode = color.mul(shine).mul(night)... // unshadowed albedo base
```

Ou seja: a faixa dos anéis **não** entra no ringshine; entra no ambient via albedo sombreado.

### A2. Eclipse das luas no albedo — **confirmado com nuance da auditoria**

**Código:** `moonMaterials.ts` (~234–236), `hapke.ts` (~71–79).

| Caminho | Efeito de `colorNode *= eclipseLight` |
|---------|----------------------------------------|
| Hapke (luas com mapa) | ≈ atenuar só o sol (sem indireto) |
| Standard / Titan / fallback | ambient também é escurecido |

**Impacto:** física aparente **depende do material/asset**. Não é um único bug uniforme.

### A3. Sol quadrado — **reclassificado (sintoma confirmado; causa original não dominante)**

**Acordo com a auditoria:**

| Observação | Status |
|------------|--------|
| Disco circular sem pós | Aceito (teste da auditoria) |
| Halo largo/quadrado + streaks com pipeline completo | Aceito |
| Mipmaps como causa única | **Não demonstrado** |
| Bloom / half-res / anamorphic / lensflare | **Causa dominante mais plausível** |
| Disco procedural + `generateMipmaps = false` | Hardening útil |
| Escala angular irrealista | Confirmada (núcleo ~3× raio físico; glow bem maior) |

**Correção de linguagem ao relatório original:** não chamar o quad inteiro (1,67°) de “disco solar”; separar núcleo, glow e artefato de post.

### A4. Itens originais que permanecem válidos — **confirmados**

- Ringshine principalmente por latitude; night mask por posição, não normal do esferoide.
- Raymarch sem sombra dos anéis.
- Flare por oclusão aproximada de ponto, não overlap de disco.
- Saturno base ~Lambert; limb na atmosfera.
- God rays, ringshine azimutal, TAA/OIT, multi-scatter: melhorias **depois** da consistência.

---

## B. P0 da auditoria — revalidação

### B1. Snap ao focar lua — **confirmado**

**Código:** `src/camera/FocusControls.ts` (~47–90) + `OrbitControls.update()`.

Fluxo:

1. Durante a transição, a pose é escrita em `camera.position` / `target`.
2. `minDistance` **novo** só é instalado em `t >= 1`.
3. `this.controls.update()` roda **sempre** e reaplica `_clampDistance` no raio esférico.

Valores com foco saindo de Saturno → Mimas:

| Grandeza | Valor ≈ |
|----------|--------:|
| `minDistance` antigo (Saturno) | `60.268 × 1.35` = **81,36** |
| framing alvo (`radius × 5.5`) | **1,09** |
| `minDistance` final (Mimas) | **0,28** |

Durante o voo a distância é pinada ~81; no fim o limite muda e a pose desejada aparece → **snap**.  
O comentário no código (“clamping mid-flight would snap”) está **invertido** face ao runtime: **adiar** o `minDistance` é o que causa o salto.

**Classificação:** bug funcional de câmera (P0 UX).

### B2. Sol finito vs luz direcional — **confirmado**

Três canais desalinhados:

1. Billboard: `origin + sunDir × 24000`
2. Luz: direção global `sunDir` (infinita)
3. Flare: oclusão de ponto da câmara ao longo de `sunDir`

Perto de Iapetus o parallax (~8°) é material.  
Starfield/sky em ~30k/55k sofrem o mesmo tipo de erro, em geral menos óbvio.

**Classificação:** bug de consistência geométrica (P0 visual/físico).

### B3. Penumbra planeta → lua — **confirmado**

```ts
pen = tStar * SUN_ANGULAR_RADIUS + 0.02;
x = (dMin - REQ) / pen; // escuro total para dMin < REQ
```

Para sol de raio angular finito, a zona parcial deve atravessar aproximadamente `REQ - pen` … `REQ + pen`, com umbra a encolher com a distância. O modelo atual:

- umbra **larga demais**;
- transição **~metade** da largura geométrica esperada.

Titan: `pen ≈ 0,63` u (~630 km); Iapetus: `pen ≈ 1,79` u — não desprezível.

Eclipse da lua inteira = escalar no centro → **sem gradiente espacial** (Titan).

### B4. Penumbra planeta → anéis — **confirmado**

`clamp((dMin - R) / pen + 0.5, 0, 1)` → transição de largura `pen`, não `~2·pen`.

**Contraste interno do projeto:** `moonTransits.ts` usa `smoothstep(rM - rSun, rM + rSun, perp)` — penumbra **melhor modelada** que o eclipse planetário. Dois modelos de sol finito no mesmo frame.

### B5. Denominador no equinócio — **confirmado numericamente**

```ts
const denom = add(S.y, mul(step(abs(S.y), float(1e-5)), 1e-5));
```

| `S.y` | `denom` | `1/denom` |
|------:|--------:|----------:|
| `-2e-5` | `-2e-5` | finito |
| **`-1e-5`** | **`0`** | **`Infinity`** |
| `-5e-6` | `5e-6` | grande |
| `0` | `1e-5` | finito |

Além de divisão por zero, o “remendo” `+1e-5` só dentro de `|S.y| ≤ 1e-5` cria salto na borda do threshold.

**Classificação:** bug numérico P0 (equinócio / datas próximas).

### B6. Atmosfera iluminada através do corpo — **confirmado; ligeiramente pior que o texto**

```ts
const sunPath = float(1.0).div(max(upSun.mul(0.9).add(0.12), 0.02));
```

- Sem interseção raio amostra→sol com o esferoide sólido.
- Piso `0.02` impede path infinito, mas **nunca anula** o sol geométrico atrás do corpo.
- Titan haze e plumas de Enceladus **não** herdam `eclipseLight` (só a superfície).

### B7. Dupla contagem de alpha na atmosfera — **confirmado no pipeline**

```ts
material.colorNode = output.rgb;   // radiância integrada
material.opacityNode = output.a;
```

Com straight-alpha e `premultipliedAlpha === false`, o blend multiplica RGB por α. Regime opticamente fino: radiância ~ τ e α ~ τ → contribuição ~ **τ²**.

### B8. Convenção HG / Hapke — **confirmado**

- Oposição: `dot(L,V) → +1`
- Código alimenta HG com esse `cosg` e `g < 0`
- Resultado: HG puxa para fase alta; opposition surge puxa para fase 0 → **termos em conflito**

| `g` | `P(-1) / P(+1)` ≈ |
|----:|------------------:|
| -0,28 | 5,62 |
| -0,35 | 8,96 |

Após corrigir a convenção, **recalibrar** amplitudes.

---

## C–D. P1 e robustez — vereditos curtos

| ID | Veredito | Nota |
|----|----------|------|
| C1 transmissão vs `Bsun` | Confirmado | `1 - α·k` fixo; B densa em rasante clara demais se se alegar física |
| C2 pisos equinócio | Confirmado | 10% face / 15% ringshine com `\|S.y\|=0` — hack visual |
| C3 pops temporais | Confirmado | Nuvens + F-ring; plumas em **dt real** mesmo com sim pausada |
| C4 elementos orbitais | Risco real | “Visual mean elements”, não Horizons/SPICE |
| C5 rótulo System III | Confirmado | `10.561 h` ≈ sismologia dos anéis; spokes usam `10.66 h` |
| C6 tidal lock | Confirmado | Crítico em Iapetus |
| C7 haze/plumas sem eclipse | Confirmado | |
| D1 wakes polares | Confirmado risco | |
| D2 `/__shot` | Confirmado | só dev; sem limite de body |
| D3 ring slab UV clamp | Confirmado | |
| D4 oclusões incompletas | Confirmado | flare sem luas; labels esfera equat. |
| D5 TSL deprecated | Aceito | risco de upgrade Three |
| D6 README defasado | Confirmado | ainda diz que luas não recebem sombra de anéis; o código **já aplica** via `saturnShadowOnMoon` |

---

## G. Loopholes / bugs correlatos **não** (ou pouco) cobertos pela auditoria

Itens para a IA re-analisar como candidatos a P0/P1 de consistência:

### G1. Flare = umbra do ponto da câmara, não ocultação do disco solar

Mesmo com parallax corrigido (B2), `saturnShadowOnMoon(camera, sunDir)` responde “a câmara está no cilindro de sombra?”, não “que fração do disco solar está tapada por Saturno/anéis/luas?”.

No limbo, os dois divergem: flare pode acender com sol já parcial/oculto, ou apagar cedo demais.

**Relação:** B2, D4 — mas é bug de **definição de oclusão**, não só de posição do billboard.

### G2. Piso Chapman nunca corta o sol sólido

Mesmo com `upSun < 0`, `sunTrans` permanece > 0. O night limb / halo noturno “sempre um pouco aceso” é mais forte do que só “falta sombra dos anéis no raymarch”.

**Relação:** reforça B6.

### G3. Família de materiais incoerente sob o mesmo sol

| Receptor | Modelo | Ambient three | Sombra/eclipse |
|----------|--------|---------------|----------------|
| Saturno | MeshStandard | sim | no albedo |
| Luas Hapke | custom, sem indirect | não | no albedo ≈ só direct |
| Luas Standard/Titan | Standard | sim | no albedo |
| Anéis | unlit custom | não (via three) | no colorNode unlit |

Trocar asset/fallback **muda a física aparente**. Qualquer fix deve uniformizar a política: “máscaras só no direct; emissive/indireto separados”.

### G4. Dois modelos de penumbra no mesmo frame

Trânsitos de luas: penumbra ~`2·rSun`.  
Eclipse planetário (luas e anéis): ~metade / umbra demais.

Loophole de **consistência de modelo**, além da imprecisão isolada B3/B4.

### G5. Sombra de anéis no globo sem teste “a luz direta chega?”

Além de faltar `N·L` / LightingModel: no night side o raio P→sol atravessa o **interior** do planeta e ainda pode marcar interseção com o plano dos anéis (`toward` verdadeiro). Corrigir só com `N·L` no albedo melhora o sintoma; a pergunta física é “existe contribuição solar direta neste ponto?”.

### G6. `spokePhase` e resto negativo em JavaScript

```ts
spokePhaseUniform.value = -(((jd * 24) / 10.66) * Math.PI * 2) % (Math.PI * 2);
```

Em JS, `-x % m` pode ser **negativo**. Além do pop no wrap (C3), o domínio do ruído do F-ring não é `[0, 2π)`.

### G7. Labels: esfera equat. + sem anéis

`labels.ts` usa `SATURN_R` equat. e ignora oblato e anéis. Perto dos polos (raio polar menor) e atrás de anéis opacos, oclusão de UI falha.

### G8. Segundo solavanco após B1

Ao terminar o focus: `minDistance` novo + `enabled = true` + `enableDamping` ainda ativo no mesmo `update()` pode gerar **micro-snap** secundário além do salto principal.

### G9. Sky/estrelas não centrados na câmara

Universo em shell finito (~30k/55k) com origem em Saturno → parallax errado em overflight/cinema. Menor que o sol (B2), mesma família.

### G10. Calibração visual após fix de sombra/ambient

Night side hoje = ambient baixo × albedo sombreado + ringshine. Ao mover sombra só para o direct e/ou reduzir ambient, o night side **muda de carácter** (possível “regressão” visual mesmo com física melhor). Precisa de shot de referência (ex. PIA08329) na mesma onda do fix.

### G11. Overclaim do README vs implementação

README fala em simulação cientificamente ancorada e trânsitos sazonais “exatos”. Com mean elements sem precessão e frames mistos (C4), a linguagem é mais forte que a implementação → gera falsos “bugs de data” em revalidações futuras.

### G12. AdditiveBlending + `opacityNode` (sol, F-ring, plumas)

Mesma classe de contrato alpha que B7. Menos grave em glows aditivos; relevante se se misturar com NormalBlending ou se o post amostrar RGB pré-alpha de forma inesperada.

---

## H. O que **não** tratar como bug de física

| Item | Classificação |
|------|----------------|
| Sol angularmente maior que o físico | **Estética deliberada** para alimentar bloom/flare — documentar; não “corrigir para 0,028°” sem redesenhar o lens system |
| Pisos 10–15% no equinócio | **Hack visual** — bug só sob alegação fotométrica |
| Mean elements sem precessão | **Scope** de sim visual, se o README for honesto |
| Plumas em tempo de relógio real | Pode ser **feature**; falta decisão explícita produto |
| `rotationPeriodH = 10.561` | Valor defensável (sismologia dos anéis); **só o rótulo** “System III” está errado |

---

## I. Ordem de correção sugerida (ajuste fino sobre a secção E)

A estrutura em 6 etapas da auditoria permanece. Reordenação leve do início:

### Etapa 0 — invariantes e testes (antes de PRs grandes)

1. Testes numéricos umbra/penumbra (limites `REQ ± pen`).
2. `S.y ∈ {-ε, 0, +ε}` na interseção anel–globo.
3. Continuidade da distância câmara–alvo durante `focus()`.
4. Capturas A/B: raw / bloom / bloom+anamorphic / bloom+lensflare.
5. (Novo) Teste de que máscara de sombra **não** altera uma fixture de ambient-only se a API permitir.

### Etapa 1 — wins baratos e determinísticos

1. **B1** snap de focus (`minDistance` / suspender clamp durante lerp).
2. **B5** denominador equinócio (epsilon com sinal ou early-out).

### Etapa 2 — iluminação direta (núcleo A1/A2)

1. `LightingModel` de Saturno: ring shadow + moon transits **só no direct**.
2. Mesma política nas luas Standard; Hapke: multiplicar `lightColor` no `direct()` (ou equivalente), não o albedo, para uniformizar.
3. Ringshine / saturnshine permanecem emissive/indireto separados.
4. Calibrar ambient + night side (G10).

### Etapa 3 — Sol e background (B2, A3, G1, G9)

1. Sol/sky camera-centered ou background direcional.
2. Uma única direção aparente para disco, luz e oclusão.
3. Flare: overlap de disco (ou aproximação angular), não só umbra de ponto.
4. Separar disco vs glow; só então mipmaps/filtros.

### Etapa 4 — eclipses e atmosfera (B3–B4, B6–B7, C7, G2, G4)

1. Limites geométricos de penumbra unificados com o modelo de trânsitos.
2. Oclusão de corpo (+ anéis) no raymarch.
3. Contrato alpha/premultiply.
4. Propagar eclipse a haze e plumas.

### Etapa 5 — anéis, tempo, órbitas (C1–C6, G6)

1. τ e `Bsun` (ou documentar aproximação).
2. Remover pisos arbitrários via disco solar finito.
3. Fases temporais contínuas; módulo seguro do `spokePhase`.
4. Versionar fonte orbital/frame/epoch; tidal lock por base orbital.

### Etapa 6 — melhorias visuais (só depois)

God rays, ringshine azimutal, multi-scatter, TAA/OIT, motion blur, etc.

---

## J. Critério de encerramento desta revalidação

| Critério | Estado |
|----------|--------|
| Cada P0 com evidência de código | **Sim** |
| Runtime A/B sol/post reexecutado nesta sessão | **Não** — confia-se no teste da auditoria; classificado com nuance |
| Snap de focus | **Provado por construção** (OrbitControls + ordem do update) |
| P0 refutados | **Nenhum** |
| A3 reclassificado (causa) | **Sim** |
| Arte vs física separado | **Sim** (secção H) |
| Loopholes adicionais documentados | **Sim** (secção G) |
| Pronto para plano de PRs pequenos | **Sim** |

---

## K. Pedidos concretos à IA que re-analisar este documento

1. Concordar ou contestar cada item da secção **G** (novos loopholes), com severidade P0/P1/P2.
2. Validar se a **Etapa 1** (B1+B5 antes do LightingModel) introduz dependência escondida.
3. Propor a API mínima do `LightingModel` de Saturno compatível com Three r178 (assinatura `direct`, uniforms de sombra, interação com `MeshStandardNodeMaterial`).
4. Dizer se G1 (flare por overlap de disco) deve subir para P0 junto com B2 ou pode ficar na Etapa 3.
5. Indicar se B8 (HG) deve ser corrigido na mesma PR do Hapke que unifica eclipse no `lightColor`, ou separado por risco de regressão visual nas luas.
6. Apontar qualquer item desta revalidação que esteja **errado** ou superestimado, com contra-evidência de código.

---

## L. Mapa rápido: origem do achado

| Origem | Itens |
|--------|-------|
| Relatório original (investigação 1) | A1, partes de A2/A3/A4, ringshine, atmosfera sem anéis, lista visual P2 |
| Auditoria externa | Qualificação A1–A3, B1–B8, C1–C7, D1–D6, ordem E, checklist F |
| Esta revalidação | Confirmações numéricas (B5, B8, distâncias B1), nuance A2/A3, secção G (G1–G12), reordenação Etapa 1, mapa de materiais G3 |

---

*Fim da revalidação. Nenhuma alteração de código foi feita com base neste documento.*
