# RETORNO — Re-revisão da Onda 4 / F7 (rodada de fixes dos 3 bloqueantes)

**Veredito: AINDA NÃO APROVADO — resta 1 bloqueante (A1: o glare agora existe, mas é
uma pilha de QUADRADOS azul-lavanda) e 1 pendência de coerência no ocaso (A2 residual).
A2-preto, A3-WebGPU, B1, B2 e B4 estão corrigidos e verificados.**

Método: diff completo, build + selfchecks (verdes), re-execução visual headless dos
cenários com medição de uniforms e pixels. Evidências novas em `output/onda4-review/`
(f1–f5).

---

## Estado dos itens da revisão anterior

| Item | Estado | Evidência |
|---|---|---|
| **A2 — buraco preto no limbo** | **CORRIGIDO** ✓ | Mesma pose do defeito: centro agora 255/255/255; `renderOrder=1000` + lockstep vis funciona (`f3_zoom.png`) |
| **A3 — capture preto (resize)** | **CORRIGIDO no WebGPU** ✓ | `capture(640)` → 640×360, 89% de pixels com conteúdo. WebGL2: ver nota abaixo — limitação de ambiente, **não é culpa do fix** |
| **B1 — residual 0.97 no eclipse** | **CORRIGIDO** ✓ | Eclipse por Titã: vis = 0.00003 → glare extinto |
| **B2 — noite escura** | **CORRIGIDO** ✓ | Ringshine 0.92: hemisfério sul legível, ainda físico (`f5_night.png`) |
| **B4 — import duplicado** | **CORRIGIDO** ✓ | Um único import `three/tsl` |
| **A1 — sol roxo (glare em falta)** | **PARCIAL — segue bloqueante** | Ver abaixo |
| **A2-coerência — ocaso avermelhado + glare em lockstep** | **PARCIAL** | Ver abaixo |

---

## A1 (restante) — O glare agora existe… e é uma pilha de quadrados frios

**Evidência:** `f2_zoom.png` (FOV 12°, céu livre): núcleo branco redondo minúsculo +
streak violeta horizontal + **três quadrados concêntricos** (um pequeno brilhante, um
médio de bordas nítidas, um gigante fraco), tudo em azul-lavanda. Em quadro aberto
(`f1_zoom.png`) lê-se como um blob quadrado azulado. O critério "glare lê como
estrela" continua reprovado.

**Causa raiz:** `comp.add(solarBloom × vis × 0.55)` compõe o output CRU do BloomNode.
O BloomNode gera mips com upsample em caixa — sobre uma fonte quase pontual, cada mip
vira um QUADRADO visível (é o mesmo "square low-energy bloom halo" que a Onda 1/3
resolveu para a beauty-bloom excluindo o disco — agora reintroduzido pela via solar).
O `lensflare(solarBloom…)` herda os quadrados e os replica como ghosts azulados; o
anamórfico azul por padrão domina a cor.

**Fix recomendado (mata os quadrados por construção, zero passes novos):**
1. **O glow redondo não vem de bloom nenhum — vem do próprio seed.** Pintar o perfil
   de glare no sprite do seed (ele é o portador do lens-glare, não é o "halo pintado"
   que o plano proibiu no disco display): núcleo apertado + saia larga ~r⁻² quente
   (ex.: `core = (1−smoothstep(0, 0.06, r))²` + `skirt = 0.04/(1+(r·22)²)`, cor
   (1.0, 0.94, 0.82)). O sprite é radial → redondo por construção, em qualquer FOV.
2. Compor `solarPass` direto: `comp += solarPass × solarTintUniform × vis × peso` —
   sem BloomNode no caminho do glow visível. (Se precisar de suavidade extra, UM bloom
   de raio pequeno ~0.10–0.15; nunca o de 0.55.)
3. `anamorphic`/`lensflare` passam a ler `solarPass` (ou o bloom apertado) — ghosts de
   fonte redonda são redondos. Tint do anamórfico para quente (o node aceita cor; o
   azul é default) e peso ≤ 0.10: o streak é tempero, não o prato.

## A2 (residual) — Ocaso: preto sumiu ✓, mas não há pôr-do-sol

**Evidência:** `f3_zoom.png` — disco BRANCO puro no limbo (pixels 255) com glare
branco-violeta cheio. O smoke do próprio fix ("disco avermelhado, glare some") não
acontece.

**Duas causas, ambas de calibração/roteamento:**
1. **O tint nunca vence o AgX.** Transmitância (0.75, 0.61, 0.38) × radiância 90 =
   (67, 54, 34) — todos os canais ainda ~30× acima da saturação → branco. Para o
   vermelho aparecer, a extinção de grazing precisa alcançar décadas de atenuação:
   multiplicar os σ por ~6–10 (ex.: k = 2.8 → 18–28) ou aplicar curva de potência,
   calibrando por captura até o disco cair no ombro do AgX (radiância ~1–8) já
   visivelmente laranja antes de extinguir.
2. **A extinção atmosférica não chega ao glare.** No limbo vis=1 (não há anel/planeta
   na LOS), então `solarBloom × vis` fica branco cheio enquanto o disco escurece.
   Sugestão de roteamento limpo: `solarTintUniform` volta a ser SÓ o tint atmosférico
   (sem × vis); disco = `× solarTintUniform × sunVisibilityUniform`; cadeia solar
   inteira (glow + anamórfico + flare) = `× solarTintUniform × sunVisibilityUniform`.
   Um fade, uma cor, tudo em lockstep de verdade — e evita o vis² acidental que o
   arranjo atual criaria se alguém multiplicasse o seed pelo tint combinado.

## A3 — nota sobre WebGL2 (não conta contra o fix)

O novo capture está correto (sem resize, downsample 2D) e verificado no WebGPU.
No WebGL2 com aba OCULTA, `readRenderTargetPixelsAsync` do three nunca resolve
(fence-poll depende de rAF) — sondei por estágio: o render completa, o readback
trava para sempre. O capture antigo usava a mesma API (o sucesso do round 1 foi
circunstancial — pane visível). Robustez opcional para o fecho: fallback síncrono
`readRenderTargetPixels` quando `document.visibilityState === 'hidden'`. A paridade
visual WebGL2 desta rodada fica validada indiretamente (mudanças são todas
backend-agnósticas: grafo de comp, renderOrder, uniforms CPU; build TSL verde nos
dois backends).

## Observações menores (não bloqueiam)

- **Disco sobre os anéis** (renderOrder 1000 + anéis sem depth): através da borda do
  anel A lê plausível (`f4_zoom.png`) — a transmissão radial média via vis cobre o
  caso. Atrás do núcleo do anel B o disco dimmed ainda soma um ponto tênue sobre o
  anel; imperceptível a 3.5 px. Registrado, sem ação.
- O smoke table do fix voltou a ser entregue sem execução visual ("Smoke rápido" —
  esperado vs. verificado). A1-quadrados e A2-branco apareceriam na primeira captura.
  Com A3 corrigido no WebGPU, o protocolo custa minutos — executar antes de reportar.

## Critério de fecho da onda

1. Glare redondo e quente em qualquer FOV (sem quadrados, sem violeta dominante) —
   capturas FOV 45° e FOV 10–12°.
2. Ocaso: disco branco → laranja → extinto, com glare morrendo na mesma curva.
3. Re-rodar os 7 cenários F7.6 no WebGPU + `?post=raw`; WebGL2 com aba visível ou
   fallback síncrono.
4. `npm run build` + `npm run check` verdes (já estão).
