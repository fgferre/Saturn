# Aprovação final — Onda 3

**Projeto:** Saturn WebGPU / Three.js  
**Commit-base:** `c190a8a55ee512e16978c0948c6ec06fbe1480ba`  
**Data:** 2026-07-20  
**Escopo:** fecho do último bloqueador de `capture(true)`  
**Veredito:** **aprovado**

## Decisão

O último bloqueador da Onda 3 foi corrigido. `Engine.capture(width, true)` captura o estado atual em WebGPU e WebGL2, tanto com resize quanto na resolução corrente, sem depender do default framebuffer ou de `preserveDrawingBuffer`.

A Onda 3 está encerrada. A próxima onda pode começar conforme o plano, mantendo a decisão de não fazer commit, push, merge ou publicação sem autorização separada.

## Validação estática

| Verificação | Resultado |
|---|---|
| `npm run build` | Passou |
| `npm run check` | Passou: typecheck dos selfchecks + Kepler + Waves 1–3 |
| `git diff --check` | Limpo; apenas avisos LF→CRLF já conhecidos |
| Console WebGPU | Sem novo erro |
| Console WebGL2 | Sem novo erro |

Os warnings TSL `atan2` já conhecidos permanecem fora deste veredito.

## Último bloqueador — `capture(true)` WebGL2: aprovado

### Fixture isolado

1. relógio e controles congelados;
2. todas as geometrias ocultas, exceto display Sun e seed — duas geometrias confirmadas;
3. Sol centralizado;
4. `capture(640, true)` duas vezes consecutivas, sem frame normal entre chamadas;
5. `capture(1280, true)` na resolução corrente;
6. PNG decodificado e medido.

| Backend | Captura | Dimensão | Centro | Pixels `>=50` | Resultado |
|---|---:|---:|---:|---:|---|
| WebGPU | 640 #1 | `640×360` | `[240,239,238]` | `44` | Sol atual |
| WebGPU | 640 #2 | `640×360` | `[240,239,238]` | `44` | Sol atual |
| WebGPU | 1280 | `1280×720` | `[246,246,245]` | `164` | Sol atual |
| WebGL2 | 640 #1 | `640×360` | `[240,239,238]` | `44` | Sol atual |
| WebGL2 | 640 #2 | `640×360` | `[241,241,240]` | `44` | Sol atual |
| WebGL2 | 1280 | `1280×720` | `[246,246,245]` | `164` | Sol atual |

Todos os retornos usam `data:image/png;base64`. Não houve frame antigo nem PNG preto.

### Repetibilidade

| Backend | MAE entre as duas capturas 640 | Máximo | Canais acima de 1 LSB |
|---|---:|---:|---:|
| WebGPU | `0` | `0` | `0` |
| WebGL2 | `7,23e-4` | `9` | `92` |

A pequena variação WebGL2 é não bloqueante: as duas imagens têm o mesmo componente solar, a mesma contagem de pixels claros e nenhuma mudança de estado da simulação. Para fixtures que exijam igualdade bit a bit, usar tolerância explícita no WebGL2.

## Render target, orientação e cor

O caminho aprovado é:

```text
sync cameras
-> bind RenderTarget explícito
-> post.renderAsync()
-> readRenderTargetPixelsAsync()
-> orientação por backend
-> PNG
-> restauração no finally
```

A captura natural `1280×720` foi comparada ao canvas congelado.

| Backend | MAE captura direta | MAE se invertida em Y | Veredito |
|---|---:|---:|---|
| WebGPU | `2,711` | `14,852` | orientação direta correta |
| WebGL2 | `2,705` | `14,848` | flip WebGL aplicado corretamente |

Amostras em quatro posições coincidiram exatamente entre canvas e PNG nos dois backends. O MAE direto residual concentra-se em bordas/fragmentos e é muito inferior à hipótese invertida.

## Estado e caminho de exceção: aprovados

Foi ligado um `RenderTarget(8,8)` sentinela antes da captura e forçada uma exceção em `readRenderTargetPixelsAsync()`.

Nos dois backends:

- a exceção foi propagada;
- o render target sentinela foi restaurado por identidade;
- canvas voltou a `1280×720`;
- DPR permaneceu `1`;
- aspect voltou a `16:9`;
- `capturing` voltou a `false`;
- o RT temporário é descartado no `finally`.

O loophole anterior de restauração/leak foi fechado.

## Snapshot sem avanço de compute: aprovado

Um objeto sentinela inválido foi inserido na lista de computes antes de três capturas. Todas passaram; portanto `capture()` não executou o sentinela nem avançou os compute passes.

Isso também eliminou a mutação implícita de plumas/partículas durante uma captura de QA.

## Caminho raw: aprovado

`capture(640, false)` foi exercitado nos dois backends:

| Backend | Dimensão | Centro | Pixels `>=50` | MIME |
|---|---:|---:|---:|---|
| WebGPU | `640×360` | `[238,235,230]` | `41` | PNG |
| WebGL2 | `640×360` | `[238,235,230]` | `41` | PNG |

O caminho raw também usa RT explícito, restauração comum e orientação correta.

## Regressões da Onda 3

### Halo quadrado B1

Somente Sol, crop central `100×100`, threshold `8/255`:

| Backend | Modo | BBox | Pixels | Ocupação |
|---|---|---:|---:|---:|
| WebGPU | raw | `16×16` | `208` | `0,8125` |
| WebGPU | bloom | `16×16` | `208` | `0,8125` |
| WebGL2 | raw | `16×16` | `208` | `0,8125` |
| WebGL2 | bloom | `16×16` | `208` | `0,8125` |

O gate era ocupação `<0,90`. A moldura quadrada não retornou.

### Oclusão do display Sun

Câmera em `-sunDir × 330`, disco em NDC central e `sunVisibility=0`; comparação `disk.visible=true/false`:

| Backend | Centro | MAE | Máximo |
|---|---:|---:|---:|
| WebGPU | `[18,15,11]` | `0` | `0` |
| WebGL2 | `[18,15,10]` | `5,06e-6` | `1 LSB` |

A oclusão compartilhada e a separação das layers continuam aprovadas.

## Decisão arquitetural do owner — Sol visual

Esta decisão não reabre a Onda 3, mas deve orientar a próxima alteração solar.

### O que existe hoje

- `DirectionalLight`: única fonte de iluminação direta do sistema;
- display sprite: representação visível do Sol na câmera;
- seed HDR: entrada exclusiva do bloom/anamórfico/flare solar;
- ringshine, saturnshine e scattering: termos indiretos derivados da mesma luz solar;
- `AmbientLight(0.035)`: preenchimento global artístico, não uma fonte física equivalente.

Portanto, o sprite borrado não é a fonte de luz. Ele é um artifício visual. O problema é que sua aparência mistura disco astronômico com halo de lente.

### Direção recomendada

1. manter uma única luz solar direcional para toda iluminação direta;
2. trocar o display por um disco procedural pequeno e nítido, sem halo embutido;
3. aproximar o tamanho angular do Sol visto de Saturno, cerca de `0,056°` de diâmetro, com um mínimo de pixels apenas se necessário para estabilidade;
4. gerar bloom, anamórfico e flare somente no ramo solar do post, a partir de uma máscara/seed não visível;
5. manter ringshine, saturnshine e atmosfera como iluminação indireta explícita;
6. remover ou reduzir fortemente o `AmbientLight` global depois de validar que os termos indiretos cobrem as regiões necessárias.

No fixture atual, o componente visível a threshold `8/255` ocupa 16 px em 720 px verticais; com FOV de 45°, isso representa aproximadamente `1°`. É um halo de apresentação, não o disco físico do Sol em Saturno.

### Escopo sugerido

Fazer essa simplificação como delta isolado após o fecho da Onda 3. Não misturar a mudança física/visual com o helper de captura agora aprovado. Exigir A/B raw, bloom e full nos dois backends, além de oclusão por Saturno.

