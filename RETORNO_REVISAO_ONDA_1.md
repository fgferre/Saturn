# Retorno da revisão independente — Onda 1

**Projeto:** Saturn WebGPU / Three.js  
**Commit-base:** `c190a8a55ee512e16978c0948c6ec06fbe1480ba`  
**Data:** 2026-07-20  
**Escopo revisado:** Fix 1.1 (foco), Fix 1.2 (equinócio) e `src/wave1.selfcheck.ts`  
**Veredito:** **changes requested — Onda 1 ainda não aprovada**

## Instrução imediata

Não iniciar a Onda 2 ainda.

O Fix 1.2 está aceito. O Fix 1.1 removeu corretamente o snap radial causado pelo `minDistance`, mas introduziu/expôs dois problemas de estado confirmados no `OrbitControls` real:

1. momentum angular de damping fica congelado durante o voo e reaparece no final;
2. `autoRotate` pode ser perdido quando um novo foco começa durante uma transição.

Corrigir esses dois pontos, fortalecer o selfcheck e reenviar a Onda 1 para revisão.

## Validação repetida pelo revisor

| Verificação | Resultado |
|---|---|
| `npm run build` | Passou |
| `npm run check` | Passou; executa somente o selfcheck Kepler atual |
| `node --experimental-strip-types src/wave1.selfcheck.ts` | Passou |
| `git diff --check` | Sem erro; somente avisos de normalização LF→CRLF |
| Smoke WebGPU | Renderizou; sem erro funcional de renderer |
| Smoke WebGL2 (`?webgl`) | Renderizou; sem erro funcional de renderer |
| Sweep `S.y = -2e-5 ... +2e-5`, WebGPU | Todos os sete valores renderizaram |
| Mesmo sweep, WebGL2 | Todos os sete valores renderizaram |
| Foco Saturno→Mimas, WebGPU | Distância contínua; final `1.0901` |
| Foco Saturno→Mimas, WebGL2 | Distância contínua; final `1.0901` |

Os únicos avisos observados continuam sendo os já conhecidos de `atan2`, `transformedNormalView` e favicon ausente.

## Fix 1.2 — aceito

**Arquivo:** `src/materials/saturnMaterial.ts`

A combinação de denominador com piso sinalizado e máscara `valid` resolve o defeito que motivou a onda:

- `safeDenom` nunca zera;
- o sinal de `S.y` é preservado;
- `S.y = 0` usa o ramo positivo finito;
- a aproximação ponto-sol é desligada dentro da zona instável;
- o grafo compilou e renderizou nos dois backends em todos os valores do sweep.

O degrau em `abs(S.y) = epsilon` continua sendo uma aproximação deliberada. Não ampliar este fix com penumbra solar agora; isso permanece para a onda correspondente.

## Fix 1.1 — correção principal funciona, mas há bloqueadores

### Parte aceita: distância radial

Pular o `controls.update()` depois de escrever a pose interpolada remove o clamp antigo de Saturno. No navegador real:

```text
WebGPU: distância final = 1.0901; maior step observado ~= 5.93
WebGL2: distância final = 1.0901; maior step observado ~= 11.81
```

Não houve o salto final anterior de aproximadamente 80 unidades.

### Bloqueador 1 — damping angular é congelado e reaparece no final

**Causa:** durante a transição, `controls.update()` não é chamado. Isso impede o clamp radial, mas também impede que `_sphericalDelta` seja consumido ou amortecido. O delta permanece intacto por todo o voo. No término, o `controls.update()` de sincronização aplica esse momentum de uma vez e os frames seguintes continuam a drená-lo.

#### Reprodução real com arrasto curto

Procedimento:

1. focar Saturno e aguardar estabilização;
2. arrastar horizontalmente apenas 40 px;
3. iniciar imediatamente o foco em Mimas;
4. medir `_sphericalDelta` e a direção normalizada câmera→target.

Resultado:

```text
theta no início do voo  = -0.2727588
theta após 700 ms       = -0.2727588  <- completamente congelado
salto angular no final  = 7.39 graus
theta ainda residual    = -0.1399850
```

Com um arrasto de 260 px, o mesmo teste produziu salto angular de aproximadamente **43,58°**.

Isso não é apenas um micro-snap teórico; é uma regressão funcional reproduzida com eventos reais de mouse.

### Bloqueador 2 — foco reentrante perde `autoRotate`

**Causa:** a primeira transição salva o estado original e define `controls.autoRotate = false`. Se outro `focus()` for chamado antes do fim, a segunda transição salva o valor corrente `false`, e não a intenção original do usuário/cinema.

Reprodução:

```text
autoRotate antes                  = true
iniciar foco Mimas                -> autoRotate temporário false
após 300 ms, iniciar foco Titan
autoRotate após concluir Titan    = false  <- deveria voltar a true
```

O mesmo desenho pode sobrescrever uma mudança no checkbox Drift realizada durante o voo.

## Direção de correção recomendada

### 1. Não usar `autoRotate` como flag temporária de transição

Se `OrbitControls.update()` não for aplicado depois da pose autoritativa, auto-rotate não consegue alterar visualmente o voo. Portanto, prefira não modificar a propriedade pública `autoRotate` durante a transição.

Isso preserva automaticamente:

- estado do HUD;
- cinema mode;
- foco reentrante;
- mudança de Drift feita durante o voo.

Se for necessário chamar `update()` para limpar estado interno, desative auto-rotate somente dentro dessa operação síncrona e restaure imediatamente o valor corrente, sem armazená-lo como estado do voo.

### 2. Consumir ou limpar momentum antes de entregar a pose final

Não acessar `_sphericalDelta` diretamente: é API privada.

Uma direção compatível com a API pública é:

1. capturar target, posição/offset e flags atuais;
2. desabilitar temporariamente `enableDamping` e `autoRotate`;
3. chamar `controls.update()` para fazer o OrbitControls consumir/resetar seu estado pendente;
4. restaurar imediatamente a pose capturada e as flags públicas;
5. iniciar/aplicar o lerp autoritativo;
6. no fim, instalar o novo `minDistance` antes de devolver interação.

Outra solução aceitável é executar `controls.update()` antes de sobrescrever a pose a cada frame do voo, para que o estado interno seja amortecido e o clamp seja descartado pela pose autoritativa. Se escolher essa opção, prove que ela também funciona com baixa taxa de frames ou `dt` grande; a drenagem não pode depender de haver ~84 frames durante os 1,4 s.

Evite chamar `controls.update()` depois da pose final com auto-rotate ou damping residual ainda ativos. Caso seja necessário sincronizar, faça-o sob flags temporariamente neutras ou deixe o primeiro frame normal sincronizar sob o novo `minDistance`.

## Selfcheck — mudanças solicitadas

O selfcheck atual é útil para a fórmula do denominador, mas o teste de foco replica apenas uma interpolação escalar. Ele não exercita `FocusControls`, `OrbitControls`, damping, auto-rotate ou reentrância; por isso passou mesmo com o salto angular de 7,39°–43,58°.

Antes de aceitar a Onda 1:

1. integrar `src/wave1.selfcheck.ts` ao comando `npm run check`;
2. manter o teste numérico do equinócio;
3. não apresentar o modelo escalar como prova suficiente do comportamento do OrbitControls;
4. adicionar teste ou QA reproduzível para:
   - damping residual antes do foco;
   - foco chamado novamente no meio do voo;
   - auto-rotate ligado antes do foco;
   - mudança de Drift durante o voo.

Se automatizar OrbitControls em Node exigir mocks frágeis, é aceitável manter esses quatro casos como QA de navegador, desde que o roteiro e os valores medidos fiquem registrados.

## Critérios para aprovação da reapresentação

- [ ] Saturno→Mimas continua sem o clamp radial antigo.
- [ ] Distância final permanece aproximadamente `1.0901`.
- [ ] Arrasto horizontal de 40 px imediatamente antes do foco não produz salto angular perceptível no fim; alvo recomendado: `< 0,1°`.
- [ ] Momentum não permanece constante durante todo o voo.
- [ ] `autoRotate=true` sobrevive a foco normal e foco reentrante.
- [ ] Uma mudança do checkbox Drift durante o voo é respeitada no final.
- [ ] Cinema mode continua restaurando/comandando seu estado corretamente.
- [ ] `npm run check` executa também o selfcheck da Onda 1.
- [ ] Build e checks passam.
- [ ] Smoke passa em WebGPU e WebGL2.
- [ ] O Fix 1.2 permanece inalterado funcionalmente e o sweep continua sem erros.

## Escopo autorizado para a correção

Alterar somente o necessário em:

- `src/camera/FocusControls.ts`;
- `src/wave1.selfcheck.ts` ou QA equivalente;
- `package.json`, apenas para integrar o selfcheck ao comando `check`;
- documentação de retorno, se necessário.

Não iniciar `LightingModel`, mudança de albedo/sombra ou qualquer item da Onda 2 até esta revisão ser aprovada.

## Formato do próximo retorno

Entregar:

1. diff atualizado;
2. explicação de como o momentum foi neutralizado sem API privada;
3. resultados dos quatro testes de estado listados acima;
4. `npm run build`, `npm run check` e `git diff --check`;
5. smoke WebGPU/WebGL2;
6. confirmação explícita de que a Onda 2 continua intocada.

