# RETORNO — Revisão da Onda 4 / F7 (Sol físico + fonte única)

**Veredito: NÃO APROVADO — 2 defeitos visuais bloqueantes (A1, A2) + 1 regressão de
QA tooling (A3). A fundação está correta e o resto passa; os fixes são pequenos e
cirúrgicos.**

Método: leitura completa do delta, `npm run build` + `npm run check` (verdes),
e QA visual headless real nos dois backends (WebGPU e WebGL2) — 10 capturas em
`output/onda4-review/`. Os cenários do plano F7.6 foram executados, não apenas
"sugeridos": foi exatamente isso que revelou os bloqueantes.

---

## O que está certo (confirmado com evidência)

| Item | Evidência |
|---|---|
| **F7.1 disco físico** — redondo, borda nítida, sem halo pintado, tamanho derivado de `SUN_ANGULAR_RADIUS` | `s6_disk_zoom.png` (raw, FOV 10°): disco circular limpo; selfcheck w4 confirma a cadeia de constantes |
| **F7.2 gate de oclusão** — Saturno + anéis + luas, suavizado | Numérico: céu livre vis=1.000; através do anel A vis=0.687; umbra vis=0; eclipse por Titã vis=0.030 |
| **Eclipse por Titã** | `s5_titan_eclipse.png`: anel de atmosfera de Titã em volta do disco escuro, glare apagado — lindíssimo |
| **F7.3 fonte única** — sem AmbientLight; noite só com shines | `s4_night.png`: lado noturno físico (escuro), ringshine visível no hemisfério sul |
| **F7.4 penumbra** — 3 taps com clamp perto do equinócio | Código correto (`saturnMaterial.ts`); sem validação visual dedicada (aceitável, ver B3) |
| **F7.5 tint analítico** — matemática exata | Uniform medido (0.742, 0.598, 0.375) no grazing b=61 — bate com o cálculo manual à 3ª casa |
| **Paridade WebGL2** | `s10_webgl.png` idêntico ao WebGPU (`s1_clear.png`) — mesmos acertos, mesmos defeitos |
| Arquitetura de layers preservada, zero passes novos, build/check verdes | diff + selfchecks w1–w4 |

---

## A — Bloqueantes

### A1. O glare visível é SÓ o streak anamórfico azul-violeta — o sol lê como mancha roxa

**Evidência:** `s1_zoom_sun.png` — ponto branco de ~4 px dentro de um borrão horizontal
violeta. É a única assinatura visual do sol no quadro (post=full).

**Causa raiz (Engine.ts):** `solarBloom = solarBloomTight.add(solarBloomSoft)` é
calculado mas **nunca somado ao composite**. Ele só alimenta `anamorphic(solarBloom…)`
e `lensflare(solarBloom…)`. O anamorphic do three tem tint azul por padrão → o único
glow visível é o streak violeta. Na Onda 3 isso passava despercebido porque o halo
pintado no sprite fazia o papel do glow redondo; o F7 removeu o halo (corretamente)
sem rotear o bloom para o comp. O "glare que lê como estrela" do plano nunca chega
à tela.

**Fix:** adicionar o bloom solar diretamente ao composite, gated:
```ts
comp = comp.add(solarBloom.mul(sunVisibilityUniform));
```
(nos modos bloom/anamorphic/flare/full; recalibrar strengths por captura — o tight
0.85/0.22 é um bom começo). Avaliar também: reduzir o peso do anamorphic (0.16 → ~0.08)
ou dar-lhe tint quente, para o streak ser tempero e não prato principal.

### A2. No ocaso, o disco vira um BURACO PRETO na atmosfera — e o glare continua 100%

**Evidência:** `s7_zoom.png` (post=full): meia-lua azul-marinho onde deveria estar um
disco laranja, dentro de um burst violeta cheio. `s8_zoom.png` (post=raw): silhueta
preta do disco recortada no arco brilhante do limbo.

**Causa raiz (isolada por experimento no runtime):**
- disco oculto → pixel central fica brilhante (230);
- `disk.renderOrder = 1000` → disco renderiza branco perfeito;
- `renderOrder = -1` (código atual) → preto.

O disco (aditivo, renderOrder −1) desenha primeiro; a shell da atmosfera raymarched
(BackSide, blending normal) desenha por cima com α≈1 e inscatter≈0 na banda tangente
profunda — repinta o disco de preto. Enquanto isso o **seed** (passe solar, sem
atmosfera) mantém o glare cheio: vis=1 e tint só afeta o disco. Resultado incoerente:
disco extinto + glare branco-violeta intacto.

**Fix recomendado (coerente e barato, sem passes novos):**
1. Mover a extinção inteira para o CPU (uniform): `solarTintUniform` passa a incluir
   também a transmissão dos anéis ao longo da LOS câmera→sol
   (`1 − opacityAt(rKm)·0.92`, mesma conta que o gate já faz) — vira o
   "extinctionUniform" único do disco.
2. `disk.renderOrder` acima das shells transparentes (ex. `1`): o disco passa a
   desenhar depois da atmosfera. A dupla extinção morre (o raymarch deixa de
   apagá-lo; o CPU tint já modela a extinção) e os anéis continuam corretos porque
   o item 1 assumiu essa atenuação.
3. Coerência do glare: `sunVisibilityUniform *= luminância(tint)` (ou multiplicar a
   cadeia solar por `solarTintUniform`): ocaso → glare avermelha e morre junto com o
   disco.

### A3. Regressão de QA: `Engine.capture(width ≠ canvas atual)` devolve frame PRETO no WebGPU

**Evidência:** `capture(1100)` → PNG 100% preto (com e sem pós); `capture(1280)` com
canvas 1280 → perfeito. O branch de resize introduzido na reescrita do capture
(Onda 3) quebra o readback no WebGPU. Toda a validação F7.6 headless silenciosamente
"passa em preto" se a largura pedida difere do canvas — foi por sorte (canvas 1280)
que esta revisão conseguiu capturar.

**Fix:** após `setSize`, fazer um render de aquecimento antes do render medido, ou
capturar no tamanho corrente e reescalar no canvas 2D. Adicionar guarda no protocolo
de QA: rejeitar captura cujo buffer venha 100% zero.

---

## B — Menores (não bloqueiam, entram no fecho)

- **B1. Cap de 0.97 em `moonOccultsSun`** → vis nunca chega a 0 num eclipse total
  (fica 0.03 — um resto de streak visível em `s5`). No shader (transits em superfícies)
  o cap evita preto absoluto; no gate do glare não faz sentido físico. Sugestão: cap
  só no shader, 1.0 no CPU.
- **B2. Noite de Saturno no limite da legibilidade** (`s4_night.png`): ringshine 0.78
  ilumina só o hemisfério voltado aos anéis; o resto é breu. Aceito como física, mas
  se a direção de arte pedir mais leitura: lift sutil no grade (pós), nunca ambient.
- **B3. Penumbra F7.4 sem captura dedicada** — código correto; incluir um cenário
  de sombra dos anéis no protocolo do fecho.
- **B4. Cosmético:** import duplicado em `Sun.ts` (`import { uniform } from 'three/tsl'`
  em linha própria); `SUN_RADIANCE` deprecated foi removido ✓.

---

## Nota de processo

O relatório da implementação listou o smoke visual como "sugerido" e entregou sem
executá-lo. A1 e A2 apareceriam na primeira captura do cenário 1 do próprio plano.
O protocolo F7.6 é obrigatório antes de fechar a onda — com A3 corrigido, custa
minutos.

## Evidências

`output/onda4-review/`: s1_clear (WebGPU full), s1_zoom_sun (defeito A1),
s2_rings (modulação anéis), s3_limb + s7_zoom + s8_zoom (defeito A2),
s4_night (F7.3), s5_titan_eclipse (F7.2 ✓), s6_disk_zoom (F7.1 ✓),
s10_webgl (paridade).

Dev server da revisão: `http://localhost:53892` (`?post=`, `?webgl` funcionais).
