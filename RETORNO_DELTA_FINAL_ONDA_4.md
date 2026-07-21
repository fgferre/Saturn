# RETORNO — Delta final da Onda 4 / F7 (3ª rodada)

**Veredito: APROVAÇÃO CONDICIONADA a 2 retoques de ~1 linha cada. A essência da onda
está entregue e verificada — sol físico, glare redondo e quente, pôr-do-sol real,
eclipses, fonte única. O que resta é acabamento do streak anamórfico e da borda do
quad do seed.**

## Verificado nesta rodada (server limpo, WebGPU)

| Cenário | Resultado |
|---|---|
| Céu livre FOV 45° | Núcleo branco-quente + glow circular ✓ — sem quadrados de mip, sem violeta dominante (`r3b_wide.png`) |
| Céu livre FOV 12° | Glow redondo e quente em close ✓ (`r3b_closeup.png`) |
| **Ocaso no limbo** | **A curva completa existe**: branco → **sol laranja com saia de glare laranja** (b≈61, `r3_ocaso61.png`) → brasa vermelha tênue (b≈60.35, vis 0.145, `r3b_ocaso_deep.png`) → extinto. Sem buraco preto. Glare morre e avermelha em lockstep com o disco (gate único tint×vis funciona) |
| Eclipse por Titã | vis = 0 exato, glare extinto ✓ |
| Estático | build + w1–w4 verdes ✓ |

## Os 2 retoques que faltam (bloqueiam o fecho)

### 1. Streak anamórfico: contas vermelhas/azuis no wide, barra azul no close

Em FOV 45° o streak é uma linha de **pontos discretos** alternando vermelho/azul
(20 samples do node sobre fonte agora quase pontual + CA fringing em cada cópia);
em FOV 12° é uma **barra azul saturada** cortando o glow quente — o AnamorphicNode
tem cor azul interna por padrão; multiplicar o output por warm depois não a remove.

**Fix (escolher um):**
- **(a) Remover o anamórfico** — peso 0.07, é tempero que está brigando com o prato.
  O glow do seed + flare carregam o visual sozinhos. (Recomendado — YAGNI.)
- (b) Mantê-lo: setar a cor interna do node (`anamorphicNode.colorNode = vec3(1.0,
  0.92, 0.78)` — não `.mul()` no output) e alimentá-lo do `solarSoft` (fonte borrada
  esconde os beads), samples ≥ 32 ou spread menor.

### 2. Borda quadrada tênue do quad do seed em FOV estreito

A saia Lorentz vale ~1% em r=0.5 → o corte do quad aparece como moldura quadrada
escura no close. Janelar a saia para zero na borda:

```ts
const edge = 1 / (1 + (20 * 0.5) ** 2);           // valor da Lorentz na borda
const skirt = max(0, lorentz.sub(edge)).div(1 - edge); // zero exato em r=0.5
```
(ou multiplicar por `smoothstep(0.5, 0.42, r)` invertido — qualquer janela serve.)

## Fecho

Após os 2 retoques: re-capturar apenas céu-livre FOV 45° + FOV 12° e um frame do
ocaso (b≈61). Se o streak sumiu/ficou quente e a moldura quadrada desapareceu,
**a Onda 4 está aprovada** — pode commitar (sugestão de mensagem:
`F7: physical sun, single-source lighting, post glare, sunset extinction`).

## Notas de ambiente (para o processo, não para o código)

1. **Vite + Windows + edições externas**: o watcher perdeu a mudança do `eclipse.ts`
   — o moduleGraph serviu transform velho mesmo com reload completo (fetch bare
   devolvia o código novo, mentindo). A 1ª metade desta rodada validou uma mistura
   stale. **Reiniciar o dev server após rodadas de edição externa antes de julgar
   visuais.** (Registrado na memória de QA do projeto.)
2. Métrica de pixel no limbo é contaminada pelo arco branco da atmosfera ATRÁS do
   disco aditivo — julgar cor do ocaso pela imagem, não por médias de caixa central.
3. As duas "falhas" que persegui nesta rodada (tint ignorado, uniform (1,1,1)) eram
   ambas artefatos de ambiente — o código do Grok estava correto. Registrado para
   crédito devido.

Evidências: `output/onda4-review/r3b_wide.png`, `r3b_closeup.png`, `r3_ocaso61.png`,
`r3b_ocaso_deep.png`. Server de QA: `http://localhost:65007`.
