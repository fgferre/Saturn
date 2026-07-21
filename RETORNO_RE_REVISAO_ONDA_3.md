# Retorno da re-revisão independente — Onda 3

**Projeto:** Saturn WebGPU / Three.js  
**Commit-base:** `c190a8a55ee512e16978c0948c6ec06fbe1480ba`  
**Data:** 2026-07-20  
**Escopo:** reapresentação B1–B4 da Onda 3  
**Veredito:** **changes requested (escopo agora estreito)**

## Decisão

B2, B3 no `Sun.ts` e B4 estão aprovados. A arquitetura beauty/solar por layers também foi validada nos dois backends.

B1 melhorou de forma material, mas ainda não pode ser encerrado: o disco raw é circular e a caixa forte anterior desapareceu, porém o estágio beauty-bloom ainda produz um halo quadrado fraco. O anamórfico do modo `full` mascara a métrica global, sem remover esse componente.

Além disso, há um segundo defeito do mesmo tipo de B3 em `Starfield.ts` e uma regressão de cobertura de tipos nos selfchecks. Corrigir esses itens pequenos na próxima reapresentação. Não iniciar a Onda 4 e não fazer commit/push.

## Validação executada

| Verificação | Resultado |
|---|---|
| `npm run build` | Passou |
| `npm run check` | Passou: Kepler + Waves 1, 2 e 3 |
| `git diff --check` | Limpo; apenas avisos LF→CRLF |
| WebGPU | Carregou; sem novo erro de runtime/shader |
| WebGL2 | Carregou; sem novo erro de runtime/shader |
| Direct-only da Onda 2 | Permaneceu intacto |

Os warnings TSL já conhecidos e o favicon 404 não entram neste veredito.

## B2 — atraso de um frame: aprovado

O teste dirigiu 120 frames de foco Saturno→Iapetus e comparou, em cada frame, a pose final da câmera com disco, seed, sky e `solarCamera`.

| Backend | Residual máx. disco/seed | Residual máx. sky | Residual máx. `solarCamera` |
|---|---:|---:|---:|
| WebGPU | `1.03e-11` | `0` | `4.44e-16` |
| WebGL2 | `7.50e-12` | `0` | `2.22e-16` |

A câmera percorreu mais de 3.400 unidades em cada backend; portanto não foi um teste estático. A ordem nova em `main.ts` e o `syncSolarCamera()` estão efetivos.

## B3 — `smoothstep` do Sol: aprovado, com loophole adjacente

O `Sun.ts` agora usa a forma definida:

```ts
oneMinus(smoothstep(edgeInner, edgeOuter, r))
```

com `edgeInner < edgeOuter`. Compilou e renderizou em WebGPU e WebGL2.

Entretanto, o mesmo padrão indefinido ainda existe em `src/scene/Starfield.ts`:

```ts
const disc = smoothstep(0.5, 0.1, uv().sub(0.5).length());
```

O selfcheck procura o problema somente em `Sun.ts`, por isso passa apesar dessa ocorrência. Corrigir para a forma equivalente definida, por exemplo:

```ts
const disc = oneMinus(smoothstep(0.1, 0.5, uv().sub(0.5).length()));
```

e ampliar a guarda para pelo menos `Sun.ts` e `Starfield.ts`.

## B4 — gate solar-only: aprovado

Fixture: modo `?post=flare`, disco e seed ocultos, cena não solar mantida, relógio congelado e comparação `sunVisibility=1` versus `0`.

| Backend | Repeat de controle | Gate 1→0 |
|---|---:|---:|
| WebGPU | MAE `0`, max `0` | MAE `0`, max `0` |
| WebGL2 | MAE `2.53e-6`, max `1` | MAE `1.37e-5`, max `1` |

No WebGL2 a diferença ficou limitada a 1 LSB em 38 canais entre aproximadamente 2,76 milhões de canais, na mesma ordem do ruído de apresentação do repeat. Não há mais evidência de highlights não solares sendo desligados pelo gate.

O teste geométrico adicional colocou a câmera a `-sunDir * 330`, olhando Saturno. Resultado: disco projetado no centro (`NDC x/y ≈ 0`) e `sunVisibility=0`.

## B1 — bloqueador residual: beauty-bloom ainda quadrado em baixa energia

### O que passou

- O raw é circular nos dois backends.
- Em `threshold=50`, o componente central do `full` caiu de aproximadamente `0.95` de ocupação na versão reprovada para aproximadamente `0.60`.
- A separação do seed HDR eliminou a caixa forte/saturada anterior.
- WebGPU e WebGL2 produziram resultados equivalentes.

### O que ainda falha

O modo A/B `?post=bloom` expõe o caminho beauty sem anamórfico nem ghosts. Com somente o Sol visível e centralizado, o componente conectado em torno do disco mede:

| Threshold (8-bit) | BBox | Pixels | Ocupação | Resultado |
|---:|---:|---:|---:|---|
| 8 | `32×32` | 968 | `0.9453125` | caixa fraca visível |
| 16 | `20×20` | 336 | `0.84` | ainda quadrangular |
| 32 | `16×16` | 208 | `0.8125` | aproximadamente circular |
| 50 | `16×16` | 184 | `0.71875` | circular |

Os valores foram idênticos em WebGPU e WebGL2. Um crop de `100×100` torna a moldura quadrada de baixa intensidade visível ao redor do disco. No `full`, o streak horizontal altera a bounding box e esconde esse diagnóstico; por isso o critério deve ser medido no estágio `bloom`, não no composto final.

Artefatos da revisão: `output/playwright/wave3-r2-webgpu-bloom-crop.png`, `output/playwright/wave3-r2-webgl2-bloom-crop.png` e `output/playwright/wave3-r2-webgpu-full-crop.png`.

### Correção esperada

Não basta cobrir a caixa com anamórfico/flare. O display Sun deve deixar de alimentar o beauty-bloom quadrado ou o caminho precisa gerar um halo circular também nos níveis baixos.

Soluções aceitáveis incluem selective bloom/layer adicional para compor o disco depois do beauty-bloom, ou outra separação que preserve:

```text
beauty scene sem Sol -> beautyBloom
display Sun circular -> composição visível sem beautyBloom quadrado
solar HDR seed -> solarBloom -> anamorphic/flare × visibility
```

Pode haver outra implementação, desde que o A/B prove o resultado.

### Critério de aceitação de B1

Repetir nos dois backends:

1. `?post=raw`: disco circular.
2. `?post=bloom`: somente o Sol visível e centralizado.
3. Medir o componente central num crop de `100×100`.
4. Em threshold 8/255, não aceitar uma bbox quase totalmente preenchida; como gate objetivo, ocupação deve ficar abaixo de `0.90` e o crop não pode revelar moldura retangular.
5. `?post=full`: manter o streak/flare desejado sem reintroduzir caixa.

O threshold baixo é deliberado: o defeito remanescente está no halo, não no núcleo branco.

## Cobertura de tipos dos selfchecks — corrigir no fechamento

`tsconfig.json` agora exclui `src/**/*.selfcheck.ts`. Isso resolveu os imports Node de `wave3.selfcheck.ts`, mas também retirou Wave 1, Wave 2 e Kepler do `tsc --noEmit`. `node --experimental-strip-types` executa os testes; ele não faz typecheck.

Preservar a separação entre produção e testes é aceitável, mas a pipeline deve recuperar o typecheck dos selfchecks. Sugestão:

- manter o `exclude` no tsconfig de produção;
- adicionar `@types/node` como dev dependency;
- criar um tsconfig de selfchecks que estenda o principal e inclua os testes;
- executar `tsc --noEmit -p <tsconfig-selfcheck>` dentro de `npm run check`.

Alternativa equivalente é aceita. Não deixar os selfchecks permanentemente sem checagem de tipos.

## Novo achado não bloqueante — `Engine.capture(true)` não captura o pós atual

O helper preexistente `Engine.capture(width, true)` não deve ser usado como prova de pixels nesta revisão. Reprodução:

1. ocultar 28 geometrias e deixar somente o Sol;
2. mudar a pose para centralizar o disco;
3. `capture(..., false)` retorna corretamente apenas o Sol;
4. `capture(..., true)` retorna conteúdo anterior de Saturno/sky.

Isso indica que `PostProcessing.renderAsync()` não está escrevendo no `RenderTarget` externo como o helper assume. O contrato documentado em `Engine.ts` é falso, embora o defeito já existisse antes desta Onda. A validação acima usou screenshots do canvas depois de frames reais.

Registrar para uma correção de QA separada ou corrigir agora se houver autorização; não é o motivo da reprovação funcional de B1.

## Pedido para a próxima reapresentação

Entregar somente o delta de fechamento da Onda 3:

1. remover o halo quadrado residual do `?post=bloom`;
2. corrigir o `smoothstep` invertido do starfield e ampliar a guarda;
3. restaurar typecheck dos selfchecks sem recolocá-los no bundle de produção;
4. reapresentar build/check e as métricas raw/bloom/full em WebGPU e WebGL2;
5. manter Onda 2, Onda 4, atmosfera, HG, penumbras e órbitas intocados;
6. continuar sem commit, push, merge ou publicação.
