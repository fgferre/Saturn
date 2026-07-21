# Auditoria de física, iluminação e robustez — handoff para revalidação

**Projeto:** Saturn WebGPU / Three.js  
**Commit auditado:** `c190a8a` (`main`, alinhado com `origin/main` no momento da análise)  
**Data da auditoria:** 2026-07-20  
**Escopo:** análise de código, física aproximada, build, self-check e validação em navegador.  
**Estado:** diagnóstico independente; nenhuma correção foi implementada.

## Objetivo deste documento

Este arquivo foi preparado para uma segunda IA validar os achados de forma independente. Não trate as conclusões abaixo como verdade por autoridade. Para cada item:

1. leia o código citado e trace o valor até o resultado renderizado;
2. tente reproduzir ou refutar o comportamento;
3. diferencie bug físico, aproximação visual deliberada e preferência estética;
4. registre evidência contrária quando houver;
5. não implemente alterações antes de fechar o diagnóstico, salvo autorização explícita.

## Resumo executivo

O relatório original acerta o problema central da sombra dos anéis: ela é multiplicada no albedo de Saturno e, portanto, também afeta a contribuição do `AmbientLight`. Contudo, duas qualificações são necessárias:

- o Sol quadrado foi observado principalmente depois do pós-processamento; mipmaps podem contribuir, mas não foram confirmados como causa dominante;
- multiplicar a máscara da sombra por `N·L` é apenas um paliativo. A correção física é aplicar sombra e trânsitos somente à contribuição de luz direta.

Além disso, a investigação encontrou problemas independentes de alta relevância:

- snap de câmera ao concluir o foco em luas;
- desacordo entre Sol visível, luz direcional e gate do flare quando a câmera se afasta de Saturno;
- geometria incorreta ou incompleta de penumbras;
- denominador singular na sombra dos anéis perto do equinócio;
- atmosfera iluminada através do corpo sólido e provável composição alpha incorreta;
- convenção inconsistente no termo Henyey–Greenstein/Hapke;
- descontinuidades periódicas em nuvens e F-ring;
- elementos orbitais e nomenclatura de rotação não reproduzíveis de forma consistente contra as fontes declaradas.

## Validações já executadas

| Verificação | Resultado |
|---|---|
| `npm run build` | Passou. Vite alertou sobre chunk principal acima de 500 kB. |
| `npm run check` | Passou: `kepler selfcheck: all assertions passed`. |
| `npm audit` | Zero vulnerabilidades reportadas. |
| Renderização WebGPU | Funcionou. |
| Renderização WebGL forçada com `?webgl` | Funcionou. |
| Console runtime | Avisos de APIs TSL depreciadas; favicon 404; nenhum colapso do renderer. |
| Sol sem pós-processamento | Disco circular. |
| Sol com pós-processamento completo | Halo largo/quadrado e artefatos horizontais. |
| Transição de foco para Mimas | Snap reproduzido no fim da animação. |

O navegador reportou especificamente uso depreciado/sobrecarregado de `atan2` e `transformedNormalView`.

---

## A. Reavaliação do relatório original

### A1. Sombra dos anéis multiplicada no albedo — confirmado

**Evidência:** `src/materials/saturnMaterial.ts:121-155`.

```ts
const shadow = mix(1.0, transmission, mul(inside, toward));
const transits = moonTransitLight(P);
material.colorNode = color.mul(shadow).mul(transits);
```

O próprio comentário do arquivo reconhece que a sombra multiplica o albedo e afirma equivalência quando existe somente um Sol e ambient quase zero. Entretanto, `src/scene/Sun.ts:47-48` adiciona um `AmbientLight(0.035)`. Logo, a equivalência não é exata: a textura já escurecida também entra na iluminação indireta.

**Impacto:** faixas dos anéis e trânsitos podem permanecer perceptíveis onde a contribuição solar direta já deveria ser nula.

**Correção recomendada:**

```text
Lfinal = Ldirect * ringShadow * moonTransits
       + Lindirect
       + Lemissive
```

Um `LightingModel` específico para Saturno é a solução arquitetural mais limpa. Usar `shadow *= saturate(N·L)` dentro do albedo reduz o artefato noturno, mas duplica o peso do cosseno perto do terminador e ainda escurece a luz indireta no lado diurno.

**Pedido à IA revisora:** confirmar se a API de `LightingModel` da versão instalada do Three permite inserir a atenuação depois do BRDF direto sem alterar ambient/emissive.

### A2. Eclipse das luas multiplicado no albedo — parcialmente confirmado

**Evidência:** `src/materials/moonMaterials.ts:229-240` e `src/materials/hapke.ts:71-79`.

`eclipseLight` multiplica `colorNode`. Nas luas mapeadas, porém, `MoonNodeMaterial` usa `HapkeLightingModel`, cujo método `indirect()` é vazio. Nessa rota, multiplicar o albedo é funcionalmente equivalente a atenuar a luz direta, exceto por futuras mudanças no modelo.

O problema continua válido para materiais Standard/procedurais, Titan e fallbacks. Assim, a aparência e a física mudam dependendo da disponibilidade do asset/material.

**Impacto:** comportamento inconsistente entre luas e entre caminho normal e fallback.

### A3. Sol quadrado — sintoma confirmado, causa original não demonstrada

**Evidência:** `src/scene/Sun.ts:14-69` e presets em `src/core/Engine.ts:47-69`.

O Sol é uma textura canvas com gradiente radial sobre um material billboard. A textura usa os defaults de mipmaps do Three, portanto mipmaps são um risco real quando o objeto fica pequeno. Entretanto:

- sem bloom/lens flare, a captura mostrou um disco circular;
- com a cadeia completa, surgiram halo quadrado/largo e streaks horizontais;
- os presets médio/alto habilitam lens flare e o alto também habilita anamórfico.

Isso desloca a causa principal observada para bloom/downsampling/anamorphic/lens flare. A textura/mipmap pode agravar, mas não explica sozinha o teste comparativo.

#### Escala angular

Com escala total de 1.400 unidades e distância de 24.000:

| Região | Raio angular aproximado |
|---|---:|
| Borda do quad | 1,671° |
| Final do gradiente, stop 0,46 | 0,769° |
| Região brilhante, stop 0,12 | 0,201° |
| Núcleo opaco, stop 0,05 | 0,084° |
| Raio solar físico visto de Saturno | ~0,028° |

Portanto, o relatório original chama indevidamente todo o quad de disco. Ainda assim, até o núcleo opaco é cerca de três vezes maior que o raio solar físico, e a região brilhante é cerca de sete vezes maior.

**Correção recomendada:** tornar explícita a separação entre disco físico/estilizado e glow; testar quatro configurações isoladas: raw, bloom, bloom+anamorphic e bloom+lens flare. Um disco procedural e `generateMipmaps = false` continuam recomendados como hardening.

### A4. Itens originais que permanecem válidos

- Ringshine depende essencialmente de latitude e usa uma máscara noturna baseada em posição normalizada, não na normal correta do esferoide.
- O raymarch atmosférico não recebe sombra dos anéis.
- O flare usa uma aproximação de oclusão, não overlap geométrico completo do disco solar.
- O Saturno base é muito próximo de Lambert devido à alta roughness; o limb é delegado principalmente à atmosfera.
- God rays, ringshine azimutal, TAA/OIT e scattering mais rico são melhorias válidas, mas devem vir depois das correções de consistência abaixo.

---

## B. Novos achados P0 — correção funcional/física

### B1. Snap forte ao focar uma lua

**Evidência:** `src/camera/FocusControls.ts:47-90`.

O novo `minDistance` só é instalado quando a interpolação termina. Durante a transição, porém, `OrbitControls.update()` continua aplicando o limite antigo mesmo com os controles desabilitados.

Distâncias aproximadas observadas ao focar Mimas:

```text
t=0 ms       339,56
t=700 ms     164,27
t=1250 ms     81,36  <- clamp antigo
t=1500 ms      1,09  <- novo minDistance entra; salto
```

**Impacto:** movimento de câmera visivelmente descontínuo; o comentário de que adiar o clamp evita snap não corresponde ao runtime.

**Direção de correção:** suspender/interpolar os constraints durante o voo ou evitar que `OrbitControls.update()` faça clamp na pose interpolada. Restaurar o limite final somente depois de posicionar câmera e target consistentemente.

### B2. Sol finito cria parallax incompatível com a luz direcional

**Evidência:** `src/scene/Sun.ts:14,59-69` e gate em `src/main.ts:173-177`.

O billboard do Sol está fixo a 24.000 unidades do centro. A luz, por outro lado, usa uma direção global efetivamente infinita. Na órbita de Iapetus, aproximadamente 3.560 unidades no modelo, uma câmera deslocada perpendicularmente pode enxergar o billboard cerca de:

```text
atan(3560 / 24000) ~= 8,4 graus
```

fora da direção usada pela iluminação.

O gate do flare também usa `sunDir`, e não o vetor câmera→billboard. Disco, iluminação e oclusão podem, portanto, discordar.

**Direção de correção:** centralizar Sol e céu na câmera a cada frame ou renderizá-los como background direcional/infinito. A oclusão precisa usar a mesma direção aparente usada para desenhar o disco.

O starfield usa esferas finitas de aproximadamente 30.000/55.000 unidades e sofre do mesmo tipo de parallax, embora menos perceptível.

### B3. Penumbra de Saturno deslocada e estreita

**Evidência:** `src/physics/eclipse.ts:41-53`.

O código calcula:

```ts
pen = tStar * SUN_ANGULAR_RADIUS + 0.02;
x = (dMin - REQ) / pen;
```

Assim, mantém escuridão total até o limbo geométrico `dMin = REQ` e faz a transição somente entre `REQ` e `REQ + pen`.

Para um emissor com raio angular finito, a zona parcial deve atravessar aproximadamente `REQ - pen` até `REQ + pen`, enquanto a região de umbra completa encolhe com a distância. O modelo atual deixa a umbra larga demais e a transição aproximadamente pela metade.

Em Titan, `pen` fica por volta de 0,607 unidade (~607 km); em Iapetus, ~1,77 unidade. A diferença não é desprezível na escala adotada.

**Limitação adicional:** o eclipse da lua inteira é representado por um escalar calculado no centro em `src/scene/SaturnSystem.ts:280-284`. Titan não pode mostrar um gradiente espacial de eclipse parcial.

### B4. Penumbra da sombra de Saturno sobre os anéis também é estreita

**Evidência:** `src/materials/ringsMaterial.ts:63-75`.

O mapeamento usa aproximadamente `x = (d - R) / pen + 0.5`, gerando transição de `R - 0.5 pen` a `R + 0.5 pen`. A largura total é `pen`, e não aproximadamente `2 pen`.

O overlap de dois discos pode inicialmente ser aproximado por uma curva suave, mas os limites geométricos devem estar corretos. Para maior precisão, usar a área de overlap de dois círculos.

### B5. Denominador singular perto do equinócio

**Evidência:** `src/materials/saturnMaterial.ts:127-128`.

```ts
const denom = add(S.y, mul(step(abs(S.y), float(1e-5)), 1e-5));
```

Para `S.y` negativo e pequeno, somar sempre `+1e-5` reduz, zera e depois inverte o denominador. Em `S.y ~= -1e-5`, a divisão pode produzir infinito/NaN.

**Impacto:** inversão ou instabilidade abrupta da sombra dos anéis nas proximidades do equinócio.

**Direção de correção:** usar epsilon com sinal preservado ou não executar a interseção quando `abs(S.y)` estiver abaixo do limite. Um modelo finito do disco solar deve substituir a troca binária no limite.

### B6. Atmosfera recebe luz através do corpo sólido

**Evidência:** `src/materials/raymarchAtmosphere.ts:92-108`.

Para cada amostra, `sunTrans` depende apenas de densidade/ângulo zenital aproximado. Não existe teste raio→Sol contra o esferoide sólido.

**Impactos:**

- halo iluminado em grande parte da circunferência noturna;
- haze de Titan permanece iluminado quando a superfície entra na sombra de Saturno;
- ausência de sombra dos anéis no limb;
- crepúsculo e night limb excessivamente uniformes.

**Direção de correção:** testar oclusão do esferoide por amostra, com transição pelo raio angular do Sol; depois incorporar transmissão dos anéis.

### B7. Provável dupla multiplicação por alpha na atmosfera

**Evidência:** `src/materials/raymarchAtmosphere.ts:105-121`.

`colorOut` já contém radiância integrada. O material transparente usa:

```ts
material.colorNode = output.rgb;
material.opacityNode = output.a;
```

Com straight-alpha padrão, o blend multiplica novamente RGB por alpha. No regime opticamente fino, tanto radiância quanto alpha são aproximadamente proporcionais à densidade, fazendo a contribuição tender a `densidade²`.

**Direção de correção:** usar composição premultiplicada de forma coerente ou produzir RGB straight-alpha a partir da radiância acumulada, com tratamento seguro quando alpha se aproxima de zero.

**Pedido à IA revisora:** confirmar no shader final WebGPU e WebGL se o pipeline do `MeshBasicNodeMaterial` mantém `premultipliedAlpha = false` e se não existe transformação posterior que já compense o valor.

### B8. Convenção inconsistente no Henyey–Greenstein das luas

**Evidência:** `src/materials/hapke.ts:59-73`.

O código define `cosg = dot(L,V)`, que vale +1 na oposição, e usa a forma HG padrão com denominador `1 + g² - 2g cosg`. Ao mesmo tempo, os parâmetros usam `g < 0` e o comentário os chama de backscattering.

Nessa combinação, o termo HG fica maior em `dot(L,V) = -1`, ou seja, no lado de fase alta/backlit, não na oposição. Para os valores atuais:

| `g` | razão aproximada `P(-1) / P(+1)` |
|---:|---:|
| -0,28 | 5,62× |
| -0,35 | 8,96× |

O opposition surge separado continua favorecendo fase zero, então os dois termos disputam entre si.

**Direção de correção:** escolher e documentar uma convenção única:

- usar `cosTheta = -dot(L,V)` com `g < 0` para a convenção HG de direção de propagação; ou
- manter `dot(L,V)` e adaptar sinal/fórmula para ângulo de fase Hapke.

Os parâmetros precisarão ser recalibrados depois da correção.

---

## C. Novos achados P1 — precisão, estabilidade e coerência

### C1. Transmissão dos anéis ignora profundidade óptica inclinada

**Evidência:**

- `src/materials/saturnMaterial.ts:135-138`: `1 - alpha * 0.86`;
- `src/physics/eclipse.ts:56-64`: `1 - opacity * 0.92`.

Os fatores são fixos e independem da elevação solar sobre o plano. Para profundidade óptica normal `tau`, uma aproximação física é:

```text
T = exp(-tau / abs(sin(Bsun)))
```

A região B possui profundidade óptica alta; portanto os pisos atuais de aproximadamente 14% e 8% deixam sombras densas claras demais, principalmente em ângulo rasante.

**Fontes:**

- NASA NTRS, transmissão solar através dos anéis: <https://ntrs.nasa.gov/api/citations/19720022190/downloads/19720022190.pdf>
- PDS Ring-Moon Systems Node, propriedades dos anéis: <https://pds-rings.seti.org/saturn/saturn_rings_table.html>

### C2. Pisos artificiais de iluminação no equinócio

**Evidência:** `src/materials/ringsMaterial.ts:77-80` e `src/physics/ringshine.ts:112-117`.

Os anéis mantêm 10% de iluminação de face e o ringshine mantém 15% mesmo quando `abs(S.y) = 0`. O disco solar finito justifica uma contribuição pequena e gradual, mas não esses pisos amplos.

Na data padrão auditada, a elevação solar calculada era aproximadamente `-6,53°`: o fator de face atual resulta em ~0,202, contra ~0,114 da dependência geométrica simples — cerca de 1,78×.

**Fonte contextual:** <https://science.nasa.gov/mission/cassini/science/rings/>

### C3. Resets temporais geram pops

**Evidência:** `src/scene/SaturnSystem.ts:242-247`, `src/materials/saturnMaterial.ts:63-83` e `src/materials/fRing.ts:42-56`.

#### Nuvens

```ts
cloudPhaseUniform.value = (jd % 97.5) / 9.75;
```

A fase salta de quase 10 para 0. Ela é aplicada linearmente a velocidades por latitude que não são inteiras/periódicas. O wrap espacial pode chegar perto de meia volta em certas latitudes.

#### F-ring

`spokePhaseUniform`, uma fase angular periódica, é reutilizada como coordenada Z linear de ruído. Ao reiniciar em `2π`, o ruído não coincide com o estado inicial.

No clock padrão de 1 h/s, o pop ocorre aproximadamente a cada 10,66 segundos reais. Em 5 dias/s, ocorre várias vezes por segundo.

#### Plumas

As partículas usam delta real em `src/main.ts:137-145`. Elas continuam evoluindo com a simulação pausada e não acompanham aceleração/reversão temporal. Isso pode ser intencional, mas é uma incoerência que precisa ser decidida explicitamente.

### C4. Elementos orbitais e frames não correspondem consistentemente à fonte declarada

**Evidência:** `src/data/saturn.ts:29-84`.

O comentário afirma “JPL mean elements in Saturn's equatorial plane at J2000”. A tabela atual JPL SAT441 apresenta elementos relativos a planos locais de Laplace e inclui períodos de precessão de nó/ápside. Diversos ângulos do código não coincidem com esse conjunto atual.

Iapetus aparenta combinar uma inclinação equatorial conhecida com outros elementos oriundos de outro frame/modelo, sem uma transformação completa de plano.

**Impacto:** órbitas visualmente plausíveis, mas trânsitos, eclipses e fases para uma data específica não são verificáveis como efemérides JPL.

**Direção de correção:**

1. escolher e versionar exatamente um conjunto de elementos;
2. documentar epoch e reference plane;
3. transformar cada plano de Laplace para o frame da cena;
4. aplicar precessão quando a precisão temporal exigir;
5. ou usar Horizons/SPICE como fonte de estado para datas específicas.

**Fonte:** <https://ssd.jpl.nasa.gov/sats/elem/>

### C5. Rotação: valor defensável, rótulo incorreto

**Evidência:** `src/data/saturn.ts:24` e `src/scene/SaturnSystem.ts:239-243`.

`10.561 h` é aproximadamente 10h33m40s, próximo da estimativa do interior obtida por sismologia dos anéis. Não é o período Voyager/System III de aproximadamente 10h39m24s. Os spokes, separadamente, usam `10.66 h`.

Portanto:

- o valor `10.561` não é necessariamente um bug;
- o comentário `System III` está errado;
- é necessário distinguir rotação interior, magnetosférica e diferencial da atmosfera.

**Fontes:**

- <https://www.jpl.nasa.gov/news/scientists-finally-know-what-time-it-is-on-saturn/>
- <https://www.jpl.nasa.gov/news/rotation-period-of-saturn-determined/>

### C6. Travamento de maré ignora a orientação completa da órbita

**Evidência:** `src/scene/SaturnSystem.ts:257-261` e comentário em `src/orbital/kepler.ts:73-84`.

A lua é rotacionada essencialmente em torno de Y pelo ângulo orbital. Para órbitas inclinadas, isso não alinha rigorosamente o mesmo hemisfério com Saturno. Em Iapetus, a inclinação usada é ~15,47°, logo o erro potencial é visualmente relevante.

**Direção de correção:** construir a orientação usando o vetor lua→Saturno, a normal efetiva do plano orbital e um eixo polar coerente.

### C7. Atmosferas e plumas não herdam o eclipse da lua

`eclipseLight` é aplicado ao material de superfície, mas não é fornecido ao raymarch de Titan nem ao scattering das plumas de Enceladus.

**Impacto:** a superfície pode estar em umbra enquanto haze/pluma continuam recebendo Sol pleno.

---

## D. Robustez, loopholes e dívida técnica

### D1. Normalização de vetor zero na anisotropia dos wakes

**Evidência:** `src/materials/ringsMaterial.ts:119-126`.

```ts
const vH = normalize(vec3(V.x, 0.0, V.z));
```

Em vista polar exata, o vetor horizontal pode ser zero. Dependendo do backend, `normalize(0)` pode produzir zero ou NaN e contaminar o cálculo de cor.

**Correção:** testar comprimento antes de normalizar e fazer fade da anisotropia à medida que a câmera se aproxima do polo.

### D2. Endpoint de captura sem limite no servidor de desenvolvimento

**Evidência:** `vite.config.ts:4-17`.

O middleware `POST /__shot` acumula o corpo completo em memória e sobrescreve `shot.jpg`, sem limite de tamanho, validação de conteúdo ou token.

**Escopo:** não é rota do bundle de produção. Torna-se uma superfície local/LAN se o Vite for iniciado com `--host`.

**Risco:** pressão de memória/disco e sobrescrita repetida do arquivo.

**Correção:** limite de `Content-Length`, interrupção do stream acima do teto, validação de data URL/JPEG, token temporário e binding explícito em localhost.

### D3. Ring slab amostra a borda fora do anel real

**Evidência:** `src/effects/ringSlab.ts:58-64` e gate de câmera em `src/main.ts:182-186`.

O UV radial é clampado fora do domínio em vez de multiplicado por uma máscara `inside`. Assim, partículas podem herdar o primeiro/último texel fora do intervalo físico. O primeiro texel atual possui alpha mínimo, mas não rigorosamente zero.

### D4. Oclusões incompletas

- O flare considera Saturno/anéis, mas não luas que atravessem o disco solar.
- Labels usam Saturno esférico, não o esferoide oblato, e ignoram oclusão pelos anéis.
- Muitos subsistemas assumem Saturno na origem global, o que conflita com a ideia futura de parentear o sistema em uma cena heliocêntrica.

### D5. APIs TSL depreciadas

**Evidência:** `src/materials/ringsMaterial.ts`, `src/materials/saturnMaterial.ts` e `src/materials/hapke.ts`.

O runtime solicita migração de:

- `atan2` para `atan` sobrecarregado;
- `transformedNormalView` para `normalView`.

WebGPU e WebGL ainda funcionaram, mas isso representa risco de quebra em upgrade do Three.

### D6. Documentação defasada

O README ainda lista ausência de E-ring e de sombra dos anéis nas luas como simplificações conhecidas, embora ambos já estejam implementados.

---

## E. Ordem de correção sugerida

### Etapa 1 — invariantes e testes

1. Criar testes numéricos para os limites de umbra/penumbra.
2. Cobrir `S.y = {-epsilon, 0, +epsilon}` na interseção dos anéis.
3. Criar teste runtime para continuidade da distância durante foco.
4. Criar capturas comparativas raw/bloom/anamorphic/lens flare.

### Etapa 2 — iluminação direta

1. Criar `LightingModel` de Saturno.
2. Aplicar ring shadow e moon transits somente à luz direta.
3. Uniformizar a mesma arquitetura nas luas Standard e Hapke.
4. Manter ringshine/Saturnshine como contribuições indiretas separadas.

### Etapa 3 — Sol e background

1. Tornar Sol/starfield camera-centered ou direcionais.
2. Usar exatamente a mesma direção para disco, luz e oclusão.
3. Separar disco solar de glow e calibrar tamanho angular.
4. Só então decidir sobre mipmaps e filtros da textura.

### Etapa 4 — eclipses e atmosfera

1. Corrigir limites geométricos de penumbra.
2. Avaliar overlap analítico do disco solar.
3. Adicionar oclusão do corpo e dos anéis ao raymarch.
4. Corrigir o contrato de alpha/premultiplicação.
5. Propagar eclipse para haze e plumas.

### Etapa 5 — anéis, tempo e órbitas

1. Converter profile alpha em profundidade óptica ou documentar a aproximação.
2. Aplicar transmissão dependente de `Bsun`.
3. Remover pisos arbitrários do equinócio usando disco solar finito.
4. Tornar fases temporais realmente periódicas ou não resetáveis.
5. Versionar a fonte orbital/frame/epoch.

### Etapa 6 — melhorias visuais

Somente depois dos itens anteriores:

- sombra dos anéis na atmosfera;
- ringshine azimutal;
- god rays em geometrias rasantes;
- multi-scatter atmosférico;
- TAA/upscaling;
- OIT ou ordenação estável;
- motion blur e refinamentos de cinema.

---

## F. Checklist para a IA revisora

Responder cada item com **confirmado**, **refutado** ou **inconclusivo**, sempre anexando evidência:

- [ ] A sombra no `colorNode` escurece de fato o `AmbientLight` no shader final?
- [ ] Um `LightingModel` customizado consegue atenuar somente `directDiffuse` nessa versão do Three?
- [ ] A rota Hapke realmente ignora toda iluminação indireta?
- [ ] O Sol permanece circular em raw e fica quadrado somente ao habilitar quais passes?
- [ ] Desabilitar mipmaps altera o defeito em escala pequena?
- [ ] A direção visual do Sol diverge de `sunDir` perto de Iapetus?
- [ ] O gate do flare usa uma direção diferente da posição visível do billboard?
- [ ] O snap de foco é reproduzível e causado pelo `minDistance` antigo?
- [ ] O denominador da sombra produz zero/NaN para algum `S.y` próximo de zero?
- [ ] Os limites atuais de penumbra correspondem apenas a metade da zona geométrica?
- [ ] Titan pode ou não mostrar penumbra espacial em sua superfície?
- [ ] O raymarch ilumina amostras cujo raio solar atravessa o corpo?
- [ ] O blend final multiplica `colorOut` novamente por `opacityNode`?
- [ ] A convenção HG atual favorece fase de 180° para `g < 0`?
- [ ] Os resets de nuvem e F-ring produzem descontinuidade visível?
- [ ] Os elementos orbitais pertencem de fato ao frame/epoch declarado?
- [ ] A orientação de Iapetus mantém a mesma face apontada para Saturno?
- [ ] `normalize(vec3(V.x, 0, V.z))` é seguro nos dois backends quando o vetor é zero?
- [ ] A rota `/__shot` fica inacessível em builds de produção e limitada em desenvolvimento?

## Critério de encerramento da revalidação

A revalidação só deve ser considerada concluída quando:

1. cada item P0 tiver evidência de código e, quando aplicável, reprodução runtime;
2. conclusões refutadas forem removidas, não apenas rebaixadas;
3. aproximações artísticas forem claramente separadas de alegações de precisão física;
4. a futura implementação for dividida em mudanças pequenas, com testes independentes e possibilidade de comparação visual antes/depois.
