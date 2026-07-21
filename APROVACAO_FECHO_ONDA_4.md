# APROVAÇÃO — Fecho da Onda 4 / F7 (Sol físico + fonte de luz única)

**Veredito: APROVADA.** Os 2 retoques do delta final foram verificados no código e
nos 3 frames de fecho (WebGPU, aba visível, server reiniciado antes de julgar —
protocolo pós-lição-do-Vite).

## Verificação final (4ª rodada)

| Frame | Resultado |
|---|---|
| Wide FOV 45°, sol em quadro | Glow circular quente sobre o limbo backlit — **sem streak de contas** (anamórfico removido do composite), sem violeta |
| Close FOV 12° | Falloff Lorentz suave até o fundo — **sem moldura quadrada** (saia janelada a zero em r=0.5), sem barra azul |
| Ocaso b≈61 | Brasa laranja-avermelhada no limbo com glare na MESMA cor (tint (0.065, 0.007, 0.0001) × vis) — lockstep disco+glare confirmado |
| Estático | `npm run build` + `npm run check` (kepler + w1–w4) verdes |

## O que a Onda 4 entrega (estado final)

- **Disco solar físico**: tamanho de `SUN_ANGULAR_RADIUS` (×3.5 apresentação),
  limb darkening cromático, borda fwidth AA, radiância 90 saturando AgX — sem halo
  pintado no display; depth-tested contra planeta/anéis/luas.
- **Glare 100% do sistema de lente**: seed com perfil radial (núcleo + saia Lorentz
  janelada) + softener mínimo, composto com gate único `tint × vis`; flare quente
  opcional. Anamórfico removido (YAGNI — brigava com o visual).
- **Fonte de luz única**: zero AmbientLight; noite via ringshine (0.92) / saturnshine /
  shine dos anéis. 
- **Oclusão total do glare**: Saturno (umbra oblata + penumbra), anéis (perfil real),
  luas (eclipses em fly-by, oclusão total), suavizado a ~10 Hz.
- **Pôr-do-sol**: extinção Rayleigh analítica (k=22) — branco → laranja → brasa →
  extinto, disco e glare em lockstep.
- **Penumbra da sombra dos anéis** no globo (3 taps, clamp equinócio).
- **QA**: capture() sem resize (downsample 2D), wave4.selfcheck no `npm run check`.

Arquitetura de layers da Onda 3 preservada; zero passes novos; zero texturas novas.

## Commit

Autorizado pelo revisor com a mensagem sugerida:

```
F7: physical sun, single-source lighting, post glare, sunset extinction
```

**Aguarda o GO do dono do projeto para commitar** (nada foi commitado até aqui).

## Notas herdadas para ondas futuras

1. Reiniciar o dev server após edições externas antes de QA visual (watcher do Vite
   no Windows perde writes de outros processos; moduleGraph serve transform velho).
2. Captura headless por RT: WebGPU-only com aba oculta; com aba visível usar
   screenshot do pane (o readback em RT lê zeros com o rAF loop vivo — não investigado
   a fundo; screenshot cobre o caso).
3. Métricas de pixel no limbo somam o arco da atmosfera atrás do disco aditivo —
   julgar cor por imagem.

Evidências acumuladas das 4 rodadas: `output/onda4-review/` + frames finais na
transcrição da revisão.
