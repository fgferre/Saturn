# Retorno da re-revisão — fecho estreito da Onda 3

**Projeto:** Saturn WebGPU / Three.js  
**Commit-base:** `c190a8a55ee512e16978c0948c6ec06fbe1480ba`  
**Data:** 2026-07-20  
**Veredito:** **changes requested — dois bloqueadores estreitos**

## Decisão

O halo quadrado de B1 foi efetivamente corrigido em WebGPU e WebGL2. O `smoothstep` do starfield e o typecheck dos selfchecks também estão aprovados.

O fecho ainda não pode ser aprovado por dois problemas reproduzidos nos dois backends:

1. o novo `displayPass` não recebe profundidade dos corpos nem o gate de visibilidade; o disco do Sol aparece atravessando Saturno;
2. `Engine.capture(true)` continua devolvendo o frame anterior, embora resize, MIME e restauração nominal funcionem.

Não iniciar a Onda 4. Não fazer commit, push, merge ou publicação.

## Verificações estáticas

| Verificação | Resultado |
|---|---|
| `npm run build` | Passou |
| `npm run check` | Passou: typecheck dos selfchecks + Kepler + Waves 1–3 |
| `git diff --check` | Limpo; apenas avisos LF→CRLF |
| WebGPU | Carregou sem novo erro de runtime/shader |
| WebGL2 | Carregou sem novo erro de runtime/shader |
| Onda 2 direct-only | Permaneceu intacta |

Os warnings TSL já conhecidos e o favicon 404 permanecem fora do veredito.

## Itens aprovados

### B1 — halo quadrado: aprovado

Fixture: somente display Sun + seed visíveis, Sol centralizado, UI oculta, crop central de `100×100` e frame real do canvas.

| Backend | Modo | Threshold | BBox | Ocupação |
|---|---|---:|---:|---:|
| WebGPU | raw | 8/255 | `16×16` | `0.8125` |
| WebGPU | bloom | 8/255 | `16×16` | `0.8125` |
| WebGL2 | raw | 8/255 | `16×16` | `0.8125` |
| WebGL2 | bloom | 8/255 | `16×16` | `0.8125` |

Na reapresentação anterior, `?post=bloom` produzia `32×32` e ocupação `0.9453125`. O crop novo não mostra moldura retangular. O modo `full` preserva o streak/flare esperado, com ocupação `~0.6068` em 8/255 nos dois backends.

Artefatos:

- `output/playwright/wave3-r3-webgpu-bloom-crop.png`
- `output/playwright/wave3-r3-webgl2-bloom-crop.png`

### Starfield `smoothstep`: aprovado

`Starfield.ts` usa agora `oneMinus(smoothstep(0.1, 0.5, r))`. A guarda cobre `Sun.ts` e `Starfield.ts`, e ambos os backends compilaram/renderizaram.

### Typecheck dos selfchecks: aprovado

- `tsconfig.json` mantém selfchecks fora do build de produção;
- `tsconfig.selfcheck.json` os inclui com tipos Node;
- `@types/node` está em `devDependencies`;
- `npm run check` executa primeiro `tsc --noEmit -p tsconfig.selfcheck.json` e depois os testes em runtime.

## Bloqueador 1 — display Sun perdeu oclusão geométrica

### Evidência

Fixture em `?post=bloom`:

1. câmera em `-sunDir * 330`, olhando o centro de Saturno;
2. disco projetado em `NDC x/y ≈ 0`;
3. `sunVisibilityUniform=0` confirmado;
4. frame real do canvas medido.

| Backend | Pixel central | Pixel a 10 px | Resultado |
|---|---:|---:|---|
| WebGPU | `[246,246,245]` | `[18,15,11]` | Sol branco atravessa Saturno |
| WebGL2 | `[246,246,245]` | `[18,15,11]` | mesmo defeito |

O crop mostra um ponto solar branco no centro do hemisfério noturno:

- `output/playwright/wave3-r3-webgpu-occlusion-crop.png`
- `output/playwright/wave3-r3-webgl2-occlusion-crop.png`

### Causa

`displayCamera` enxerga somente `DISPLAY_SUN_LAYER`. Saturno, anéis e luas não escrevem profundidade no `displayPass`. Em seguida, `displayPass` é somado ao composto sem `sunVisibilityUniform`:

```ts
comp = beautyPass.add(beautyBloom).add(displayPass);
```

O gate zera anamórfico e flare, mas não o disco visível.

### Correção esperada

A solução mais robusta é manter o disco no pass base com os oclusores, mas excluí-lo apenas da fonte do bloom seletivo:

```text
base camera: layer 0 + DISPLAY_SUN_LAYER
  -> sistema + display Sun no mesmo depth buffer

bloom camera: layer 0 somente
  -> beautyBloom sem display Sun

solar camera: SOLAR_LAYER somente
  -> seed -> solarBloom -> anamorphic/flare × visibility

comp = basePass + beautyBloom + lens chain
```

Isso preserva o conserto do halo e recupera oclusão por Saturno, anéis e luas. Multiplicar `displayPass` por `sunVisibilityUniform` é um remendo mínimo aceitável para Saturno, mas continua sem oclusão geométrica por outros corpos e herda a aproximação pontual do gate.

### Critério de aceitação

Nos dois backends, em `?post=bloom`:

1. repetir a câmera em `-sunDir * 330`;
2. confirmar `sunVisibility=0` e disco em NDC central;
3. comparar disco visível versus `disk.visible=false`;
4. as imagens devem ser iguais, salvo no máximo ruído de 1 LSB;
5. o teste raw/bloom de B1 deve continuar em `16×16`, ocupação abaixo de `0.90`.

## Bloqueador 2 — `Engine.capture(true)` ainda captura conteúdo antigo

### Evidência

Fixture executado separadamente em WebGPU e WebGL2:

1. ocultar 28 geometrias, deixando apenas display Sun + seed;
2. câmera em `(0,0,0)`, Sol centralizado a 40.000 unidades;
3. chamar `capture(640, true)`;
4. chamar uma segunda vez sem liberar um frame normal entre as chamadas;
5. decodificar o retorno.

Resultados idênticos nas duas chamadas:

| Backend | Dimensão | Centro retornado | Pixels `>=50` | Esperado |
|---|---:|---:|---:|---|
| WebGPU | `640×360` | `[209,196,178]` | `30.779–30.780` | somente disco solar pequeno |
| WebGL2 | `640×360` | `[209,196,178]` | `30.773` | somente disco solar pequeno |

O conteúdo retornado ainda é Saturno/anéis/sky do frame anterior. Para comparação, o frame real isolado do canvas tem centro aproximadamente `[246,246,245]` e um componente solar de poucos pixels, não dezenas de milhares de pixels claros.

O que passou no helper:

- MIME `data:image/jpeg`;
- dimensão solicitada `640×360`;
- canvas restaurado de `1280×720` para `1280×720`;
- `capturing=false` ao terminar.

O problema central permanece: `post.renderAsync()` chamado desse modo não apresentou o estado atual no canvas antes de `toDataURL()`.

### Correção esperada

Há duas saídas aceitáveis para este fecho:

1. implementar uma captura que aguarde um frame de apresentação real do post graph nos dois backends e provar que o estado corrente foi renderizado; ou
2. reverter o delta de `capture(true)` desta reapresentação e devolver o helper ao backlog conhecido, sem afirmar que foi corrigido.

Se o helper continuar destinado a métricas de pixels, preferir `image/png`; JPEG 0.92 introduz ruído de compressão e enfraquece comparações MAE/threshold. A restauração de tamanho/aspect também deve ficar em `finally`, pois uma exceção após o resize hoje deixa o renderer alterado.

### Critério de aceitação

Nos dois backends:

1. isolar somente o Sol como acima;
2. `capture(640, true)` deve retornar o mesmo estado visual de um frame real do canvas na mesma resolução;
3. Saturno/anéis/sky não podem aparecer;
4. repetir duas vezes sem depender de um rAF normal entre chamadas;
5. tamanho, aspect e flag `capturing` devem ser restaurados inclusive em caminho de exceção.

## Loophole não bloqueante — ordem do DOF

O comentário diz que o display Sun permanece sharp, mas o código soma `displayPass` antes de:

```ts
comp = dof(comp, beautyPass.getViewZNode(), ...);
```

Portanto, no modo `full`, o display Sun também entra no DOF usando o depth do beauty pass. Se a intenção for realmente mantê-lo sharp, aplicar DOF somente ao ramo beauty e adicionar o display depois. Não bloqueou esta revisão porque B1 é medido em `raw/bloom` e não foi apresentado um sintoma adicional no uso normal.

## Pedido para a próxima reapresentação

Entregar somente o delta final:

1. recuperar a oclusão do display Sun sem reintroduzir beauty-bloom quadrado;
2. corrigir de verdade `capture(true)` ou reverter esse delta para o backlog;
3. manter starfield, typecheck, Onda 2, Onda 4, atmosfera, HG, penumbras e órbitas intocados;
4. reapresentar build/check e os dois fixtures acima em WebGPU e WebGL2;
5. continuar sem commit, push, merge ou publicação.

