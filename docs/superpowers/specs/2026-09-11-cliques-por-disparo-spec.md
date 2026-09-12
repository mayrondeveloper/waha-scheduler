# Cliques por disparo — spec

Data: 2026-09-11
Status: rascunho para revisão

## Problema

O histórico de hoje diz se a mensagem foi entregue ao grupo ou falhou. Não diz
se alguém agiu. Para quem vive de grupo de ofertas e afiliação, o clique é o
que vira comissão; sem ele, escolher horário, texto e grupo é chute. Para
comunidades e avisos, o clique é o único sinal de que o aviso foi lido.

Sem isso, o waha-scheduler é um agendador entre muitos. Com isso, ele responde
a pergunta que o dono do grupo faz toda semana: "o que funcionou?".

## Objetivos

1. Todo disparo com link mostra quantos cliques teve, no total e por grupo,
   sem o usuário fazer nada além de colar o link na mensagem.
2. Dá para comparar agendamentos, grupos e horários pelo número de cliques.
3. O envio nunca depende do rastreador: se ele estiver fora do ar, a mensagem
   sai com o link original e o histórico diz que aquele disparo não foi medido.
4. O agendador continua rodando na máquina do usuário. Só o redirecionador é
   público, e ele é a semente do produto hospedado.

## Não objetivos

- **Atribuir venda ou comissão.** Depende do site de destino ou do programa de
  afiliados; o UTM que o sistema acrescenta é o que permite fechar essa conta
  lá. Fica fora.
- **Saber quem clicou.** Grupo de WhatsApp não dá identidade, e guardar isso
  criaria um problema de LGPD sem ganho para o dono do grupo.
- **Encurtador de uso geral** (link avulso, QR code, vanity URL). O link
  rastreável existe só dentro de um disparo.
- **Teste A/B de mensagem.** Vem depois, sobre os mesmos dados (P2).
- **Medir abertura ou visualização.** O WhatsApp não expõe isso por link.
  A contagem de "visto por" via acks fica registrada como P2.

## Como funciona, na visão do usuário

1. O usuário escreve a mensagem como hoje, com um ou mais links.
2. Em cada disparo, para cada grupo, o agendador troca cada link por um link
   rastreável único daquele (disparo, grupo, link): `https://<domínio>/r/<código>`.
3. Quem clica cai no redirecionador, que conta o clique e manda para o destino
   com UTM (`utm_source=whatsapp`, `utm_medium=grupo`, `utm_campaign=<agendamento>`,
   `utm_content=<grupo>`), sem mexer em parâmetros que o link já tinha.
4. O histórico passa a mostrar "3 de 3 grupos · 47 cliques (31 únicos)" e,
   aberto, os cliques de cada grupo. A lista de agendamentos mostra os cliques
   do último envio.

Nada muda no jeito de escrever, agendar ou enviar.

## Histórias de usuário

Dono de grupo de ofertas:

- Quero ver quantos cliques cada envio gerou, para saber quais ofertas
  interessam ao grupo.
- Quero comparar o mesmo agendamento em grupos diferentes, para descobrir
  onde a audiência responde.
- Quero comparar horários, para mover o envio para a hora que rende mais.
- Quero que o link apareça com prévia (título e imagem do produto), porque
  oferta sem foto rende menos.
- Quero desligar o UTM num agendamento, porque alguns links de afiliado não
  aceitam parâmetro extra.

Administrador de comunidade:

- Quero saber se o aviso com link foi clicado, para não repetir o que ninguém
  leu.

Qualquer usuário:

- Quero que o envio saia mesmo se a medição falhar, porque perder o horário é
  pior do que perder o número.
- Quero que um link de um envio antigo continue funcionando, porque as
  mensagens ficam no grupo para sempre.

## Requisitos

### P0: sem isto não resolve o problema

**R1. Identidade de disparo.** Cada execução de um agendamento (pelo cron ou
pelo "Enviar agora") recebe um `dispatchId` gerado no agendador, gravado em
cada linha do log de envios. Campo novo e aditivo: o formato atual continua
válido, e o harness não é afetado.

- Dado um disparo para 3 grupos, as 3 linhas do log têm o mesmo `dispatchId`.
- O histórico agrupa por `dispatchId` quando ele existe, e só cai na regra
  atual (rótulo, 60 s, grupo repetido) para linhas antigas sem o campo.

**R2. Link rastreável por (disparo, grupo, link).** Antes de enviar, o
agendador pede ao redirecionador um código por combinação, numa única chamada
por disparo, e troca cada URL do texto pelo link rastreável correspondente.

- Dado um texto com 2 links e um disparo para 3 grupos, são criados 6 códigos
  e cada grupo recebe o texto com os seus 2 links.
- A troca preserva o resto do texto (formatação, emoji, quebras).
- Código de 10 caracteres em base62, aleatório, não sequencial.
- O redirecionador responde em até 2 s; acima disso, o agendador segue para R3.

**R3. Envio nunca depende do rastreador.** Se a criação dos links falhar
(fora do ar, sem chave, tempo esgotado), a mensagem sai com os links originais
e o log recebe `tracking: "unavailable"` naquele disparo.

- Dado o redirecionador fora do ar, o envio sai no horário e o histórico
  mostra "não medido" no lugar dos cliques.
- Nenhuma tentativa de retry no agendador (regra do projeto).

**R4. Redirecionamento.** `GET /r/<código>` responde `302` para o destino
final e registra o clique de forma assíncrona. Código inexistente responde
`404` com uma página neutra.

- O destino é sempre o que está gravado para o código. Nenhum parâmetro da
  requisição altera o destino (sem open redirect).
- Só destinos `http` e `https` são aceitos na criação.
- Um link continua redirecionando indefinidamente.

**R5. UTM.** Ao criar o link, o redirecionador monta o destino final com
`utm_source=whatsapp`, `utm_medium=grupo`, `utm_campaign=<slug do agendamento>`,
`utm_content=<slug do grupo>`. Parâmetros que o link já tem não são
sobrescritos. Cada agendamento tem a opção "Adicionar UTM", ligada por
padrão.

**R6. Filtro de acessos que não são cliques.** Contam como clique apenas
acessos `GET` com User-Agent de navegador. Não contam:

- User-Agent contendo `WhatsApp`, `facebookexternalhit`, `bot`, `crawler`,
  `preview`, ou requisições `HEAD` (buscadores de prévia e robôs).
- Acessos nos primeiros 60 s após a criação do link vindos do mesmo endereço
  que criou o link (a prévia gerada pelo WhatsApp Web do próprio remetente,
  que na engine WEBJS roda num Chromium com User-Agent comum).

Esses acessos ficam registrados com `kind` próprio (`preview`, `bot`), para
auditoria, mas fora das contagens.

**R7. Cliques e cliques únicos.** Clique único por dia = mesma combinação de
endereço e User-Agent, reduzida a um hash com sal que muda a cada dia. O
endereço nunca é guardado em claro.

**R8. Contagens na tela.** O servidor local da tela expõe
`GET /api/clicks?dispatch=<id>&dispatch=<id>`, que consulta o redirecionador
com a chave da conta e devolve, por disparo, `{ clicks, unique, groups: { [chatId]: { clicks, unique } } }`.
A chave nunca chega ao navegador. Resposta cacheada por 60 s.

- O histórico mostra "47 cliques (31 únicos)" na linha do disparo e, aberto,
  os cliques por grupo.
- A lista de agendamentos mostra os cliques do último disparo.
- Disparo sem link mostra "sem link"; disparo não medido mostra "não medido".
- Com a aba de histórico aberta, as contagens se atualizam a cada 60 s.

**R9. Configuração.** `CLICKS_URL` e `CLICKS_API_KEY` no `.env`. Sem elas, a
função fica desligada: envios saem com os links originais, e o histórico
mostra "cliques desligados" com a instrução de configurar.

**R10. Privacidade e retenção.** Sem cookies no redirecionamento. Cliques
brutos guardados por 180 dias; totais por link, para sempre. `robots.txt`
bloqueando `/r/`. Nenhum dado pessoal identificável é gravado.

### P1: melhora muito, mas o núcleo funciona sem

**R11. Prévia do destino, não do redirecionador.** Enviar com
`POST /api/send/link-custom-preview` do WAHA (disponível na engine WEBJS, que
é a em uso), com título, descrição e imagem buscados pelo agendador nas tags
Open Graph do destino. Assim a prévia mostra o produto, ninguém busca o link
rastreável para gerar prévia, e o filtro de R6 deixa de depender da regra dos
60 s.

**R12. Visão de comparação.** Uma aba "Cliques" com três tabelas: por
agendamento (últimos 30 dias), por grupo e por hora do dia. Sem gráfico na
primeira versão.

**R13. Taxa de clique aproximada.** Denominador = participantes do grupo no
momento do disparo (`GET /api/{session}/groups/{id}`, campo `participants`),
guardado no log. Mostra "47 cliques em 812 participantes (5,8%)".

**R14. Reprocessar.** Botão "medir de novo" não existe; mas o histórico
avisa quando um disparo teve links e ficou sem medição, para o usuário saber
que o número está incompleto.

### P2: fora desta versão, mas o desenho não pode fechar a porta

- **Domínio próprio por conta.** Um domínio compartilhado entre contas
  concentra risco de reputação no WhatsApp. O modelo de dados já separa por
  conta; o domínio vira atributo da conta.
- **"Visto por N" via acks do WAHA** (`message.ack` e informações da
  mensagem), para uma taxa de clique real em vez da aproximada.
- **Teste A/B**: dois textos para o mesmo agendamento, metade dos grupos cada.
- **Webhook de clique** para o sistema do usuário (ex.: o gerador de ofertas
  aprende o que rendeu).
- **API pública** para criar disparos a partir de sistemas externos.

## Arquitetura

### Componentes

```
Máquina do usuário                          Público (hospedado)

 tela (127.0.0.1)  ── GET /api/clicks ──►  redirecionador
       │                                     ├─ POST /api/links   (chave da conta)
 agendador ──────── POST /api/links ─────►   ├─ GET  /api/dispatches/:id/clicks
       │                                     └─ GET  /r/:código ──► 302 destino
       ▼                                              ▲
     WAHA ─────► WhatsApp ─────► grupo ───── clique ──┘
```

O redirecionador é um serviço novo, público, com várias contas desde o
início (é a parte hospedada do produto). O agendador e a tela continuam
locais e viram clientes dele.

### Redirecionador

Um serviço pequeno: dois endpoints de API autenticados por chave e um de
redirecionamento. Modelo de dados:

```
accounts   id, name, api_key_hash, created_at
links      code (pk), account_id, dispatch_id, schedule_id, schedule_name,
           group_id, group_name, url, final_url, created_at, creator_ip_hash
clicks     id, code, at, kind (human|preview|bot), visitor_hash
```

Índices: `links(account_id, dispatch_id)`, `clicks(code, at)`.

Contrato de `POST /api/links`:

```json
{
  "dispatchId": "dsp-3f9a1c2b",
  "schedule": { "id": "sch-a1", "name": "Ofertas da manhã" },
  "groups": [{ "id": "1234@g.us", "name": "Compara Livros - Ofertas" }],
  "urls": ["https://loja.exemplo/produto?tag=afiliado"],
  "utm": true
}
```

Resposta: `{ "links": { "<groupId>": { "<url>": "https://<domínio>/r/<código>" } } }`.

Segurança: chave por conta (`Authorization: Bearer`), guardada como hash;
limite de requisições por endereço em `/r/`; corpo de `POST /api/links`
limitado; TLS obrigatório; o serviço nunca renderiza conteúdo do destino.

Stack: decisão em aberto (ver perguntas). Duas opções coerentes:

- **Mínimo:** Node com `node:http` e `node:sqlite` (Node 24), sem dependência,
  um container. Segue o espírito deste repositório.
- **Semente do SaaS:** o primeiro módulo da arquitetura NestJS + Postgres que
  você desenhou (`accounts` com chave de API, `links`, `clicks`, o endpoint
  `/r/`). Sem BullMQ, Redis, contatos ou templates por enquanto.

### Mudanças no waha-scheduler

| Arquivo | Mudança |
|---|---|
| `src/broadcast.js` | Recebe `dispatchId` e um mapa de links por grupo; grava `dispatchId` e `tracking` no log |
| `src/links.js` (novo) | `findUrls(text)`, `rewriteLinks(text, map)` (puras) e `requestLinks(input, cfg)` (chamada ao redirecionador, com tempo limite) |
| `src/index.js`, `src/ui/routes/actions.js` | Geram o `dispatchId` (`newId('dsp')`, hoje função interna de `schedules.js`; passa a ser exportada) e chamam `requestLinks` antes do `broadcast` |
| `src/config.js` | `CLICKS_URL`, `CLICKS_API_KEY` |
| `src/ui/routes/actions.js` | `GET /api/clicks` com cache de 60 s |
| `public/history.js` | Agrupa por `dispatchId` quando existe |
| `public/history-view.js`, `public/schedules-view.js` | Cliques na linha, por grupo, e no último envio |
| `schedules.json` | `utm: true|false` por agendamento (default `true`) |
| `harness/` | Não muda. O campo novo no log é aditivo |

`sendText` hoje não passa `linkPreview`; a primeira versão mantém o
comportamento atual e o R11 troca o envio pelo `link-custom-preview`.

## Riscos e suposições

| Risco | Como tratar |
|---|---|
| A prévia do WhatsApp não segue o `302` e o link aparece sem imagem | Spike antes de tudo (fase 0); R11 resolve de vez |
| Links de redirecionamento em envio em massa aumentam o risco de bloqueio do número | Domínio próprio com HTTPS, nunca IP; texto com a marca; domínio por conta em P2 |
| Programas de afiliado (Amazon, Shopee, Mercado Livre) restringem "mascarar" o link | Confirmar as regras antes de vender para afiliados; a opção de UTM já existe por agendamento |
| A regra dos 60 s (R6) conta ou descarta errado | Registrar `kind` em todo acesso e auditar nos primeiros disparos; R11 elimina a prévia do caminho |
| O redirecionador vira dependência do horário | R3: o envio nunca espera mais que 2 s nem falha por causa dele |

**Suposição mais arriscada:** que o dono de grupo de ofertas muda de
comportamento (horário, grupo, texto) a partir dos cliques e paga por isso.
Se testa em conversa, não em código.

## Métricas de sucesso

Indicadores rápidos (30 dias após ligar):

- 100% dos disparos com link medidos, sem nenhum envio atrasado ou falho por
  causa do rastreador.
- Acessos classificados como `preview`/`bot` abaixo de 20% do total; acima
  disso, o filtro está errado.
- Pelo menos uma mudança de horário ou de grupo feita com base nos cliques
  no uso do Compara Livros.

Indicadores lentos (90 dias):

- 3 donos de grupo fora do Compara Livros usando o redirecionador hospedado.
- Ao menos 1 deles pagando.

## Perguntas em aberto

Bloqueiam o início:

1. **Domínio do redirecionador** (você): qual domínio e quem o hospeda. Curto,
   com HTTPS, e que pareça marca, não encurtador genérico.
2. **Stack do redirecionador**: decidido em 2026-09-11, Node puro mínimo
   (`node:http` e `node:sqlite`, sem dependência), por enquanto.
3. **Spike da prévia**: autorizado em 2026-09-11. Um envio real, só para o
   próprio número, para observar quem busca o link e se a prévia sai. É a
   única etapa que exige mensagem real.

Não bloqueiam:

4. **Regras de afiliado** (você): Amazon Associates e Shopee permitem link
   com redirecionamento? Isso define se afiliados podem usar sem risco.
5. **UTM ligado por padrão** (você): mantém, ou desliga por padrão para
   afiliados?
6. **Retenção de 180 dias** (você): suficiente?

## Resultado parcial do spike (2026-09-11)

Envio real de uma mensagem com link de redirecionamento (túnel temporário,
`302` para uma página com Open Graph) para o próprio número, pelo
`POST /api/sendText` sem `linkPreview`, engine WEBJS:

- **Ninguém buscou o link ao enviar.** Nenhum acesso no servidor de
  redirecionamento nos minutos seguintes ao envio. A regra dos 60 s do R6
  não chegou a ser exercitada; continua como proteção.
- **A prévia sai vazia.** A mensagem gravada tem `subtype: "url"`,
  `richPreviewType: 0`, `title` igual ao domínio e `description` igual à
  própria URL, sem imagem. Para oferta com foto, o `link-custom-preview`
  (R11) deixa de ser refino e passa a ser condição: recomendo promover R11 a
  P0 na implementação.
- O clique humano (toque no celular) ainda não foi observado; o servidor de
  teste continua no ar aguardando.

## Fases

- **Fase 0, spike (1 dia):** enviar uma mensagem com link de redirecionamento
  temporário para um grupo de teste e registrar quem acessa e quando.
  Responde às perguntas 3 e ao risco da prévia.
- **Fase 1, identidade de disparo:** R1 e a mudança do histórico. Sem
  dependência externa, e já melhora o histórico atual, que hoje agrupa por
  aproximação.
- **Fase 2, medição:** redirecionador (R4 a R7, R10), integração no agendador
  (R2, R3, R9) e cliques na tela (R8).
- **Fase 3, refino:** R11 a R13.

Cada fase entrega algo usável sozinho.

## Encaixe na arquitetura SaaS

Da arquitetura desenhada, o que esta função usa desde já: `Organization` com
chave de API (aqui, `accounts`), Postgres, Docker Compose e a separação
"aplicação decide, provider transporta". O que ela não precisa: BullMQ, Redis,
`Contact`, `ScheduledMessage` por contato, `Template`, inbox.

O que a arquitetura não tem e esta função exige: uma entidade de **disparo**
(uma execução para N grupos), a entidade **grupo**, e **link/clique**. O
modelo atual é de mensagem 1:1 por contato; grupos de ofertas e comunidades
são 1:N por grupo. Vale acrescentar `Group`, `Dispatch`, `Link` e `Click` ao
desenho antes de implementar qualquer módulo, para o SaaS não nascer com o
formato de um CRM.
