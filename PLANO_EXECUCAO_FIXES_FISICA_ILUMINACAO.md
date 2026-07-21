# Plano de execução — correções de física, iluminação e robustez

**Projeto:** Saturn WebGPU / Three.js  
**Commit-base analisado:** `c190a8a` (`main`)  
**Data:** 2026-07-20  
**Documentos de evidência:**

- `AUDITORIA_FISICA_ILUMINACAO_PARA_REVALIDACAO.md`
- `REVALIDACAO_AUDITORIA_FISICA_ILUMINACAO.md`

## Mandato para a próxima IA

Leia os dois documentos acima, mas use este arquivo como ordem operacional.

**Comece implementando a Onda 1.** Não produza apenas outro relatório. Faça as alterações, valide-as e entregue evidência objetiva do antes/depois.

A Onda 1 é o escopo imediato autorizado por este handoff. Não misture a Onda 2 no mesmo patch. Depois de concluir e validar a Onda 1, apresente o resultado para revisão antes de avançar pelas ondas arquiteturais.

Não faça commit, push, merge ou publicação sem autorização explícita. Preserve alterações e arquivos não relacionados existentes no worktree.

## Regras de execução

1. Reconfirme `HEAD`, branch e `git status` antes de editar.
2. Leia o código atual; números de linha dos relatórios podem ter mudado.
3. Para cada correção, registre causa, mudança, teste e risco visual.
4. Não corrija um sintoma visual escondendo um erro de física.
5. Não agrupe alterações de câmera, iluminação, atmosfera e look-dev no mesmo diff.
6. Preserve WebGPU e o fallback WebGL2.
7. Toda alteração de shader deve ser testada nos dois backends.
8. Capturas comparativas devem usar a mesma data, câmera, resolução, exposição e preset.
9. Se o runtime contradizer os relatórios, pare e documente a contra-evidência.
10. Não altere baselines ou screenshots apenas para fazer uma verificação passar.

## Vereditos consolidados

### Confirmados

- Sombra dos anéis e trânsitos multiplicam o albedo de Saturno.
- Isso contamina `AmbientLight`; a solução correta é atenuar somente a luz direta.
- O snap de foco é causado pelo clamp de `minDistance` antigo durante a interpolação.
- O denominador usado na sombra dos anéis pode zerar/inverter perto do equinócio.
- O Sol finito a 24.000 unidades diverge da luz direcional e pode ser alcançado pela câmera.
- As penumbras planeta→lua e planeta→anéis têm largura/posição incorretas.
- A atmosfera não testa oclusão do corpo sólido nem sombra dos anéis.
- A radiância atmosférica é submetida novamente a straight-alpha no blend.
- A convenção HG/Hapke atual favorece a fase errada para `g < 0`.
- Fases de nuvens e F-ring têm wraps não periódicos visualmente.
- A política de sombra muda entre materiais Hapke, Standard e fallbacks.
- README e comentários fazem alegações de precisão acima do modelo atual.

### Reclassificados

- Mipmaps do Sol são hardening útil, mas o pós-processamento é a causa dominante já observada do halo quadrado.
- O gate do flare já retorna uma fração suave; o problema é a geometria aproximada, o raio central e a inconsistência com o billboard visível.
- Resto negativo de `%` em `spokePhase` não é um bug visual por si só; o bug é usar uma fase que sofre wrap como coordenada linear de ruído.
- `AdditiveBlending + opacityNode` não é genericamente incorreto. O problema de alpha da atmosfera é específico porque seu RGB já representa radiância integrada.
- Um possível micro-snap residual de damping ainda é inconclusivo e precisa de teste dirigido.

## Baseline obrigatório antes da primeira edição

Registrar no relatório de implementação:

```powershell
git rev-parse HEAD
git status --short --branch
npm run build
npm run check
```

Também registrar:

- backend WebGPU funcional;
- backend WebGL2 funcional via `?webgl`;
- erros e warnings do console;
- reprodução da transição Saturno→Mimas antes da correção;
- comportamento com `sunDir.y` próximo de zero, se houver hook seguro para controlá-lo.

Não é necessário gerar novas imagens permanentes no repositório. Artefatos temporários de QA devem ser removidos ao final.

---

# Onda 1 — executar agora

## Fix 1.1 — eliminar o snap principal de foco

**Arquivo principal:** `src/camera/FocusControls.ts`  
**Problema:** `OrbitControls.update()` aplica o `minDistance` antigo durante a interpolação, mesmo com `controls.enabled = false`.

### Invariantes da solução

- A distância câmera→target deve evoluir continuamente durante todo o voo.
- `OrbitControls.update()` não pode sobrescrever a pose interpolada com o constraint antigo.
- O `minDistance` final deve ser aplicado antes de devolver controle ao usuário.
- Foco em Saturno, Mimas, Titan e Iapetus deve terminar dentro do framing pretendido.
- Auto-rotate/cinema não pode competir com o lerp durante a transição.
- A câmera deve continuar seguindo a lua depois do foco.
- Re-focar o mesmo corpo deve continuar reenquadrando-o.

### Direção recomendada

Durante uma transição, trate a pose interpolada como autoridade e não execute o caminho normal de clamp/auto-rotate do `OrbitControls`. No término:

1. escreva target e posição finais;
2. instale o novo `minDistance`;
3. reative os controles;
4. sincronize o estado interno do `OrbitControls` sem reintroduzir o limite antigo.

Não acesse propriedades privadas de `OrbitControls` sem necessidade. Se optar por suspender damping durante o voo, teste explicitamente velocidade residual antes do clique para verificar se ela reaparece no frame final.

### Testes de aceitação

Instrumentar temporariamente ou por QA a distância:

```text
distance = camera.position.distanceTo(controls.target)
```

Critérios:

- nenhuma variação descontínua grande no frame final;
- nenhuma permanência artificial no antigo limite de Saturno (~81,36 unidades);
- distância final de Mimas próxima do framing calculado (~1,09 unidade);
- target permanece sobre a posição corrente da lua;
- teste com damping parado e com movimento residual iniciado antes do foco;
- teste com cinema/auto-rotate ligado;
- teste em WebGPU e WebGL2.

Se existir um pequeno snap secundário somente com damping residual, registre-o separadamente; não amplie silenciosamente a mudança sem identificar a causa.

## Fix 1.2 — remover a singularidade da sombra no equinócio

**Arquivo principal:** `src/materials/saturnMaterial.ts`  
**Problema atual:**

```ts
const denom = add(S.y, mul(step(abs(S.y), float(1e-5)), 1e-5));
```

Para `S.y ~= -1e-5`, o denominador pode chegar a zero. Para valores negativos pequenos, pode trocar de sinal.

### Invariantes da solução

- O denominador nunca pode ser zero ou inverter artificialmente o sinal.
- A interseção só deve contribuir quando o raio realmente cruza o plano dos anéis em direção ao Sol.
- Quando `abs(S.y)` estiver abaixo do epsilon, a aproximação de Sol pontual deve ser desativada ou produzir transição estável.
- Nenhum NaN/Infinity pode alcançar `r`, `ru`, textura ou `colorNode`.
- A sombra não pode trocar de hemisfério ao atravessar o equinócio.

### Direção recomendada

Use simultaneamente:

1. denominador com epsilon que preserve o sinal; e
2. máscara explícita de validade para `abs(S.y) >= epsilon`.

Conceitualmente:

```text
signY     = S.y < 0 ? -1 : +1
safeDenom = signY * max(abs(S.y), epsilon)
valid     = abs(S.y) >= epsilon
mask      = inside * toward * valid
```

No limite exatamente equinocial, desabilitar a interseção de Sol pontual é mais estável que inventar uma distância enorme. A iluminação residual de um disco solar finito será tratada na onda de penumbra/óptica, não neste hotfix.

### Testes de aceitação

Avaliar pelo menos:

```text
S.y = -2e-5
S.y = -1e-5
S.y = -5e-6
S.y = 0
S.y = +5e-6
S.y = +1e-5
S.y = +2e-5
```

Critérios:

- zero erros de shader;
- zero pixels NaN/Infinity;
- nenhuma inversão abrupta de faixa;
- comportamento simétrico entre lados positivo e negativo, salvo orientação física norte/sul;
- mesma saída em WebGPU e WebGL2 dentro da tolerância visual.

## Validação de encerramento da Onda 1

Executar novamente:

```powershell
npm run build
npm run check
git diff --check
git status --short
```

Entregar:

1. arquivos alterados;
2. explicação curta da causa e da correção de cada fix;
3. resultados de build/check;
4. evidência de continuidade do foco;
5. evidência do sweep de `S.y`;
6. resultado WebGPU e WebGL2;
7. riscos ou itens inconclusivos restantes.

Não avance para a Onda 2 no mesmo patch.

---

# Onda 2 — arquitetura de iluminação direta

**Executar somente depois da revisão da Onda 1.**

## Objetivo

Remover sombras do albedo e aplicar ring shadow, moon transits e eclipses somente na irradiância direta.

## Saturno

Criar um `MeshStandardNodeMaterial` especializado cujo `setupLightingModel()` devolva um modelo baseado em `PhysicalLightingModel`.

Direção mínima compatível com Three r178:

```ts
class SaturnLightingModel extends PhysicalLightingModel {
  override direct(input: LightingModelDirectInput): void {
    super.direct({
      ...input,
      lightColor: input.lightColor.mul(directShadowMask),
    });
  }
}
```

O código exato deve ser adaptado aos tipos TSL instalados. Não use cast inseguro sem explicar por que ele é necessário.

**Atenção:** esse desenho mascara todos os direct lights. Hoje há somente o Sol; se outra luz direta for adicionada, será necessário identificar a luz solar ou mover a atenuação para um light node específico.

### Critérios

- `colorNode` contém somente o albedo/base color.
- Ring shadow e moon transits afetam `directDiffuse`, não ambient.
- Ringshine emissive permanece sem a faixa de sombra.
- Fixture ambient-only não muda quando a máscara solar varia.
- Fixture direct-only responde integralmente à máscara.
- Terminador não recebe uma segunda multiplicação contínua por `N·L`.

## Luas

- Na rota Hapke, multiplicar `lightColor` ou a contribuição equivalente dentro de `direct()`.
- Na rota Standard/Titan/fallback, usar a mesma política direct-only.
- Saturnshine continua emissive e separada do eclipse solar.
- Não incluir haze/plumas nesta onda; isso pertence à atmosfera.

## Separação de PRs

Não corrigir a convenção HG na mesma mudança. A correção HG altera o look de todas as luas e exige retuning próprio.

---

# Onda 3 — Sol, céu e pós-processamento

## Problemas a resolver em conjunto

1. Billboard do Sol a 24.000 unidades versus luz direcional infinita.
2. `OrbitControls.maxDistance = 25.000`: a câmera pode alcançar/atravessar o plano do Sol.
3. Starfield e starmap são shells centrados em Saturno, não na câmera.
4. Gate usa raio solar físico, enquanto o billboard visível é muito maior.
5. Anamórfico recebe `scenePass` inteiro e lens flare recebe `bloomPass` inteiro; ambos são globalmente gateados pela visibilidade do Sol.

## Ordem interna

1. Tornar Sol e sky camera-centered ou verdadeiramente direcionais.
2. Usar uma única direção aparente para disco, luz e oclusão.
3. Separar tamanho do disco, halo artístico e fonte HDR do post.
4. Criar capturas A/B isolando raw, bloom, anamórfico e lens flare.
5. Avaliar buffer/máscara emissiva exclusivo do Sol para o sistema de lente.
6. Depois disso, decidir `generateMipmaps`, filtros e tamanho angular final.

## Critérios

- Câmera nunca alcança nem atravessa o Sol/sky.
- Sol não apresenta parallax perceptível ao focar Iapetus.
- Disco, iluminação e oclusão permanecem alinhados.
- Oclusão do Sol não desliga artefatos produzidos por highlights não solares.
- O Sol raw é circular em todas as escalas relevantes.
- Cada contribuição responsável pelo halo quadrado fica identificada por A/B.

---

# Onda 4 — penumbras, eclipses e atmosfera

## Penumbras

- Corrigir zona parcial para aproximadamente `R - pen` até `R + pen`.
- Unificar os limites usados em planeta→lua, planeta→anéis e moon transits.
- Avaliar overlap analítico de discos; `smoothstep` pode permanecer como aproximação somente se limites e erro forem documentados.
- Para Titan, decidir entre eclipse espacial por fragmento ou aproximação de poucos samples; um escalar central não representa penumbra parcial.

## Atmosfera

- Testar raio amostra→Sol contra o esferoide sólido.
- Aplicar eclipse de Saturno a Titan haze e Enceladus plumes.
- Adicionar sombra dos anéis depois da oclusão planetária estar correta.
- Corrigir o contrato de radiância integrada versus straight/premultiplied alpha.
- Validar Saturno e Titan separadamente; os regimes ópticos são diferentes.

Não combine a correção alpha com retuning amplo de cores no mesmo diff.

---

# Onda 5 — fotometria dos anéis e tempo

## Anéis

- Converter ou relacionar o profile alpha a profundidade óptica `tau`.
- Fazer transmissão solar depender de `abs(sin(Bsun))`.
- Substituir pisos de 10–15% no equinócio por contribuição coerente com o disco solar finito, ou documentá-los explicitamente como art direction.
- Proteger `normalize(vec3(V.x, 0, V.z))` na vista polar.
- Adicionar máscara radial explícita ao ring slab; não depender do clamp do primeiro/último texel.

## Tempo

- Não usar uma fase que sofre wrap como coordenada linear de ruído na F-ring.
- Tornar nuvens contínuas no limite do ciclo.
- Decidir explicitamente se plumas seguem tempo real ou tempo simulado.
- Um módulo positivo de `spokePhase` melhora clareza, mas sozinho não corrige o pop.

---

# Onda 6 — órbitas, orientação, portabilidade e documentação

## Órbitas

- Versionar fonte, frame e epoch dos elementos.
- Não alegar SAT441/Horizons sem reproduzir os valores e transformações.
- Corrigir tidal lock usando vetor radial real e normal do plano orbital.
- Separar rotação interior (~10,561 h) de System III/magnetosfera (~10,66 h).

## `smoothstep` invertido

O fallback GLSL tem comportamento indefinido quando `edge0 >= edge1`. Substituir padrões como:

```ts
smoothstep(high, low, x)
```

por:

```ts
oneMinus(smoothstep(low, high, x))
```

Fazer isso em mudança mecânica separada, com capturas de paridade para starfield, plumas, ring slab, luas e anéis.

## Documentação

Atualizar o README para distinguir:

- simulação cientificamente inspirada versus efeméride precisa;
- aproximações visuais deliberadas;
- recursos já implementados, como E-ring e ring shadows nas luas;
- limitações restantes de precessão, eclipses mútuos, atmosfera e oclusão.

---

# Backlog visual posterior

Somente depois das ondas de correção:

- ring shadow no raymarch atmosférico com penumbra;
- ringshine azimutal;
- crepuscular/god rays;
- multi-scatter atmosférico;
- TAA/upscaling;
- OIT ou sort estável;
- motion blur/cinema;
- oposição e especular dos grãos dos anéis.

# Definição de pronto global

Um item só pode ser marcado como concluído quando:

1. a causa foi demonstrada no código ou runtime;
2. a correção não transfere o erro para ambient, emissive ou outro material;
3. build e self-check passam;
4. WebGPU e WebGL2 foram exercitados;
5. não surgiram novos warnings relevantes;
6. a comparação visual usa estado controlado;
7. documentação e comentário não prometem precisão maior que a implementação;
8. o diff contém apenas o escopo da onda correspondente.

