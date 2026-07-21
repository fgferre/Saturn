# Retorno da revisão independente — Onda 3

**Projeto:** Saturn WebGPU / Three.js  
**Commit-base:** `c190a8a55ee512e16978c0948c6ec06fbe1480ba`  
**Data:** 2026-07-20  
**Escopo revisado:** Sol, sky, pós-processamento e alcance da câmera  
**Veredito:** **changes requested**

## Decisão

A Onda 3 ainda não está aprovada.

A direção geral é boa e parte do objetivo foi alcançada:

- o disco raw agora é procedural e circular;
- Sol e sky usam posições camera-centered;
- a direção do `DirectionalLight`, do billboard e do teste analítico é a mesma em estado estável;
- a oclusão central atrás de Saturno zera o gate;
- WebGPU e WebGL2 compilam sem novo erro de shader;
- a arquitetura direct-only aprovada na Onda 2 permaneceu intocada.

Entretanto, quatro bloqueadores permanecem. O principal sintoma da investigação — halo quadrado no resultado final — ainda é reproduzível nos dois backends.

Não iniciar a Onda 4. Não fazer commit, push, merge ou publicação.

## Baseline e verificações

| Verificação | Resultado |
|---|---|
| `HEAD` | `c190a8a55ee512e16978c0948c6ec06fbe1480ba` |
| Branch | `main...origin/main` |
| `npm run build` | Passou |
| `npm run check` | Passou: Kepler + Waves 1, 2 e 3 |
| `git diff --check` | Sem erro; apenas avisos LF→CRLF |
| WebGPU | Carregou; somente warnings conhecidos + favicon 404 |
| WebGL2 | Carregou; zero erros de console, warnings conhecidos |

O selfcheck da Onda 3 prova a fórmula ideal de posicionamento, mas não prova que o frame real executa essa fórmula depois da atualização da câmera, nem exercita o pós-processamento.

---

# Bloqueadores

## B1 — o full post continua quadrado

**Arquivos:** `src/scene/Sun.ts`, `src/core/Engine.ts`

O A/B isolou apenas o mesh do Sol, com câmera alinhada, mesmo estado e mesma resolução.

Resultado visual nos dois backends:

```text
raw       -> disco circular
full post -> núcleo/halo quadrado claramente visível
```

A métrica de ocupação confirma o formato. Para o recorte central e luminância maior que 50:

| Backend | Caminho | Bounding box | Ocupação da caixa |
|---|---|---:|---:|
| WebGPU | raw | `16 x 16` | `0.750` |
| WebGPU | full post | `42 x 42` | `0.947` |
| WebGL2 | raw | `16 x 16` | `0.750` |
| WebGL2 | full post | `42 x 42` | `0.947` |

Uma forma circular rasterizada tende a ocupar aproximadamente `pi/4 = 0.785` da bounding box. `0.947` mostra que o bloom saturado está preenchendo quase toda uma caixa.

### Causa restante

O UV procedural removeu a caixa da textura raw, mas disco visível, halo artístico e fonte HDR continuam no mesmo material:

```ts
core * 42 + halo * 1.8
```

O núcleo é minúsculo e muito acima de 1. O `bloomPass` ainda recebe esse pico, é somado diretamente à cena e depois também alimenta anamórfico e lens flare. Trocar `scenePass` por `bloomPass` no anamórfico não corrige a caixa já criada pelo próprio bloom.

### Correção exigida

Separar efetivamente:

1. disco raw circular;
2. halo artístico circular de radiância moderada;
3. seed HDR do bloom/lens system com tamanho e energia que não colapsem em um texel/bloco quadrado.

Antes de retunar, disponibilizar A/B controlado de:

```text
raw
raw + bloom
raw + bloom + anamorphic
raw + bloom + anamorphic + lensflare
```

O full post final deve deixar de apresentar a caixa. Não basta declarar que a causa está no post.

## B2 — Sol e sky seguem a câmera com um frame de atraso

**Arquivo:** `src/main.ts`, ordem atual em torno das linhas 146–150

Hoje o frame executa:

```text
sun.update(camera.position)
followCamera(sky, camera.position)
system.update(...)
controls.update(dt)          <- câmera muda depois
render
```

Durante foco/orbit, o frame é renderizado com Sol e sky centrados na posição anterior da câmera.

### Evidência no voo Saturno → Iapetus

Com `dt = 1/60`, no pico do voo:

```text
deslocamento da câmera no frame = 64.777959 unidades
erro da posição do Sol          = 64.777959 unidades
erro do centro do sky           = 64.777959 unidades
erro angular aparente do Sol    = 0.059828 graus
```

Em 720 px e FOV vertical de 45 graus, isso corresponde a aproximadamente 1 px. O raio angular do core é cerca de `0.129 graus`; portanto o erro chega a quase metade do raio do núcleo durante o voo.

Com steps maiores, usados para QA/headless, o erro chegou a `0.704 graus`, deslocando inclusive o halo completo.

### Correção exigida

A ordem deve garantir:

1. `system.update()` atualiza os corpos;
2. `controls.update()` instala a pose final da câmera do frame;
3. `sun.update()` e `followCamera()` usam essa pose final;
4. o gate de oclusão usa a mesma pose/direção;
5. só então ocorre o render.

Critério por frame:

```text
length(diskPosition - cameraPosition - sunDir * SUN_FOLLOW_DISTANCE) < 1e-6
length(skyPosition - cameraPosition) < 1e-6
```

O selfcheck deve cobrir a ordem real, não apenas repetir a fórmula ideal em uma função separada.

## B3 — novos `smoothstep` com bordas invertidas

**Arquivo:** `src/scene/Sun.ts`, linhas aproximadas 58 e 60

Foram adicionados:

```ts
smoothstep(0.48, 0.10, r)
smoothstep(0.10, 0.02, r)
```

Isso usa `edge0 > edge1`. No GLSL, o resultado de `smoothstep` é indefinido quando `edge0 >= edge1`. O Chrome/ANGLE desta revisão produziu paridade entre WebGPU e WebGL2, mas isso não torna o shader portável.

Use a forma definida:

```ts
oneMinus(smoothstep(0.10, 0.48, r))
oneMinus(smoothstep(0.02, 0.10, r))
```

Não introduzir um caso novo do problema que a própria auditoria reservou para a onda mecânica de portabilidade.

## B4 — o gate do Sol ainda controla highlights não solares

**Arquivo:** `src/core/Engine.ts`

Anamórfico e lens flare continuam recebendo `bloomPass` da cena inteira e depois são multiplicados globalmente por `sunVisibilityUniform`:

```text
effect(full-scene bloom) * sunVisibility
```

O aumento dos thresholds reduziu a contaminação, mas não a eliminou.

### Fixture WebGPU

O mesh do Sol foi ocultado, mantendo planeta, anéis e demais highlights. Duas capturas idênticas com gate 1 foram bit a bit iguais. Em seguida, alterar somente o gate de 1 para 0 produziu:

```text
controle repeat 1 vs 1: MAE = 0, max = 0
gate 1 vs 0:            MAE = 0.370239, max = 12
canais com delta > 4:   0.3899%
```

Logo, ainda existem contribuições não solares que desaparecem quando Saturno oculta o Sol. Isso viola o critério aprovado para a Onda 3.

### Correção exigida

Preferência: fonte/máscara solar dedicada para os efeitos de lente, de modo que o gate multiplique somente energia do Sol.

Se for proposta uma solução sem buffer dedicado, ela deve provar com a mesma fixture que, com o Sol oculto do source, alternar `sunVisibility` não altera pixel algum. Apenas elevar thresholds sem fixture de regressão é frágil.

---

# Itens que passaram

## Disco raw e paridade atual

- Raw circular em WebGPU.
- Raw circular em WebGL2.
- Recorte raw central WebGPU versus WebGL2: `MAE = 0`, `max = 0` nesta máquina.
- Remoção da `CanvasTexture` elimina mipmaps/cantos da textura antiga.

Essa aprovação é somente para o caminho raw; não encerra B1.

## Direção estável

Quando a câmera não muda entre `sun.update()` e render:

- billboard fica a 40.000 unidades da câmera;
- sky fica centrado na câmera;
- `DirectionalLight` e billboard usam a mesma direção;
- oclusão usa a mesma direção central.

## Oclusão central

Com a câmera colocada no eixo oposto ao Sol, olhando para Saturno:

```text
backend              = WebGL2
sunVisibilityUniform = 0
```

O full post não mostrou flare/anamórfico solar residual. A aproximação continua sendo ponto central + elipsoide/anéis, como declarado, e a penumbra parcial permanece para a Onda 4.

## Escopo preservado

- direct-only da Onda 2 não foi modificado;
- HG/Hapke não foi retunado;
- atmosfera, penumbras e órbitas não foram alteradas;
- não houve commit/push.

---

# Notas não bloqueantes

1. `FocusControls.maxDistance` foi reduzido de 25.000 para 20.000, embora objetos camera-centered não possam ser alcançados independentemente desse limite. Restaurar 25.000 evita uma mudança de navegação sem benefício demonstrado, ou então documentar um motivo funcional diferente.
2. `wave3.selfcheck.ts` hardcodeia `orbitMax = 20000` em vez de ler uma constante compartilhada. O teste pode continuar passando se a implementação real mudar.
3. O selfcheck mede o meio-ângulo do quad, não o tamanho angular do core visível nem do halo. Registrar separadamente core, halo e quad evitará que uma futura alteração passe pelo intervalo excessivamente amplo de `0.05–2 graus`.
4. `SUN_FOLLOW_DISTANCE < SKY_RADIUS` é útil para ordenação espacial, mas não prova que a câmera não alcança os objetos; essa garantia vem do recentramento depois da pose final da câmera.

---

# Reapresentação exigida da Onda 3

## Mudanças mínimas

1. Corrigir a ordem do frame para eliminar o atraso de camera-follow.
2. Substituir os dois `smoothstep` invertidos.
3. Separar/tunar a fonte HDR até o full post deixar de formar um quadrado.
4. Impedir que o gate solar desligue contribuições não solares.
5. Fortalecer `wave3.selfcheck.ts` para cobrir a implementação e não somente a política.

## Testes obrigatórios

- [ ] Residual do Sol e sky menor que `1e-6` em todos os frames Saturno→Iapetus.
- [ ] Raw circular em WebGPU e WebGL2.
- [ ] Full post sem caixa quadrada nos dois backends.
- [ ] A/B isolado de bloom, anamórfico e lens flare.
- [ ] Com mesh solar oculto, gate 1 versus 0 não altera pixels não solares.
- [ ] Sol atrás de Saturno mantém `sunVisibility = 0` e sem flare solar residual.
- [ ] Nenhum `smoothstep(edgeHigh, edgeLow, x)` novo.
- [ ] `npm run build`, `npm run check` e `git diff --check` passam.
- [ ] Onda 1 e direct-only da Onda 2 permanecem intactas.

## Entrega

Reapresentar somente a Onda 3, com causa e correção de B1–B4, métricas antes/depois, matriz WebGPU/WebGL2 e confirmação explícita de que a Onda 4 continua intocada.
