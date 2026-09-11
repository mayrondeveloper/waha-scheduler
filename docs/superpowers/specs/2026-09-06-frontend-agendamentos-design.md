# Frontend de agendamentos — design

Data: 2026-09-06
Status: aprovado para planejamento

## Contexto

O waha-scheduler hoje é operado por dois CLIs (`list-groups`, `send-now`) e um
processo de agendamento (`src/index.js`) que lê `schedules.json` no boot.
Criar ou alterar um agendamento significa editar JSON na mão e reiniciar o
processo.

Este documento especifica uma tela web para gerenciar agendamentos e mensagens
sem editar arquivo e sem reiniciar nada.

Observação de contexto: o `CLAUDE.md` do projeto trata o `SPEC.md` como fonte da
verdade funcional, mas esse arquivo não existe no repositório. O comportamento
atual foi derivado dos asserts de `harness/run.js`. Este design se apoia no
mesmo contrato.

## Objetivo

Uma tela local onde se cria, edita, liga/desliga e exclui agendamentos e
mensagens, escolhe grupos por nome, dispara um envio na hora e consulta o
histórico — com as alterações valendo no scheduler em execução, sem reinício.

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| D1 | Mensagens são entidades próprias, referenciadas por `messageId` | Reuso da mesma mensagem em vários horários e grupos |
| D2 | Processos separados (UI e scheduler), sincronizados por `fs.watch` | Isolamento de falhas: derrubar a tela não derruba os disparos |
| D3 | Servidor escuta apenas em `127.0.0.1`, sem autenticação | A tela dispara envios reais; não ser alcançável de fora dispensa auth e elimina a superfície de ataque |
| D4 | Zero dependência nova: `node:http` + HTML/CSS/JS vanilla | `CLAUDE.md` proíbe express e novas deps; o escopo (≈12 rotas, uma página) não justifica exceção |
| D5 | Identidade por id gerado (`crypto.randomUUID()`), não por `name` | A tela permite renomear; nome como chave quebraria as referências |
| D6 | Excluir mensagem em uso é recusado (HTTP 409), não cascateado | Cascata desativaria disparos silenciosamente |
| D7 | Dados do usuário em `data/`, fora do versionamento | A tela grava ids de grupos reais automaticamente, e o repositório é público |

## Formato de dados (v2)

```json
{
  "version": 2,
  "defaultGroups": ["123456789@g.us"],
  "messages": [
    {
      "id": "msg-a1b2c3",
      "name": "Bom dia",
      "text": "Bom dia! Segue o resumo da semana."
    }
  ],
  "schedules": [
    {
      "id": "sch-d4e5f6",
      "name": "bom-dia-segunda",
      "cron": "0 9 * * 1",
      "messageId": "msg-a1b2c3",
      "groups": ["123456789@g.us"],
      "enabled": true
    }
  ]
}
```

Regras:

- `id` — gerado no servidor, imutável, nunca vindo do cliente.
- `name` — rótulo exibido; único entre agendamentos, para os logs continuarem legíveis.
- `messageId` — obrigatório e precisa existir em `messages`.
- `groups` — se **ausente**, herda `defaultGroups`. Se **informado como lista
  vazia**, é erro: com um seletor de grupos na tela, a lista vazia é uma escolha
  do usuário, e herdar os defaults nesse caso trocaria os destinatários em
  silêncio. Se após a herança ainda ficar vazio, também é erro.
- `enabled` — default `true`.

### Compatibilidade com o formato atual

O formato em uso hoje (sem `version`, com `message` como texto dentro do
agendamento) continua carregando. O loader normaliza para v2 **em memória**:
cada `message` textual vira uma mensagem sintética com id derivado, e o
agendamento passa a apontar para ela.

Não há comando de migração. A primeira gravação feita pela tela persiste o
arquivo já em v2. Um usuário que nunca abrir a tela nunca vê o formato mudar.

## Arquitetura

Dois processos, um arquivo compartilhado. **A UI é a única que escreve.**

```
npm run ui                          npm start
 └─ src/ui/server.js                 └─ src/index.js
      HTTP 127.0.0.1:3000                 node-cron
      lê e ESCREVE o JSON                 apenas LÊ o JSON
              │                                 ▲
              └──── rename() atômico ───── fs.watch (no diretório)
```

### Contrato do arquivo

Três hazards do file watch, com solução obrigatória:

**Escrita atômica.** A UI grava em `<arquivo>.tmp` no mesmo diretório e faz
`rename()`. Em um mesmo filesystem o rename é atômico, então o scheduler nunca
observa um JSON parcial. Gravar por cima do arquivo original não é aceitável.

**Watch no diretório, não no arquivo.** O `rename()` substitui o inode; um
`fs.watch` apontado para o arquivo pararia de receber eventos depois da
primeira gravação. O watcher observa o diretório e filtra pelo basename.
Eventos são debounced em 200 ms, porque uma gravação gera múltiplos.

**Recarga não derruba o serviço.** Boot e recarga se comportam de formas
diferentes, de propósito:

| Momento | Config inválida |
|---|---|
| Boot (`npm start`) | Aborta com código ≠ 0 e aponta o agendamento problemático (comportamento atual, preservado) |
| Recarga (via watch) | **Mantém em memória a última config válida**, loga o erro e segue disparando |

Sem essa distinção, um cron digitado errado na tela derrubaria os disparos da
madrugada. Na recarga, as tasks antigas são paradas (`task.stop()`) e as novas
registradas apenas depois da validação passar por inteiro — nunca há estado
meio-aplicado.

### Envio pela tela

`POST /api/schedules/:id/run` chama o `broadcast()` que já existe e já tem
testes. A UI não ganha lógica de envio própria e não importa `node-cron`.

## API HTTP

Todas as respostas são JSON. Erros seguem `{ "error": "mensagem em português" }`.

| Método | Rota | Efeito |
|---|---|---|
| GET | `/api/messages` | Lista mensagens |
| POST | `/api/messages` | Cria mensagem |
| PUT | `/api/messages/:id` | Substitui mensagem |
| DELETE | `/api/messages/:id` | Exclui; **409** se algum agendamento a referencia |
| GET | `/api/schedules` | Lista agendamentos |
| POST | `/api/schedules` | Cria agendamento |
| PUT | `/api/schedules/:id` | Substitui agendamento |
| PATCH | `/api/schedules/:id` | Alterna apenas `enabled` |
| DELETE | `/api/schedules/:id` | Exclui agendamento |
| POST | `/api/schedules/:id/run` | Dispara agora via `broadcast()` |
| GET | `/api/groups` | Proxy de `listGroups()` do WAHA |
| GET | `/api/logs?limit=100` | Últimas N linhas do JSONL |

Códigos: `200` ok, `201` criado, `400` payload inválido, `404` id inexistente,
`409` conflito referencial, `502` WAHA inacessível, `500` erro interno.

Estáticos: `GET /` serve `public/index.html`; `/app.js` e `/style.css` saem da
mesma pasta. Nenhum outro caminho é servido do disco — o roteador tem uma lista
fixa de arquivos, sem montar caminho a partir da URL, para não abrir travessia
de diretório.

### Validação compartilhada

As regras de validação hoje vivem dentro de `loadSchedules`, acopladas à leitura
do arquivo inteiro. Serão extraídas para `validateSchedule()` e
`validateMessage()`, exportadas de `src/schedules.js` e usadas **tanto pelo
loader quanto pela API**.

Isso é pré-requisito, não refinamento: com regras duplicadas, a tela aceitaria
configuração que o scheduler recusa no boot.

### Escritas concorrentes

Cada escrita é um read-modify-write do arquivo inteiro. Duas abas salvando ao
mesmo tempo perderiam uma das edições. Como há um único processo escritor, as
escritas são serializadas por uma fila de promises no servidor da UI. Não há
lock entre processos, e não é necessário — a UI é a única escritora por design.

## A tela

Página única, três áreas, sem build step e sem framework.

**Agendamentos** — lista com nome, quando dispara ("Seg, Qua e Sex às 09:00",
"Todo dia às 09:00"), mensagem vinculada, quantidade de grupos, toggle de ativo
e as ações editar / excluir / disparar agora. O formulário não pede cron: pede
os **dias da semana** (a semana começa na segunda) e o **horário**, e monta o
cron a partir deles (`0 9 * * 1,3,5`; todos os dias viram `*`). O arquivo e o
agendador continuam falando só cron. O horário vale no fuso de `TIMEZONE`. O
formulário exibe os **próximos 3 disparos** assim que abre e a cada mudança
nos dias ou no horário, usando `getNextRuns()` do node-cron (verificado:
disponível na v4). Os grupos vêm de `GET /api/groups`, exibidos por nome.

Um cron que não cabe em dias e horário — só o formato exato
`minuto hora * * dias` cabe, com faixas como `1-5` e o domingo como `0` ou `7` —
aparece cru no formulário, com um aviso, e salvar sem mexer o mantém como está.
Convertê-lo em silêncio mudaria quando o agendamento dispara.

**Mensagens** — CRUD, mostrando em cada mensagem quais agendamentos a usam.

**Histórico** — tabela do JSONL, mais recentes primeiro, falhas destacadas.

O botão "disparar agora" pede confirmação explícita: com WAHA real configurado
ele envia mensagem de verdade no WhatsApp.

## Casos de borda

| Situação | Comportamento |
|---|---|
| WAHA fora do ar ao abrir a tela | Lista de grupos vazia com aviso; o resto da tela funciona; ainda é possível digitar ids na mão |
| Arquivo apagado enquanto o scheduler roda | Mantém a última config válida e loga |
| `messageId` apontando para mensagem inexistente | Erro de validação, nomeando o agendamento |
| Nome de agendamento duplicado | 400, com a mensagem apontando o nome |
| Cron válido mas que nunca dispara | Aceito; a tela mostra "nenhum disparo previsto" no preview |
| Cron editado à mão que não cabe em dias e horário (`*/15 * * * *`) | O formulário mostra o cron cru, com aviso; salvar sem mexer o mantém. A lista mostra o cron em vez da descrição |
| Nenhum dia da semana marcado | A tela recusa o save com "Selecione ao menos um dia da semana e o horário." |
| Dois agendamentos para o mesmo grupo no mesmo minuto | Permitido; cada um respeita seu próprio delay entre grupos |
| Arquivo editado à mão enquanto a tela está aberta | A UI relê o arquivo a cada requisição, então a próxima ação já parte do estado novo. Salvar na tela com um formulário aberto de antes sobrescreve a edição manual — a tela não faz merge |

## Testes

Em `test/`, com `node:test`, sempre contra o mock do harness. O `CLAUDE.md`
proíbe alterar `harness/`, então nada é acrescentado lá.

1. CRUD de mensagens e agendamentos pela API, sobre arquivo temporário
2. `DELETE` de mensagem em uso responde 409 e não altera o arquivo
3. Escrita atômica: o arquivo nunca é observado em estado parcial
4. Recarga: scheduler em execução aplica alteração feita no arquivo
5. Recarga inválida: mantém a config anterior e continua disparando
6. Retrocompatibilidade: arquivo v1 carrega e normaliza para v2
7. `POST /run` envia através do mock, nunca do WAHA real
8. Roteador de estáticos recusa caminho fora da lista fixa

Nenhum teste envia mensagem real, conforme o `CLAUDE.md`.

## Impacto no código existente

| Arquivo | Mudança |
|---|---|
| `src/schedules.js` | Extrair `validateSchedule()` / `validateMessage()`; suportar v1 e v2; resolver `messageId` |
| `src/index.js` | Passar a observar o arquivo; recarga que preserva a última config válida |
| `src/config.js` | `SCHEDULES_PATH` default vira `./data/schedules.json`; novas `UI_PORT` e `UI_HOST` |
| `schedules.json` | Renomeado para `schedules.example.json` (versionado, com placeholders) |
| `test/schedules.test.js` | Passa a apontar para `schedules.example.json` |
| `.gitignore` | Ganha `data/` |
| `.env.example`, `README.md` | Documentar `data/`, `npm run ui`, formato v2 |

Arquivos novos: `src/ui/server.js`, `src/ui/store.js` (leitura/escrita atômica),
`public/index.html`, `public/app.js`, `public/style.css`.

O `data/schedules.json` é criado a partir do exemplo:
`cp schedules.example.json data/schedules.json`.

## Fora de escopo

Edição de `defaultGroups` pela tela — ele continua sendo lido, respeitado e
preservado nas gravações, mas só se altera no arquivo; com a seleção de grupos
por nome em cada agendamento, editá-lo pela UI perde a razão de ser.

Autenticação e exposição em rede (D3); múltiplos usuários; envio de mídia;
edição de `.env` pela tela; retry automático, fila e webhook (já vetados pelos
não-objetivos do `CLAUDE.md`); histórico com filtro e paginação.
