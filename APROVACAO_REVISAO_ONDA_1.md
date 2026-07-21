# Aprovação da revisão independente — Onda 1

**Projeto:** Saturn WebGPU / Three.js  
**Commit-base:** `c190a8a55ee512e16978c0948c6ec06fbe1480ba`  
**Data:** 2026-07-20  
**Escopo revisado:** segunda apresentação da Onda 1  
**Veredito:** **aprovada**

## Decisão

A Onda 1 está aprovada.

Os dois bloqueadores da revisão anterior foram corrigidos e reproduzidos com sucesso no `OrbitControls` real:

1. momentum angular de damping é neutralizado antes do voo e não reaparece no pouso;
2. `autoRotate` permanece como estado público autoritativo em foco normal, foco reentrante, Drift e Cinema.

O Fix 1.2 do equinócio permaneceu funcionalmente inalterado e passou novamente nos dois backends.

A Onda 2 está liberada para implementação em diff separado, dentro do escopo definido ao final deste documento. Não fazer commit, push, merge ou publicação sem autorização explícita.

## Revisão do código

### `FocusControls`

A estratégia de flush foi considerada adequada para Three r178:

1. captura target, posição e flags públicas;
2. desativa temporariamente damping e auto-rotate;
3. chama `OrbitControls.update()` com damping desligado, consumindo o estado pendente;
4. restaura a pose capturada e as flags;
5. executa o voo sem `update()` depois da pose autoritativa;
6. sincroniza o estado esférico no pouso sob flags neutras e novo `minDistance`.

O código de produção não acessa `_sphericalDelta` nem outro campo privado. O campo privado é lido/injetado apenas pelo selfcheck para montar a condição de regressão.

Não alterar `autoRotate` durante todo o voo resolve corretamente:

- foco reentrante;
- checkbox Drift;
- Cinema mode;
- restauração da intenção corrente do usuário.

### Selfcheck

O selfcheck agora:

- está incluído em `npm run check`;
- mantém a prova numérica do equinócio;
- rotula corretamente o modelo radial como modelo, não prova de runtime;
- instancia `FocusControls` e o `OrbitControls` real com stub DOM;
- cobre momentum, foco reentrante, auto-rotate, Drift e kick no pouso.

Essa cobertura é suficiente para encerrar a Onda 1. Como o flush depende do comportamento de `OrbitControls.update()` com `enableDamping=false`, o teste deve permanecer ativo em qualquer upgrade futuro do Three.

## Validação executada pelo revisor

### Estática

| Verificação | Resultado |
|---|---|
| `npm run build` | Passou |
| `npm run check` | Passou: Kepler + Wave 1 |
| `git diff --check` | Sem erro; apenas aviso de normalização LF→CRLF |
| TypeScript | Passou via build |

O aviso de chunk acima de 500 kB permanece fora do escopo desta onda.

### WebGPU — foco com damping real

Procedimento:

1. estabilizar foco em Saturno;
2. arrastar horizontalmente 40 px;
3. iniciar imediatamente foco em Mimas;
4. medir residual, direção câmera→target e distância final.

Resultado:

```text
theta antes de focus()  = -0.2727588
theta após flush        = 0
theta no meio do voo    = 0
theta após pouso        = 0
kick angular medido     = 0°
distância final         = 1.0901
```

O clamp radial antigo e o kick angular da primeira apresentação não reapareceram.

### WebGL2 — foco com damping real

O mesmo roteiro com `?webgl` produziu:

```text
theta antes de focus()  = -0.2727588
theta após flush        = 0
theta após pouso        = 0
kick angular medido     = 0°
distância final         = 1.0901
```

### Foco reentrante e auto-rotate

```text
autoRotate antes                         = true
autoRotate durante foco Mimas             = true
novo foco Titan após 300 ms
autoRotate após concluir Titan            = true
focusId final                             = titan
distância final Titan                     = 14.16085
```

### Drift durante o voo

O teste usou o checkbox real do HUD:

| Caso | Checkbox final | `controls.autoRotate` final | Resultado |
|---|---:|---:|---|
| Drift ligado → desligado durante foco | `false` | `false` | Passou |
| Drift desligado → ligado durante foco | `true` | `true` | Passou |

### Cinema

Com Drift inicialmente desligado:

```text
entrar em Cinema  -> autoRotate=true, foco Saturno
concluir o foco   -> autoRotate continua true
pressionar Escape -> autoRotate volta a false
```

Passou.

### Sweep do equinócio

Valores renderizados:

```text
-2e-5, -1e-5, -5e-6, 0, +5e-6, +1e-5, +2e-5
```

| Backend | Resultado |
|---|---|
| WebGPU | Todos renderizaram sem erro de shader |
| WebGL2 | Todos renderizaram sem erro de shader |

Os únicos avisos de console foram os já conhecidos:

- `atan2` TSL sobrecarregado/depreciado;
- `transformedNormalView` depreciado;
- favicon ausente.

Nenhum deles foi introduzido pela Onda 1.

## Critérios da revisão anterior

- [x] Saturno→Mimas sem clamp radial antigo.
- [x] Distância final aproximadamente `1.0901`.
- [x] Arrasto de 40 px sem kick angular no pouso.
- [x] Momentum zerado e não congelado durante o voo.
- [x] `autoRotate=true` preservado em foco normal.
- [x] `autoRotate=true` preservado em foco reentrante.
- [x] Drift alterado durante o voo respeitado no final.
- [x] Cinema preserva e restaura o estado anterior.
- [x] `npm run check` executa o selfcheck da Onda 1.
- [x] Build e checks passam.
- [x] Smoke WebGPU passa.
- [x] Smoke WebGL2 passa.
- [x] Fix 1.2 permanece funcional e passa no sweep.

## Notas não bloqueantes

1. O flush depende do contrato atual de `OrbitControls.update()` com damping desligado. O selfcheck adicionado é a proteção contra regressão em upgrade do Three.
2. O `update()` de flush pode emitir um evento de change para uma pose temporária antes da restauração síncrona. Não há consumidor problemático atualmente e nenhum frame é renderizado no meio da operação; manter como observação, não como bug atual.
3. O hard step de validade no epsilon equinocial continua deliberado até a futura onda de disco solar finito/penumbra.
4. Não misturar limpeza de warnings TSL ou chunk splitting com a Onda 2.

---

# Autorização operacional — Onda 2

## Objetivo único

Mover ring shadow, moon transits e eclipses do albedo para a contribuição de iluminação direta, preservando ambient, ringshine, Saturnshine e emissive.

## Escopo da primeira entrega da Onda 2

### Saturno

- Criar material/modelo de iluminação especializado baseado no `PhysicalLightingModel` de Three r178.
- Aplicar `ringShadow * moonTransits` somente ao `lightColor` ou à irradiância dentro de `direct()`.
- Remover as máscaras de `material.colorNode`.
- Preservar o albedo base sem sombra.
- Preservar ringshine emissive.

Contrato esperado:

```text
Lfinal = Ldirect * ringShadow * moonTransits
       + Lindirect
       + Lemissive
```

### Luas

- Na rota Hapke, aplicar `eclipseLight` dentro de `direct()`.
- Na rota Standard/Titan/fallback, aplicar a mesma política direct-only.
- Preservar Saturnshine/emissive sem eclipse solar.
- Não incluir Titan haze nem plumas nesta entrega; pertencem à onda de atmosfera.

## Restrições

- Não adicionar `N·L` à máscara do albedo.
- Não corrigir HG/Hapke nesta mesma mudança.
- Não retunar cores, ambient, exposure, bloom ou ringshine antes dos testes funcionais.
- Não alterar Sol, flare, céu, penumbras ou órbitas.
- Não modificar os fixes aprovados da Onda 1 salvo regressão demonstrada.

## Testes obrigatórios da Onda 2

1. Fixture/cenário ambient-only: variar sombra não pode alterar a contribuição ambient.
2. Fixture/cenário direct-only: sombra e transits devem atenuar completamente a contribuição solar correspondente.
3. Ringshine de Saturno permanece visível e sem faixa de ring shadow.
4. Saturnshine das luas permanece visível em eclipse.
5. Comparar luas Hapke, Titan e fallback procedural sob o mesmo eclipse.
6. Terminador não recebe uma segunda multiplicação contínua por `N·L`.
7. `npm run build`, `npm run check` e `git diff --check` passam.
8. Smoke e capturas controladas em WebGPU e WebGL2.

## Entrega esperada

Apresentar a Onda 2 em patch separado, com:

1. diff dos arquivos alterados;
2. explicação do `LightingModel` e de onde a máscara entra no direct;
3. prova de que ambient/emissive não são atenuados;
4. matriz de rotas Saturno/Hapke/Standard/Titan/fallback;
5. resultados estáticos e runtime nos dois backends;
6. riscos e limitações restantes;
7. confirmação de que HG, atmosfera e pós-processamento não foram tocados.

