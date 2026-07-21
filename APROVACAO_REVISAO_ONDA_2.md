# Aprovação da revisão independente — Onda 2

**Projeto:** Saturn WebGPU / Three.js  
**Commit-base:** `c190a8a55ee512e16978c0948c6ec06fbe1480ba`  
**Data:** 2026-07-20  
**Escopo revisado:** iluminação `direct-only` de Saturno e das luas  
**Veredito:** **aprovada**

## Decisão

A Onda 2 está aprovada sem bloqueadores.

O contrato implementado corresponde ao contrato solicitado:

```text
Lfinal = Ldirect * mask + Lindirect + Lemissive
```

A máscara não está mais no albedo. Em Saturno e nas luas Standard ela multiplica `lightColor` antes de `PhysicalLightingModel.direct()`. Nas luas Hapke ela multiplica `lightColor` dentro de `HapkeLightingModel.direct()`. O modelo base continua aplicando `N·L` uma única vez.

Além da leitura do diff e dos selfchecks, a revisão compilou os grafos reais e executou fixtures de pixels isoladas em WebGPU e WebGL2. Ambient e emissive permaneceram invariantes quando a máscara variou; a iluminação solar direta respondeu à máscara nos dois backends.

A Onda 3 fica liberada nos limites definidos ao final deste documento. Não fazer commit, push, merge ou publicação sem autorização explícita.

## Revisão do código

### `directMaskedLighting.ts`

`DirectMaskedPhysicalLightingModel.direct()` faz:

```text
maskedLightColor = input.lightColor * directLightMask
super.direct({ ...input, lightColor: maskedLightColor })
```

No Three r178 instalado, `PhysicalLightingModel.direct()` calcula internamente:

```text
irradiance = clamp(N dot L) * lightColor
```

e usa essa irradiância tanto no difuso quanto no especular diretos. `indirect()` é um caminho separado, e `NodeMaterial.setupLighting()` soma `emissive` depois do contexto de iluminação. Portanto:

- não existe segundo `N·L`;
- difuso e especular solares são mascarados;
- `AmbientLight` não recebe a máscara;
- `emissiveNode` não recebe a máscara.

O cast `Node -> ShaderNodeObject<Node>` é coerente com a API TSL de r178: o tipo exportado é conservador, enquanto os operadores como `.mul()` vivem no proxy de shader. O build e os dois compiladores de shader confirmaram o uso.

### Saturno

`createSaturnMaterial()` agora usa `DirectMaskedStandardMaterial`.

- `colorNode` contém apenas mapa/procedural + hexágono polar;
- `directLightMask` recebe `ringShadow * moonTransits`;
- ringshine continua em `emissiveNode`;
- o `safeDenom` e a máscara `valid` da Onda 1 permanecem intactos;
- o terminador é responsabilidade do `PhysicalLightingModel`, não da máscara de sombra.

### Luas

As rotas carregadas no runtime foram inspecionadas, não apenas as classes criadas no selfcheck:

| Corpo/rota real | Material | Modelo | Máscara ligada ao `eclipseLight` |
|---|---|---|---|
| Mimas, Enceladus, Tethys, Dione, Rhea e Iapetus com mapas | `MoonNodeMaterial` | `HapkeLightingModel` | Sim |
| Titan | `DirectMaskedStandardMaterial` | `DirectMaskedPhysicalLightingModel` | Sim |
| Hyperion | `DirectMaskedStandardMaterial` | `DirectMaskedPhysicalLightingModel` | Sim |
| Saturno | `DirectMaskedStandardMaterial` | `DirectMaskedPhysicalLightingModel` | Máscara própria de anéis + trânsitos |

Em todas as luas, o `directLightMask` do material é o mesmo `UniformNode` atualizado por `SaturnSystem`. `colorNode` permaneceu como albedo, e Saturnshine permaneceu em `emissiveNode`.

## Validação executada pelo revisor

### Estática

| Verificação | Resultado |
|---|---|
| `npm run build` | Passou |
| `npm run check` | Passou: Kepler + Wave 1 + Wave 2 |
| `git diff --check` | Sem erro; apenas avisos LF→CRLF |
| TypeScript | Passou via build |

Os avisos conhecidos de `atan2`, `transformedNormalView` e chunk acima de 500 kB permanecem fora do escopo e não foram introduzidos pela Onda 2.

### Método das fixtures de pixels

Para não confundir a mudança com atmosfera, anéis, labels, bloom ou film grain, o revisor usou o caminho de captura raw já existente:

1. resolução de 512 px, sem pós-processamento;
2. somente o mesh sob teste e as luzes permaneceram visíveis;
3. câmera alinhada com a direção solar;
4. `DirectionalLight` e `AmbientLight` foram exercitadas separadamente;
5. a máscara foi alternada entre luz plena e eclipse/trânsito forçado;
6. estado de câmera, luzes, uniforms e visibilidade foi restaurado após cada fixture;
7. no WebGL2, uma captura de aquecimento foi descartada depois de mudar as intensidades das luzes.

### Resultado — Saturno

Foi forçado um trânsito cobrindo o globo inteiro pelo mesmo `moonTransitLight` que compõe `directLightMask`.

| Backend | Cenário | Resultado |
|---|---|---|
| WebGPU | Ambient-only; máscara off/on | `MAE = 0`, `max = 0`; média `27.604274 -> 27.604274` |
| WebGPU | Direct-only; máscara off/on | média `65.706682 -> 11.050258`; `MAE = 54.700942` |
| WebGL2 | Ambient-only; máscara off/on | `MAE = 0`, `max = 0`; média `27.605995 -> 27.605995` |
| WebGL2 | Direct-only; máscara off/on | média `65.658392 -> 11.028235`; `MAE = 54.674268` |

O trânsito artificial conserva 3% da luz por desenho de `moonTransitLight`, portanto o resultado direct-only não deve cair a zero absoluto.

Também foi testada a face noturna de Saturno com `DirectionalLight = 0` e `AmbientLight = 0`, deixando apenas ringshine emissive no mesh:

```text
WebGL2, emissive-only
média máscara off = 4.806141
média máscara on  = 4.806141
MAE               = 0
max delta         = 0
```

Isso confirma diretamente que a máscara de trânsito não reaparece no ringshine.

### Resultado — rota Hapke real

Mimas foi testado com o material carregado do runtime, incluindo mapa, Hapke e Saturnshine:

| Backend | Cenário | Resultado |
|---|---|---|
| WebGPU | Ambient/emissive; eclipse 1/0 | `MAE = 0`, `max = 0`; média `11.009965 -> 11.009965` |
| WebGPU | Direct-only; eclipse 1/0 | média `67.549387 -> 11.009965`; `MAE = 56.587216` |
| WebGL2 | Ambient/emissive; eclipse 1/0 | `MAE = 0`, `max = 0`; média `0.141783 -> 0.141783` |
| WebGL2 | Direct-only; eclipse 1/0 | média `62.858275 -> 0.141783`; `MAE = 62.732012` |

A diferença do nível emissivo entre as sessões decorre da geometria orbital/face de Saturnshine visível; o critério relevante é a invariância dentro de cada captura controlada.

### Smoke dos backends

| Backend | Resultado |
|---|---|
| WebGPU | Cena completa carregou e compilou todas as rotas; sem erro de shader |
| WebGL2 com `?webgl` | Cena completa carregou e compilou todas as rotas; zero erros de console |

No WebGPU houve apenas o 404 do favicon. Nos dois backends apareceram os avisos TSL já conhecidos, sem novo warning da Onda 2.

## Critérios de aceitação

- [x] `colorNode` de Saturno sem ring shadow ou moon transits.
- [x] Ring shadow e moon transits entram no caminho direto.
- [x] Ambient de Saturno invariável com a máscara.
- [x] Ringshine emissive invariável com a máscara.
- [x] Rota Hapke mascara somente luz direta.
- [x] Rotas Standard, Titan e Hyperion usam o material mascarado.
- [x] Saturnshine permanece emissive e não é eclipsada pela máscara solar.
- [x] Sem segunda multiplicação por `N·L`.
- [x] `npm run build`, `npm run check` e `git diff --check` passam.
- [x] WebGPU e WebGL2 exercitados com fixtures controladas.
- [x] HG, atmosfera, haze, plumas, Sol e pós-processamento não foram alterados.

## Notas não bloqueantes e loopholes futuros

1. O selfcheck atual não percorre de fato a rota `map != null`: ele testa Mimas procedural e instancia `MoonNodeMaterial` separadamente. O runtime real cobriu essa lacuna nesta revisão. Como hardening futuro, usar uma `Texture` mínima no selfcheck evitaria que a seleção da rota mapeada regredisse.
2. `DirectMaskedStandardMaterial` e `MoonNodeMaterial` não sobrescrevem `copy()`. Um futuro `clone()` pode perder `directLightMask`; no caso Hapke, também merece teste de preservação de `hapkeParams`. Não há clone/copy desses materiais no código atual, portanto não é bloqueador.
3. A frase “todas as luzes diretas” deve ser entendida como as luzes que passam por `LightingModel.direct()`. `RectAreaLight` usa `directRectArea()` e hoje não seria mascarada. A cena atual possui somente uma `DirectionalLight`, o Sol.
4. Se uma segunda luz Point/Spot/Directional for adicionada, ela também receberá a máscara. Essa limitação já está documentada no novo arquivo e não afeta a cena atual.
5. Haze de Titan, atmosfera de Saturno e plumas permanecem fora deste contrato. Não tentar corrigi-los dentro da Onda 3; pertencem à Onda 4.

---

# Autorização operacional — Onda 3

## Objetivo único

Corrigir de forma coerente Sol, sky e fontes do pós-processamento, eliminando o desacordo entre billboard finito, luz direcional, oclusão e artefatos de lente.

## Ordem obrigatória

1. Registrar novamente `HEAD`, `git status`, build/check e os warnings atuais.
2. Demonstrar separadamente, com captura A/B, qual parte do aspecto quadrado vem de raw, bloom, anamórfico e lens flare.
3. Tornar Sol e sky camera-centered ou verdadeiramente direcionais antes de retunar tamanho/brilho.
4. Unificar a direção aparente usada por disco, iluminação e oclusão.
5. Separar disco físico, halo artístico e fonte HDR do sistema de lente.
6. Só depois decidir tamanho angular, filtros e `generateMipmaps`.

## Critérios mínimos

- a câmera não alcança nem atravessa Sol ou sky;
- focar Iapetus não produz parallax perceptível do Sol;
- disco, luz e teste de oclusão permanecem alinhados;
- o disco raw permanece circular nas escalas relevantes;
- highlights não solares não geram anamórfico/ghosts controlados pelo gate do Sol;
- cada contribuição do halo quadrado é identificada por A/B controlado;
- WebGPU e WebGL2 passam;
- `npm run build`, `npm run check` e `git diff --check` passam.

## Restrições

- Não alterar a arquitetura direct-only aprovada nesta revisão.
- Não corrigir HG/Hapke, penumbras, atmosfera, haze, plumas ou órbitas.
- Não fazer retuning global de exposure/bloom sem primeiro isolar a fonte do artefato.
- Não misturar a Onda 4 no mesmo patch.
- Não fazer commit, push, merge ou deploy sem autorização explícita.

## Entrega esperada

Apresentar primeiro o diagnóstico A/B do pipeline do Sol e a proposta de arquitetura da Onda 3. Em seguida, implementar o menor patch coerente e entregar:

1. diff e arquivos alterados;
2. alinhamento disco/luz/oclusão;
3. capturas raw, bloom, anamórfico e flare com estado idêntico;
4. teste de parallax em Saturno e Iapetus;
5. resultados WebGPU/WebGL2;
6. build/check/diff-check;
7. riscos e itens deliberadamente adiados para a Onda 4.
