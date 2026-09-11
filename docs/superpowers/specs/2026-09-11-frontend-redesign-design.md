# Redesign da tela de agendamentos — design

Data: 2026-09-11
Status: aprovado e implementado

## Contexto

A tela de agendamentos existe desde o design de 2026-09-06
(`2026-09-06-frontend-agendamentos-design.md`) e funciona, mas é crua: todos
os botões têm o mesmo peso, inclusive o "Disparar agora", que manda mensagem de
verdade; o estado ativo/inativo é um botão que parece rótulo; o formulário abre
solto em cima da lista; as confirmações usam o `confirm()` do navegador; e a
lista não mostra quando cada agendamento vai disparar.

O caso que motivou este redesign: o usuário criou um agendamento para as 23:42,
a tela aceitou, e nada ia sair, porque o agendador (`npm start`) não estava
rodando. A tela não tem como saber disso hoje.

Este documento substitui a seção "A tela" do design de 2026-09-06. O resto
daquele documento (formato de dados, contrato do arquivo, API existente,
decisões D1 a D7) continua valendo.

## Objetivo

Uma tela com cara de produto, que responda de relance "o que vai sair, quando,
e se vai sair de fato", e que torne criar e editar agendamentos e mensagens
mais rápido, incluindo a formatação do WhatsApp.

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| R1 | Layout "painel e lista": faixa de status, abas, lista de agendamentos com o próximo envio em cada linha | Com poucos agendamentos, mostra tudo de uma vez; a faixa já responde "qual é o próximo envio" |
| R2 | Paleta neutra; verde, vermelho e âmbar só com significado (rodando/ativo, perigo/falha, atenção) | O status do agendador é o motivo do redesign, e só se destaca se cor na tela significar estado |
| R3 | Tema claro e escuro seguindo o sistema, fonte do sistema, ícones SVG embutidos | Nada carregado da internet; a tela abre offline |
| R4 | Frontend em módulos ES nativos, sem build e sem dependência nova | Mantém a D4; a lógica pura fica testável por import direto |
| R5 | O agendador grava um arquivo de status a cada 15 s; a tela lê por `GET /api/status` | Dois processos separados (D2) sem abrir porta nova no agendador |
| R6 | Painel lateral e modais com `<dialog>` nativo | Esc, foco preso e fundo bloqueado vêm do navegador |
| R7 | Mensagem continua texto cru com marcadores do WhatsApp; a prévia formata ao lado | O que está no campo é exatamente o que o grupo recebe |
| R8 | "Escrever nova" dentro do formulário de agendamento | Para agendamento novo, o texto quase sempre é novo; reaproveitar continua possível |
| R9 | Histórico agrupado por disparo no cliente, sem mudar o formato do log | O log é contrato do harness; o agrupamento cabe em regra simples |
| R10 | Datas exibidas no fuso de `TIMEZONE`, com o nome do fuso escrito | Hoje a tela usa o fuso do navegador; o agendador usa o `TIMEZONE` |

## A tela

### Faixa de status

Fica no topo, em todas as abas, e mostra três coisas:

- Agendador: "Agendador rodando" (verde) ou um dos avisos da tabela de casos de
  borda.
- WAHA: "WAHA conectado" (verde) se `GET /api/groups` respondeu; senão
  "WAHA indisponível" (âmbar) com o erro.
- Próximo envio geral: "Próximo envio: hoje 18:00, Resumo semanal". Some quando
  não há agendamento ativo.

A faixa é atualizada a cada 15 s e quando a aba do navegador volta ao foco.

O item do agendador mostra um único estado. Quando mais de um se aplica, vale
o primeiro desta ordem:

1. "Sem conexão com o servidor da tela" (vermelho), se `GET /api/status` falhou.
2. "Nenhum agendamento ativo" (neutro), se nenhum agendamento está ativo,
   qualquer que seja o estado do agendador.
3. "Agendador parado" ou "parou de responder" (vermelho).
4. "Recarga recusada" (âmbar).
5. "Agendador rodando" (verde).

### Abas

Agendamentos, Mensagens e Histórico, como hoje. O botão principal da aba
("Novo agendamento", "Nova mensagem") fica à direita da barra de abas e é o
único botão preenchido da aba. No painel e nos modais, o único preenchido é o
de confirmar (Salvar, "Enviar para N grupos", Excluir).

### Agendamentos

Cada agendamento é uma linha com:

- interruptor ativo/pausado (`<button role="switch" aria-checked>`), que chama o
  `PATCH` existente;
- nome e, embaixo, quando dispara ("Seg a Sex às 09:00") e o nome da mensagem;
  cron personalizado aparece cru em `<code>`, como hoje;
- próximo envio por extenso ("hoje, 18:00", "seg 14/09, 09:00") ou "Pausado";
- quantidade de grupos;
- "Enviar agora" em vermelho de contorno e um menu "⋯" com Editar e Excluir.

Clicar no nome também abre o painel de edição. Agendamento pausado tem o texto
em cor secundária e a palavra "Pausado", para a cor não ser o único sinal.
Excluir pede confirmação num modal da tela, com o nome do agendamento e o
botão Excluir em vermelho.

Lista vazia: um convite ("Crie seu primeiro agendamento") com o botão de criar.

### Painel de agendamento

Painel lateral à direita (`<dialog>` com `showModal()`), com:

1. Nome.
2. Quando: sete botões de dia (Seg a Dom, semana começando na segunda), atalhos
   "Dias úteis" e "Todo dia", campo de horário. Abaixo, o nome do fuso
   ("Horário Padrão de Brasília") e os próximos 3 envios por extenso, vindos da
   rota `GET /api/cron/preview` que já existe.
3. Mensagem: seleção de mensagem existente com a prévia em balão do WhatsApp,
   ou "Escrever nova", que troca a seleção pelo editor de mensagem (nome já
   preenchido com o nome do agendamento).
4. Grupos: busca por nome, contador de selecionados, lista com caixas de
   seleção. O grupo salvo que o WAHA não lista continua marcado e sinalizado em
   vermelho, primeiro na lista (regra atual). Sem lista do WAHA, o campo de ids
   digitados, já preenchido com os ids salvos (regra atual).
5. Rodapé fixo com Cancelar e Salvar.

Cron personalizado: no lugar do bloco "Quando", o aviso e o campo cru, e salvar
sem mexer o mantém (regra atual).

Salvar com "Escrever nova": `POST /api/messages`, depois `POST` ou `PUT` do
agendamento com o id recebido. Se a mensagem foi gravada e o agendamento não,
o painel continua aberto, com o bloco Mensagem já apontando para a mensagem
recém-criada, e mostra o erro. Tentar de novo não cria outra mensagem.

Fechar (Esc, clique fora, Cancelar, "×") com alteração não salva pergunta
"Descartar alterações?". Alteração não salva é qualquer diferença entre o
estado do formulário ao abrir e agora.

### Editor de mensagem

É o mesmo componente no "Escrever nova" e na aba Mensagens.

- Barra: negrito, itálico, tachado, monoespaçado, lista, lista numerada,
  citação, emoji. Atalhos ⌘B / Ctrl+B e ⌘I / Ctrl+I.
- Campo de texto cru, com os marcadores visíveis.
- Prévia ao lado: balão formatado, "Como chega no grupo". Em tela estreita, a
  prévia vai para baixo do campo.
- Emojis: seletor embutido com cerca de 200 emojis em categorias (Rostos,
  Gestos e pessoas, Natureza e comida, Objetos, Símbolos) e uma aba Recentes
  com os últimos 20 usados, guardada no `localStorage` do navegador. Sem busca.
  O emoji entra na posição do cursor.

Comportamento dos botões da barra (funções puras em `whatsapp.js`, recebem
texto e seleção e devolvem texto e seleção novos):

- Negrito, itálico, tachado: envolvem a seleção com `*`, `_` ou `~`. Espaços nas
  bordas da seleção ficam de fora dos marcadores, porque o WhatsApp não formata
  `* texto *`. Sem seleção, inserem o par com o cursor no meio. Seleção já
  envolvida pelo mesmo marcador é desenvolvida (alterna).
- Monoespaçado: seleção de uma linha vira `` `texto` ``; de várias linhas vira
  bloco ` ``` `.
- Lista, lista numerada, citação: acrescentam `- `, `1. `, `2. `… ou `> ` no
  início de cada linha tocada pela seleção. Se todas já têm o prefixo, removem.

### Regras da prévia (formatação do WhatsApp)

A função `formatWhatsApp(text)` escapa o HTML do texto inteiro antes de
qualquer outra coisa e só então aplica, nesta ordem:

1. Blocos ` ```…``` ` (podem ter várias linhas) viram `<pre>`; o conteúdo não
   recebe mais nenhuma formatação.
2. Código na linha `` `…` `` vira `<code>`; o conteúdo não recebe mais
   formatação.
3. Linhas que começam com `> ` viram citação; com `- ` ou `* `, item de lista
   com marcador; com `N. `, item de lista numerada.
4. `*…*` negrito, `_…_` itálico, `~…~` tachado. O marcador de abertura precisa
   estar no início ou depois de espaço ou pontuação, e ser seguido de caractere
   que não é espaço; o de fechamento precisa vir depois de caractere que não é
   espaço e antes de fim, espaço ou pontuação. Não atravessa quebra de linha.
   Aninhar é permitido (`*_texto_*`).

URLs aparecem como texto. A prévia é uma aproximação: onde divergir do
WhatsApp num caso exótico, só a prévia erra, porque o envio usa sempre o texto
cru.

### Mensagens

Lista com nome, a prévia formatada cortada em duas linhas pelo CSS, "usada
por" com os nomes dos agendamentos (ou "não usada") e as ações Editar e
Excluir. Editar e "Nova mensagem" abrem o painel lateral com o editor. Excluir
pede confirmação no mesmo modal dos agendamentos; mensagem em uso recebe o
aviso 409 do servidor, que já diz quais agendamentos a usam.

### Enviar agora

Modal de confirmação no lugar do `confirm()`:

- título "Enviar "<nome>" agora?" e o aviso de que a mensagem vai de verdade,
  fora do horário agendado;
- a mensagem em balão formatado;
- os nomes dos grupos de destino;
- botões Cancelar e "Enviar para N grupos" (vermelho preenchido).

Durante o envio, o botão vira "Enviando…", o modal não fecha e Esc é ignorado
(a proteção contra clique duplo de hoje continua, agora no modal). No fim, o
modal mostra o resultado: "Enviado para 3 de 3 grupos", ou a lista de falhas
com o erro de cada grupo. A rota `POST /api/schedules/:id/run` não muda e só
responde no fim, então não há progresso por grupo.

### Histórico

- Busca `GET /api/logs?limit=500` (hoje 100).
- Filtros: seleção de agendamento e "Todos | Com falha".
- Cada disparo é uma linha: ícone de sucesso ou falha, nome, selo "manual"
  quando for o caso, "3 de 3 grupos" (em vermelho se houver falha) e quando.
- Disparo com falha já aparece aberto, mostrando cada grupo com o horário e o
  erro; os outros abrem com clique.

Agrupamento (função pura `groupDispatches(logs)` em `history.js`), sobre as
linhas em ordem cronológica. Uma linha começa um disparo novo quando:

- o `label` é diferente do da linha anterior; ou
- passou mais de 60 s desde a linha anterior; ou
- o `chatId` já apareceu no disparo atual (um disparo manda uma vez para cada
  grupo; isso separa disparos seguidos de um cron que roda a cada minuto).

O selo "manual" vem do sufixo " (manual)" que `POST /run` já grava no `label`;
o nome exibido é o `label` sem o sufixo. As opções do filtro de agendamento
saem dos nomes presentes no log, não da lista atual de agendamentos, porque um
agendamento renomeado ou excluído continua no histórico com o nome antigo.

### Avisos

Uma região de avisos (`aria-live="polite"`) no canto da tela substitui o
`#notice`:

- Sucesso ("Agendamento salvo") some sozinho em 4 s.
- Erro fora de painel ou modal fica até ser fechado.
- Erro dentro do painel ou do modal aparece ali mesmo, perto do botão, e não
  vira aviso solto.

O aviso de "grupos indisponíveis" deixa de disputar espaço com os outros: vai
para a faixa de status. A variável `groupsWarningActive` do `app.js` atual some.

### Tela estreita e teclado

- Abaixo de 720 px: linhas de agendamento viram blocos empilhados, o painel
  lateral ocupa a largura inteira, as abas rolam na horizontal.
- Tudo acessível por teclado; foco visível em todos os controles; botões só com
  ícone têm `aria-label`.

### Visual

- Paleta neutra em variáveis CSS no `:root`, redefinidas em
  `@media (prefers-color-scheme: dark)`. O botão principal é preenchido com a
  cor do texto (preto no claro, branco no escuro).
- Cores com significado: verde (rodando, ativo, enviado), vermelho (enviar agora,
  falha, grupo não encontrado), âmbar (atenção: WAHA indisponível, recarga
  recusada).
- Fonte do sistema (`system-ui`).
- Ícones: 19 SVGs do Lucide (licença ISC, aviso no arquivo), embutidos em
  `html.js`.

## Arquitetura

### Módulos do frontend

Todos em `public/`, carregados por `<script type="module" src="/main.js">` e
`import` relativo. Funções simples exportadas; sem classes.

| Arquivo | Conteúdo | Toca no DOM? |
|---|---|---|
| `main.js` | só `import { start } from './app.js'; start();` | sim |
| `app.js` | estado, `start()`, carga, polling do status, delegação de eventos, painel, modais, avisos, faixa de status | sim, só dentro das funções |
| `api.js` | `api(path, init)`: `fetch` com `Content-Type: application/json` em todo método que altera dados, erro em português | não |
| `html.js` | `escape()` e `icon(name)` | não |
| `cron.js` | `WEEKDAYS`, `buildCron`, `parseCron`, `describeCron` (saem do `app.js` atual sem mudar comportamento) | não |
| `dates.js` | `formatWhen(iso, { timeZone, now })` e `formatTime` | não |
| `whatsapp.js` | `formatWhatsApp(text)`, `toggleInline`, `toggleLinePrefix`, `toggleMonospace` | não |
| `emoji.js` | lista de emojis por categoria | não |
| `history.js` | `groupDispatches(logs)` | não |
| `schedules-view.js` | lista de agendamentos, painel, `formCron(form)`, `formGroups(form)` | só gera HTML e lê o form recebido |
| `messages-view.js` | lista de mensagens e editor | só gera HTML |
| `history-view.js` | histórico agrupado e filtros | só gera HTML |
| `status-view.js` | faixa de status: aviso do agendador, WAHA e próximo envio | só gera HTML |

Nenhum módulo executa nada ao ser importado, exceto `main.js`. Com isso, os
módulos de lógica e de HTML são importados direto pelos testes em Node, e o
`app.js` também, com `document` e `fetch` de mentira no `globalThis` (a mesma
ideia da sandbox que o teste atual usa).

`formatWhen` devolve "hoje, 18:00", "amanhã, 09:00", "ontem, 23:39",
"sex 18/09, 18:00" ou, em outro ano, "18/09/2025, 18:00". O dia de referência
é calculado no fuso recebido, a partir do `now` devolvido pelo servidor.

### Estáticos

`STATIC_FILES` em `src/ui/server.js` ganha uma entrada por arquivo novo, com
`text/javascript; charset=utf-8`. A lista continua fixa, sem montar caminho a
partir da URL.

### Status do agendador

Módulo novo `src/scheduler-status.js`:

- `statusPathFor(schedulesPath)`: `scheduler-status.json` na mesma pasta do
  arquivo de agendamentos (`data/` por padrão, fora do versionamento). Não
  precisa de env nova, e os testes que já apontam `SCHEDULES_PATH` para uma
  pasta temporária ganham o status na mesma pasta.
- `writeStatus(path, status)`: escrita atômica (arquivo `.tmp` e `rename`).
- `readStatus(path)`: devolve o objeto, ou `null` se o arquivo não existe. JSON
  inválido lança erro com o caminho; a rota loga e mostra o agendador como parado.
- `schedulerState(status, now)`: `'running'` se `beatAt` tem menos de 45 s,
  `'unresponsive'` se é mais antigo, `'stopped'` se não há status.

Formato do arquivo:

```json
{
  "pid": 12345,
  "startedAt": "2026-09-11T12:00:00.000Z",
  "beatAt": "2026-09-11T12:05:15.000Z",
  "active": ["Resumo semanal", "Ofertas da manhã"],
  "reloadError": null
}
```

Ciclo de vida, em `src/index.js`:

- Grava ao subir, depois do primeiro registro dar certo.
- Regrava a cada 15 s (`setInterval(...).unref()`, para o timer não manter o
  processo vivo sozinho).
- Regrava a cada recarga: `active` atualizado e `reloadError` com a mensagem
  da recarga recusada, ou `null` quando a recarga passa.
- Apaga no `SIGINT` e no `SIGTERM`, antes do `process.exit(0)`.
- Falha ao gravar é logada e não derruba o agendador.

O `watchFile` do agendador observa a pasta e ignora arquivos com outro nome,
então o status gravado ali não dispara recarga.

### `GET /api/status`

Em `src/ui/routes/actions.js`, ao lado do preview de cron:

```json
{
  "now": "2026-09-11T15:00:00.000Z",
  "timezone": "America/Sao_Paulo",
  "timezoneLabel": "Horário Padrão de Brasília",
  "scheduler": {
    "state": "running",
    "startedAt": "2026-09-11T12:00:00.000Z",
    "beatAt": "2026-09-11T14:59:50.000Z",
    "reloadError": null
  },
  "nextRuns": { "sch-a1": "2026-09-11T21:00:00.000Z" }
}
```

- `scheduler.state` é calculado no servidor da tela, com o relógio da mesma
  máquina do agendador, e nunca no navegador.
- `timezoneLabel` sai de `Intl.DateTimeFormat('pt-BR', { timeZone, timeZoneName: 'long' })`.
- `nextRuns` tem uma chave por agendamento ativo: o próximo disparo pelo
  node-cron no fuso configurado (mesma técnica do preview: cria a task,
  consulta `getNextRuns(1)` e destrói), ou `null` se nunca dispara.
  Agendamento pausado não tem chave.

### Fluxo de dados

1. Ao abrir: em paralelo, `GET /api/schedules`, `/api/messages`,
   `/api/logs?limit=500` e `/api/status`. Depois, `/api/groups`; se falhar,
   a faixa mostra "WAHA indisponível" e o formulário usa o campo de ids.
2. A cada 15 s e ao voltar o foco: `/api/status`. Se essa chamada falhar, a
   faixa mostra "Sem conexão com o servidor da tela".
3. Depois de salvar, excluir, alternar ou enviar: recarrega o necessário, como
   hoje.
4. "Escrever nova": `POST /api/messages` e, com o id, o `POST`/`PUT` do
   agendamento.

As rotas existentes não mudam de formato.

## Casos de borda

| Situação | Comportamento |
|---|---|
| Agendador parado (sem arquivo de status) | Faixa vermelha: "Agendador parado. Nada vai sair até você rodar `npm start`." |
| Agendador parou de responder (processo morto sem Ctrl+C, máquina que dormiu) | Mesmo aviso, com "último sinal às HH:MM". Volta a "rodando" sozinho no próximo sinal |
| Agendador rodando com recarga recusada | Faixa âmbar: "O agendador recusou a última alteração e segue com a anterior: <motivo>" |
| Nenhum agendamento ativo | Faixa neutra "Nenhum agendamento ativo", sem alarme (o agendador já encerra sozinho nesse caso) |
| Agendador falhou ao gravar o status (disco cheio, permissão) | O agendador segue disparando e loga o erro; a tela mostra "parou de responder". O log explica a diferença |
| Tela e agendador com `SCHEDULES_PATH` diferentes | A tela não acha o status e mostra "parado" |
| WAHA fora do ar | Faixa âmbar com o erro; formulário com campo de ids (regra atual) |
| Servidor da tela fora do ar com a página aberta | Faixa: "Sem conexão com o servidor da tela" |
| Salvar recusado pela API | Erro no painel, perto do botão; painel aberto com o que foi digitado |
| Fechar painel com alteração não salva | "Descartar alterações?" |
| "Escrever nova": mensagem salva, agendamento recusado | Painel aberto com a mensagem recém-criada selecionada; tentar de novo não duplica |
| "Escrever nova" com nome de mensagem que já existe | O `POST /api/messages` recusa (nome de mensagem é único) antes de gravar qualquer coisa; o erro aparece junto do campo de nome da mensagem |
| Enviar agora com erro de rede | Erro no modal; botão volta a "Enviar para N grupos" |
| Enviar agora com falha em parte dos grupos | Modal lista cada falha com o erro |
| Excluir mensagem em uso | Aviso 409 do servidor, com os agendamentos que a usam |
| Cron personalizado | Aparece cru, com aviso; salvar sem mexer mantém (regra atual) |
| Grupo salvo que o WAHA não lista | Continua marcado e sinalizado (regra atual) |
| Mensagem com emoji | Grava e volta intacta (o servidor já decodifica o corpo com `StringDecoder`) |
| Disparo antigo no limite das 500 linhas do log | Pode aparecer com menos grupos do que teve |
| Agendamento renomeado | O histórico mostra o nome antigo nos disparos antigos; o filtro lista os dois nomes |
| Prévia diverge do WhatsApp num caso exótico | Só a prévia erra; o envio usa o texto cru |
| `localStorage` indisponível (navegação privada, bloqueio) | A aba Recentes dos emojis fica vazia; o resto funciona |

## Testes

Em `test/`, com `node:test`, nunca contra o WAHA real (regra do `CLAUDE.md`).

1. `cron.js`: os asserts atuais de `test/ui-app.test.js` sobre dias, horário,
   faixas, domingo como 0 e 7, cron personalizado e descrição, agora por import.
2. `schedules-view.js`: os asserts atuais sobre o formulário (grupo salvo fora
   da lista marcado e sinalizado, destino preservado no payload, campo de ids
   sem WAHA, prévia pedida ao abrir, cron personalizado mantido), agora por
   import. Nenhum comportamento preso hoje é descartado.
3. `dates.js`: "hoje", "amanhã", "ontem", mesma semana e outro ano, com instante
   fixo e fuso explícito, e o mesmo resultado rodando com `TZ=UTC`.
4. `whatsapp.js`: cada regra da prévia, marcadores que não formatam
   (`* texto *`, `2*3*4`), aninhamento, blocos e código sem formatação interna,
   e HTML no texto sempre escapado (`<script>`, aspas em atributos); ações da
   barra com e sem seleção, espaços nas bordas, alternância e prefixos de
   várias linhas.
5. `history.js`: separação por `label`, por intervalo maior que 60 s e por
   grupo repetido; selo "manual"; contagem de falhas.
6. `scheduler-status.js`: escrita atômica, leitura de arquivo ausente e
   corrompido, `schedulerState` com relógio injetado nas três situações.
7. Agendador: com `SCHEDULES_PATH` temporário, o status aparece depois de subir,
   `reloadError` é preenchido numa recarga inválida e limpo na seguinte, e o
   arquivo some no `stop`.
8. `GET /api/status`: rodando, parado, sem resposta e com recarga recusada;
   `nextRuns` no fuso configurado; agendamento pausado sem chave.
9. API: mensagem com emoji passa por `POST` e `GET` intacta.
10. Servidor: os arquivos novos são servidos com o tipo certo; a travessia de
    diretório continua recusada.

Verificação na tela, contra o mock (`WAHA_URL=http://localhost:3999`, com
`SCHEDULES_PATH` e `LOG_PATH` temporários): fluxo completo de criar, editar,
pausar, enviar agora e conferir o histórico, com prints no tema claro, no
escuro e em largura de celular. O "Enviar agora" é exercitado só contra o mock.

Fechamento: `npm test` e depois `node harness/run.js all`.

## Impacto no código existente

| Arquivo | Mudança |
|---|---|
| `public/index.html` | Reescrito: faixa de status, abas, seções, `<dialog>` do painel e do modal, região de avisos |
| `public/style.css` | Reescrito com a paleta neutra, claro e escuro |
| `public/app.js` | Reescrito como orquestrador; a lógica pura sai para os módulos |
| `public/*.js` (novos) | `main`, `api`, `html`, `cron`, `dates`, `whatsapp`, `emoji`, `history`, `status-view`, `schedules-view`, `messages-view`, `history-view` |
| `src/ui/server.js` | Novas entradas em `STATIC_FILES` |
| `src/ui/routes/actions.js` | `GET /api/status` |
| `src/scheduler-status.js` (novo) | Leitura, escrita e estado do arquivo de status |
| `src/index.js` | Sinal de vida, status atualizado na recarga, arquivo apagado ao encerrar |
| `.gitignore` | `scheduler-status.json` fora do versionamento em qualquer pasta |
| `test/ui-app.test.js` | Passa a importar os módulos em vez de rodar o `app.js` numa sandbox |
| `test/` (novos) | `whatsapp`, `dates`, `history`, `scheduler-status`, status do agendador, `GET /api/status` |
| `README.md` | Seção da tela: faixa de status, formatação e emojis |
| `docs/superpowers/specs/2026-09-06-frontend-agendamentos-design.md` | Nota no início apontando para este documento na seção "A tela" |

Nada muda em `harness/`, no formato do `schedules.json`, no formato do log
nem nas rotas existentes.

## Fora de escopo

- Detectar dois agendadores rodando ao mesmo tempo. Os dois disparariam cada
  envio, e o status mostraria só o último a gravar. Fica anotado como melhoria
  futura do agendador.
- Estado da sessão do WhatsApp no WAHA (QR code pendente, sessão caída) além do
  "a lista de grupos respondeu ou não". Exigiria rota nova no cliente WAHA e
  no mock, que o `CLAUDE.md` não deixa alterar.
- Progresso por grupo durante o "Enviar agora".
- Busca de emojis, envio de mídia, menções, prévia de link.
- Duplicar agendamento, visão de agenda semanal, paginação do histórico.
- Autenticação e acesso pela rede (D3 continua valendo).
