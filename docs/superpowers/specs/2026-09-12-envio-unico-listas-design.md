# Envio único, listas de grupos e duplicar — design

Data: 2026-09-12
Subprojeto A do roteiro aprovado em 2026-09-11 (itens 1 a 3). Os subprojetos
B (operação) e C (cliques) têm specs próprias na mesma pasta.

## Problema

O agendador só sabe repetir por dias da semana. Oferta tem validade: "sábado
às 10:00, uma vez" é o pedido mais comum de quem administra grupo, e hoje
exige criar um agendamento, esperar disparar e lembrar de desligar. Escolher
grupos também é repetitivo: os mesmos 12 grupos marcados um a um em cada
agendamento. E quem repete o padrão de uma oferta reescreve tudo do zero.

## Decisões

- **A1. Envio único é um agendamento com `at` no lugar de `cron`.** Um
  agendamento tem exatamente um dos dois. `at` é hora de parede no fuso
  `TIMEZONE`, no formato `YYYY-MM-DDTHH:mm`, igual ao cron, que também é
  relativo ao fuso. Nada de UTC no arquivo.
- **A2. O agendador dispara envios únicos por um tique de 30 s**, não pelo
  node-cron, que não tem data única. O tique roda no boot e a cada 30 s e
  olha os agendamentos com `at`, habilitados, sem `firedAt` nem `missedAt`.
  Vencido (`at` no passado) até 10 minutos: dispara. Vencido há mais de 10
  minutos (o agendador estava parado): marca `missedAt` e avisa no log.
  Oferta atrasada em horas é pior que oferta não enviada.
- **A3. O agendador passa a gravar no arquivo de agendamentos** (`firedAt`,
  `missedAt`), pela mesma escrita atômica da tela. `src/ui/store.js` vira
  `src/store.js`, porque deixa de ser da tela. A escrita é lida-modificada-
  gravada na hora; a janela de corrida com a tela é de milissegundos e o
  pior caso é perder uma edição feita exatamente nesse instante. Aceito
  para uma ferramenta de um usuário.
- **A4. Depois de disparar, o agendamento fica.** O card mostra "Enviado" com
  a hora; um perdido mostra "Perdido" com o motivo. Editar a data para o
  futuro limpa `firedAt`/`missedAt` e reativa. "Enviar agora" continua
  disponível nos dois casos.
- **A5. Listas de grupos são um cadastro próprio** (`groupLists`), com id,
  nome e grupos. O agendamento referencia listas por id e pode ter grupos
  avulsos junto. O destino é a união, na ordem: grupos avulsos, depois as
  listas na ordem escolhida, sem repetição. A resolução acontece na leitura
  (`loadSchedules`) e no envio manual, nunca na gravação: mudar a lista muda
  os próximos envios de quem a usa.
- **A6. Excluir uma lista em uso é recusado** (409) com os nomes dos
  agendamentos que a usam. Excluir um grupo de dentro da lista é livre.
- **A7. Duplicar é só tela.** Abre o editor de agendamento ou de mensagem
  preenchido com os dados do original, sem id, com " (cópia)" no nome (e um
  número se o nome já existir). Salvar cria um item novo pela API atual.
- **A8. Nada muda para arquivos antigos.** Campos novos são opcionais; a
  versão do arquivo continua 2; o harness (formato v1 com `message` e `cron`)
  não é tocado.

## Formato do arquivo

```json
{
  "version": 2,
  "defaultGroups": ["111@g.us"],
  "groupLists": [
    { "id": "lst-3a9f1c2e", "name": "Ofertas SP", "groups": ["111@g.us", "222@g.us"] }
  ],
  "messages": [],
  "schedules": [
    {
      "id": "sch-1", "name": "Ofertas da manhã", "cron": "0 9 * * 1-5",
      "messageId": "msg-1", "groups": ["333@g.us"], "groupLists": ["lst-3a9f1c2e"], "enabled": true
    },
    {
      "id": "sch-2", "name": "Promo de sábado", "at": "2026-09-13T10:00",
      "messageId": "msg-1", "groupLists": ["lst-3a9f1c2e"], "enabled": true,
      "firedAt": null, "missedAt": null
    }
  ]
}
```

Regras de validação (em `validateSchedule`, com o rótulo do agendamento na
mensagem de erro, como hoje):

- `cron` ou `at`, nunca os dois nem nenhum. `at` deve casar
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$` e ser uma data real.
- `groupLists`: lista de ids de listas existentes; ausente = vazia.
- Destino: `groups` ausente e sem listas herda `defaultGroups` (regra
  atual). `groups: []` com ao menos uma lista é válido. `groups: []` sem
  lista continua erro. A união resolvida precisa ter ao menos um grupo.
- `firedAt` e `missedAt`: ISO 8601 ou nulo; só fazem sentido com `at`.
- `groupLists` (cadastro): id `lst-` gerado quando ausente, nome obrigatório
  e único, `groups` lista com ao menos um id.

`loadSchedules` devolve em cada agendamento `targets` (a união resolvida) e
mantém `groups` e `groupLists` como estão no arquivo.

## Agendador

- `register` continua registrando só os `cron` habilitados no node-cron.
- Um tique (`TICK_MS = 30_000`), com `unref`, chama `runDue(now)`:
  para cada envio único pendente, converte `at` para instante com
  `wallToInstant(at, timezone)` (novo, em `src/dates.js`, via `Intl`, sem
  dependência) e decide: futuro, nada; vencido até `GRACE_MS = 600_000`,
  dispara e grava `firedAt`; vencido além disso, grava `missedAt` e loga
  aviso. A gravação usa `updateStore` e acontece antes do envio, para um
  tique seguinte não disparar de novo enquanto o envio anda.
- A recarga (`reload`) troca a lista que o tique consulta, sem reiniciar o
  tique.
- "Ativo" para o status e para a saída no boot passa a ser: cron habilitado
  ou envio único pendente. O arquivo de status ganha `oneShots: [nomes]`.
- `GET /api/status` devolve em `nextRuns` o instante do envio único pendente,
  ou nulo quando já disparou ou foi perdido.

## API da tela

| Rota | Comportamento |
|---|---|
| `GET /api/lists` | Lista as listas. |
| `POST /api/lists` | `{ name, groups }` → 201 com a lista. Nome duplicado: 409. |
| `PUT /api/lists/:id` | Mesmo corpo; id imutável. |
| `DELETE /api/lists/:id` | 200; 409 se algum agendamento usa a lista. |
| `POST/PUT /api/schedules` | Aceitam `at` (ou `cron`) e `groupLists`. `at` no passado ao salvar: 400 "escolha um horário no futuro". Mudar `at` limpa `firedAt`/`missedAt`. |
| `POST /api/schedules/:id/run` | Envia para a união resolvida. |

`GET /api/schedules` devolve os agendamentos como no arquivo (com
`groupLists`) e a tela resolve a união para exibição usando `GET /api/lists`.

## Tela

- **Quando:** dois botões de segmento, "Repetir" e "Uma vez". "Repetir" é o
  bloco atual (dias e horário). "Uma vez" mostra data e horário e a prévia
  "Uma vez: sáb 13/09, 10:00". Ao editar um cron personalizado, o segmento
  fica em "Repetir" e mantém o campo cru.
- **Card:** "Uma vez · sáb 13/09, 10:00" no lugar dos dias; badge "Enviado"
  (tom `waiting`) com a hora, ou "Perdido" (tom `error`) com "o agendador
  estava parado às 10:00".
- **Grupos no formulário:** as listas aparecem primeiro, como caixas com o
  nome e a contagem ("Ofertas SP · 12 grupos"); abaixo, os grupos avulsos
  como hoje. O contador mostra a união ("14 grupos selecionados"). Os grupos
  cobertos por uma lista marcada aparecem desabilitados na parte avulsa,
  com a nota "pela lista Ofertas SP".
- **Aba "Grupos":** listas com nome, quantidade de grupos e quem as usa;
  criar/editar num painel com nome e o mesmo seletor de grupos (busca,
  contador); excluir com confirmação; a exclusão recusada mostra a mensagem
  do servidor.
- **Duplicar:** item "Duplicar" no menu do card e na linha da mensagem.
- Na aba Agendamentos, o texto de grupos do card mostra "2 listas · 14
  grupos · Alpha, Beta e mais 12" quando há listas.

## Testes

- `src/dates.js`: `wallToInstant` em São Paulo e num fuso com horário de
  verão (America/New_York), inclusive na virada.
- `schedules.js`: `at` válido/inválido, `cron` e `at` juntos, união de
  listas (ordem, sem repetição), `groups: []` com lista, lista inexistente,
  `targets` em `loadSchedules`, cadastro de listas (nome duplicado, vazia).
- Agendador: envio único vence e dispara uma vez (com `firedAt` gravado);
  vencido há mais de 10 minutos vira `missedAt` sem enviar; recarga com
  novo `at` reativa; `nextRuns` do status.
- API: CRUD de listas, 409 na exclusão em uso, `at` no passado, mudar `at`
  limpa `firedAt`, run resolve a união.
- Tela: formulário monta `at` ou `cron`; card de envio único nos três
  estados; contador da união; aba de listas; duplicar preenche o editor.
- Harness inalterado e verde.

## Fora de escopo

- Envio único que se repete "todo dia 5 do mês": continua sendo cron editado
  à mão.
- Listas dinâmicas (por nome de grupo, por tamanho).
- Histórico por lista.
