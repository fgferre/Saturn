# Retorno da re-revisão — delta final da Onda 3

**Projeto:** Saturn WebGPU / Three.js  
**Commit-base:** `c190a8a55ee512e16978c0948c6ec06fbe1480ba`  
**Data:** 2026-07-20  
**Escopo:** dois bloqueadores do fecho da Onda 3  
**Veredito:** **changes requested — resta um bloqueador somente no `capture(true)` WebGL2**

## Decisão

O bloqueador de oclusão do display Sun foi corrigido e está aprovado nos dois backends. A arquitetura `base(0+display) + beautyBloom(0) + solarLens(1)` preservou também o conserto do halo quadrado.

O fecho ainda não pode ser aprovado porque `Engine.capture(width, true)` retorna um PNG totalmente preto no WebGL2. A falha ocorre tanto com resize para 640 px quanto na resolução atual de 1280 px, portanto não é apenas um erro de resize.

Não iniciar a Onda 4. Não fazer commit, push, merge ou publicação.

## Verificações gerais

| Verificação | Resultado |
|---|---|
| `npm run build` | Passou |
| `npm run check` | Passou: typecheck dos selfchecks + Kepler + Waves 1–3 |
| `git diff --check` | Limpo; apenas avisos LF→CRLF já conhecidos |
| `?post=full` WebGPU | Carregou e renderizou sem novo erro |
| `?webgl=1&post=full` WebGL2 | Carregou e renderizou sem novo erro |
| Onda 2 direct-only | Permaneceu intacta |

Os warnings TSL `atan2` já conhecidos continuam fora deste veredito.

## Bloqueador 1 anterior — oclusão do Sol: aprovado

### Fixture

1. abrir `?post=bloom`;
2. colocar a câmera em `-sunDir × 330`, olhando o centro de Saturno;
3. confirmar o disco em NDC central e `sunVisibility=0`;
4. congelar a cena;
5. comparar o frame com `disk.visible=true` e `disk.visible=false`.

### Resultado

| Backend | NDC do disco | Pixel central, disco visível | Pixel central, disco oculto | MAE A/B | Máximo |
|---|---:|---:|---:|---:|---:|
| WebGPU | `≈ (0,0)` | `[18,15,11]` | `[18,15,11]` | `0` | `0` |
| WebGL2 | `≈ (0,0)` | `[18,15,11]` | `[18,15,11]` | `7,23e-6` | `1 LSB` |

O centro branco antigo `[246,246,245]` desapareceu. `disk.material.depthTest=true` foi confirmado em runtime, e ocultar o disco não produz diferença material.

Artefatos:

- `output/playwright/wave3-r4-webgpu-occlusion.png`
- `output/playwright/wave3-r4-webgl2-occlusion.png`

### Arquitetura aprovada

```text
base camera  : layer 0 + DISPLAY_SUN_LAYER
               -> sistema e disco compartilham profundidade

bloom camera : layer 0 somente
               -> beautyBloom não amostra o display Sun

solar camera : SOLAR_LAYER somente
               -> seed -> lens chain × sunVisibility
```

As câmeras auxiliares copiam pose e projeção da câmera base antes do render.

## Regressão B1 — halo quadrado: continua aprovada

Fixture: somente display Sun + seed visíveis, Sol centralizado, canvas `1280×720`, crop central de `100×100`, threshold `8/255`.

| Backend | Modo | BBox | Pixels | Ocupação |
|---|---|---:|---:|---:|
| WebGPU | raw | `16×16` | `208` | `0,8125` |
| WebGPU | bloom | `16×16` | `208` | `0,8125` |
| WebGL2 | raw | `16×16` | `208` | `0,8125` |
| WebGL2 | bloom | `16×16` | `208` | `0,8125` |

O gate de aceitação era ocupação `< 0,90`; não houve retorno da moldura quadrada.

## Bloqueador restante — `capture(true)` fica preto no WebGL2

### Fixture principal

1. congelar o relógio e os controles;
2. ocultar todas as geometrias, exceto display Sun e seed — duas geometrias visíveis confirmadas;
3. centralizar o Sol;
4. chamar `capture(640, true)` duas vezes consecutivas, sem liberar um frame normal entre chamadas;
5. decodificar os PNGs e medir o conteúdo.

| Backend | Chamada | Dimensão | Centro | Pixels `>=50` | Resultado |
|---|---:|---:|---:|---:|---|
| WebGPU | 1 | `640×360` | `[240,239,238]` | `44` | estado atual correto |
| WebGPU | 2 | `640×360` | `[241,241,240]` | `44` | estado atual correto |
| WebGL2 | 1 | `640×360` | `[0,0,0]` | `0` | **PNG preto** |
| WebGL2 | 2 | `640×360` | `[0,0,0]` | `0` | **PNG preto** |

Ambos os retornos usam `data:image/png;base64` e têm as dimensões solicitadas.

### Controle que elimina a hipótese de resize

No WebGL2, antes da captura, o canvas real mostrava o Sol central com pixel `[246,246,245]`. No mesmo estado:

| Origem | Dimensão | Centro | Pixels `>=50` |
|---|---:|---:|---:|
| Canvas apresentado | `1280×720` | `[246,246,245]` | conteúdo visível |
| `capture(1280, true)` | `1280×720` | `[0,0,0]` | `0` |
| `capture(640, true)` | `640×360` | `[0,0,0]` | `0` |

Logo, o problema existe mesmo quando `capture()` não redimensiona o renderer.

### Causa provável, apoiada pelo código local

O novo caminho faz:

```ts
await this.post.renderAsync();
await waitForPresent(); // dois requestAnimationFrame
return this.renderer.domElement.toDataURL('image/png');
```

No Three.js r178, `WebGLBackend.init()` cria o contexto com `antialias`, `alpha`, `depth` e `stencil`, mas não solicita `preserveDrawingBuffer`. O padrão WebGL é não preservar o default framebuffer após a composição. Esperar dois rAF antes de `toDataURL()` permite que o navegador apresente e descarte esse buffer; o resultado observado é transparente/preto.

Referência local: `node_modules/three/src/renderers/webgl-fallback/WebGLBackend.js`, bloco de `contextAttributes` nas linhas aproximadas 224–231.

### Correção esperada

Escolher uma rota que seja realmente válida nos dois backends e comprová-la por pixels. Opções aceitáveis:

1. renderizar a saída final do post em um `RenderTarget` explícito e usar `readRenderTargetPixelsAsync`, preservando tone mapping e output color transform;
2. implementar uma leitura específica do framebuffer WebGL antes de ele ser descartado, com sincronização explícita de GPU, sem o double-rAF destrutivo;
3. criar/injetar um contexto WebGL2 com `preserveDrawingBuffer: true` se o custo e o alcance dessa opção forem deliberadamente aceitos. Apenas passar a opção ao `WebGPURenderer` não basta no r178: o `WebGLBackend` atual não a encaminha em `contextAttributes`.

Não prescrever uma dessas opções por conveniência: o critério é o fixture passar nos dois backends sem devolver frame antigo ou preto.

### Critério de aceitação

Nos dois backends:

1. somente display Sun + seed visíveis;
2. `capture(640, true)` retorna o Sol atual, não Saturno antigo e não preto;
3. repetir duas vezes consecutivas, sem depender de um frame normal;
4. executar também `capture(currentWidth, true)` para separar apresentação de resize;
5. MIME PNG e dimensões corretas;
6. tamanho, DPR, aspect e `capturing` restaurados;
7. repetir o caminho de exceção e confirmar a mesma restauração.

## O que já passou no caminho de exceção

Foi forçado um erro em `canvas.toDataURL()` durante `capture(640,true)` no WebGL2. Mesmo com a exceção:

- canvas voltou de `640×360` para `1280×720`;
- DPR permaneceu `1`;
- aspect voltou a `16:9`;
- `capturing` voltou a `false`.

Essa parte do `finally` está aprovada.

## Loopholes não bloqueantes encontrados

### 1. Captura avança computes

`capture(true)` executa todos os compute passes antes do post. Para um helper documentado como captura do “estado atual”, isso também muta partículas/plumas e torna capturas repetidas potencialmente não idempotentes. No fixture WebGPU isolado, os dois PNGs mantiveram o mesmo conteúdo, mas variaram em `MAE 7,23e-4`, máximo `9`, com `92` canais acima de 1 LSB.

Recomendação: não avançar computes numa captura de estado, ou tornar esse avanço uma opção explícita. Para QA de pixels, idealmente duas capturas sem mudança de estado devem ser determinísticas.

### 2. Render target no caminho de erro raw

No caminho `withPost=false`, o render target anterior só é restaurado e o RT temporário só é descartado depois que render e readback terminam. Se uma dessas operações lançar exceção, o target temporário pode permanecer ligado e o RT pode vazar. Colocar restauração e `dispose()` em um `finally` interno fecha o loophole.

No caminho `withPost=true`, `setRenderTarget(null)` também não preserva um target anterior não nulo. Hoje o uso normal parte de `null`, então isso não bloqueia a Onda 3, mas o helper não deve silenciosamente destruir estado externo.

## Pedido para a próxima reapresentação

Entregar somente o delta de `capture(true)`:

1. corrigir a captura WebGL2 preta;
2. manter a oclusão/base-bloom-solar agora aprovada sem alterações funcionais;
3. manter Onda 2, Onda 4, HG, atmosfera, penumbras e órbitas intocados;
4. reapresentar os fixtures de captura em WebGPU e WebGL2, incluindo resolução atual e 640 px;
5. continuar sem commit, push, merge ou publicação.

